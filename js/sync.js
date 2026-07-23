/**
 * Cliente del Apps Script.
 *
 * Dos operaciones separadas a propósito:
 *   - guardarVisitas: upsert del árbol (ligero, se manda seguido).
 *   - subirEvidencia: un archivo por petición. Las evidencias pueden subirse días después
 *     de registrar la actividad, y meterlas en el mismo POST haría payloads enormes que
 *     fallan con mala señal.
 */

import {
    leerVisitas, guardarVisitas as persistirVisitas, guardarCatalogo,
    leerArchivo, borrarArchivo, todasLasActividades,
    leerEstrategias, guardarEstrategias as persistirEstrategias, fusionarEstrategiasEquipo
} from './storage.js';
import { eventosPendientes, marcarSincronizados } from './eventos.js';
import {
    comentariosPendientes, marcarSincronizados as marcarComentarios
} from './comentarios.js';
import {
    pendientesDeSubir as revisionesPendientes, marcarSincronizadas as marcarRevisiones
} from './revisiones.js';
import { postear, leerCatalogos } from '../src/services/google/appsScript';

// ---------- catálogos ----------

export async function descargarCatalogo() {
    const datos = await leerCatalogos();
    guardarCatalogo(datos);
    return datos;
}

// ---------- visitas ----------

/**
 * Quita las actividades sin sello de guardado.
 *
 * Un borrador vive en el teléfono para no perderse, pero no es un hecho todavía: subirlo
 * escribiría en la hoja una fila a medio llenar que después habría que distinguir de las
 * reales, y que cambiaría sola en el siguiente sync. La visita sí sube —su check-in y sus
 * sectores ya ocurrieron—; solo se recorta lo que aún se está capturando.
 */
function soloGuardadas(visita) {
    return {
        ...visita,
        sectores: (visita.sectores || []).map(s => ({
            ...s,
            actividades: (s.actividades || []).filter(a => a.guardada)
        }))
    };
}

export async function sincronizarVisitas() {
    // Un borrador no se envía: la visita no existe hasta que alguien presiona Guardar visita,
    // y subirla crearía en la hoja una cita que nadie confirmó.
    const pendientes = leerVisitas().filter(v => !v.sincronizado && !v.borrador);
    if (pendientes.length === 0) return { enviadas: 0 };

    const resultado = await postear({ action: 'guardarVisitas', visitas: pendientes.map(soloGuardadas) });

    // El servidor ya escribió en Sheets pase lo que pase (esa parte nunca lanza). Pero si el
    // espejo a Supabase falló, `resultado.espejo` viene en `false` — y marcar aquí
    // `sincronizado = true` de todos modos dejaría a esa visita ausente PARA SIEMPRE de la
    // fuente "equipo": el flag local ya diría "sincronizada" y nunca se volvería a mandar. Se
    // deja `sincronizado = false` en ese caso para que el siguiente ciclo la reintente; volver
    // a escribir la misma fila en Sheets no duplica nada (`guardarVisitas` es upsert por id).
    const idsEnviados = new Set(pendientes.map(v => v.id));
    const seEspejeo = resultado?.espejo !== false;
    const visitas = leerVisitas();
    visitas.forEach(v => {
        if (idsEnviados.has(v.id)) v.sincronizado = seEspejeo;
    });
    persistirVisitas(visitas);

    return { enviadas: pendientes.length, espejo: seEspejeo };
}

// ---------- evidencias ----------

function blobABase64(blob) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result).split(',')[1]);
        lector.onerror = () => reject(lector.error);
        lector.readAsDataURL(blob);
    });
}

/** Sube el archivo local de una actividad y guarda la URL que devuelve Drive. */
export async function subirEvidencia(idActividad) {
    const blob = await leerArchivo(idActividad);
    if (!blob) throw new Error(`Sin archivo local para la actividad ${idActividad}`);

    const entrada = todasLasActividades().find(x => x.actividad.id === idActividad);
    if (!entrada) throw new Error(`Actividad ${idActividad} no encontrada`);

    const resultado = await postear({
        action: 'subirEvidencia',
        id_actividad: idActividad,
        // El script archiva por cliente y no puede deducirlo: la fila de la actividad
        // puede no existir todavía si la evidencia se sube antes de sincronizar la visita.
        cliente: entrada.visita.cliente || '',
        nombre: entrada.actividad.evidencia?.nombre || `${idActividad}`,
        mimeType: blob.type || 'application/octet-stream',
        datos: await blobABase64(blob)
    });

    const visitas = leerVisitas();
    for (const visita of visitas) {
        for (const sector of visita.sectores || []) {
            const act = (sector.actividades || []).find(a => a.id === idActividad);
            if (!act) continue;

            act.evidencia = { ...act.evidencia, estado: 'subida', url: resultado.url };
            // Se reenvía la visita para que la URL quede también en la fila hija por si
            // el script no la encontró (actividad aún no sincronizada al subir el archivo).
            visita.sincronizado = false;
            persistirVisitas(visitas);
            await borrarArchivo(idActividad);
            return resultado;
        }
    }

    throw new Error(`No se pudo marcar la evidencia de ${idActividad}`);
}

/** Sube todas las evidencias que estén en 'local'. Devuelve cuántas subieron y cuántas fallaron. */
export async function subirEvidenciasPendientes() {
    const locales = todasLasActividades()
        .filter(({ actividad }) => actividad.evidencia?.estado === 'local');

    let subidas = 0;
    let fallidas = 0;

    for (const { actividad } of locales) {
        try {
            await subirEvidencia(actividad.id);
            subidas++;
        } catch (err) {
            console.error(`Falló la evidencia ${actividad.id}:`, err);
            fallidas++;
        }
    }

    return { subidas, fallidas };
}

// ---------- estrategias ----------
//
// Es una referencia COMPARTIDA por todo el equipo, no un registro personal: no se recorta por
// alcance ni por dueño. Se sube lo que cambió localmente y se releen todas, para que lo que
// otro educador o gerente acaba de escribir aparezca sin esperar a que alguien reagende algo.

// `productos` vive como arreglo en la app (multi-selección de materiales), pero la hoja de
// Estrategias tiene una sola celda de texto por fila — Apps Script no necesita saber que es
// una lista, así que la conversión vive aquí, en el único lugar donde el dato cruza al POST.
function productosATexto(productos) {
    return Array.isArray(productos) ? productos.filter(Boolean).join('; ') : (productos || '');
}
function productosDesdeTexto(texto) {
    return String(texto || '').split(';').map(s => s.trim()).filter(Boolean);
}

export async function sincronizarEstrategias() {
    const pendientes = leerEstrategias().filter(e => !e.sincronizado);
    if (pendientes.length === 0) return { enviadas: 0 };

    await postear({
        action: 'guardarEstrategias',
        estrategias: pendientes.map(e => ({ ...e, productos: productosATexto(e.productos) }))
    });

    const idsEnviados = new Set(pendientes.map(e => e.id));
    const estrategias = leerEstrategias();
    estrategias.forEach(e => { if (idsEnviados.has(e.id)) e.sincronizado = true; });
    persistirEstrategias(estrategias);

    return { enviadas: pendientes.length };
}

/**
 * Trae la lista completa del equipo y la funde con la local. Nunca lanza: es contexto de
 * planeación, no un bloqueo — si falla, se sigue trabajando con lo que ya había.
 */
export async function descargarEstrategiasEquipo() {
    if (!navigator.onLine) return { estrategias: leerEstrategias() };

    try {
        const r = await postear({ action: 'leerEstrategias' });
        const remotas = (Array.isArray(r?.estrategias) ? r.estrategias : [])
            .map(e => ({ ...e, productos: productosDesdeTexto(e.productos) }));
        fusionarEstrategiasEquipo(remotas);
        return { estrategias: leerEstrategias() };
    } catch (err) {
        console.error('No se pudieron leer las estrategias del equipo:', err);
        return { estrategias: leerEstrategias() };
    }
}

// ---------- espejo de lectura ----------

/**
 * Visitas del equipo, traídas del espejo.
 *
 * Pasa por Apps Script y no directo a Supabase porque la PWA solo tiene la clave anónima,
 * que es pública: con ella cualquiera podría pedir las visitas de cualquier correo. Apps
 * Script ya verifica el id_token de Google, así que ahí el correo sí es de fiar.
 *
 * Devuelve [] en vez de lanzar: el equipo es información adicional. Que no llegue no puede
 * romper la pantalla de quien está capturando lo suyo.
 */
export async function descargarVisitasEquipo({ desde = null, hasta = null, limite = 2000 } = {}) {
    if (!navigator.onLine) return { visitas: [], espejo: false };

    try {
        const r = await postear({ action: 'leerVisitasEquipo', desde, hasta, limite });
        return {
            visitas: Array.isArray(r?.visitas) ? r.visitas : [],
            espejo: r?.espejo === true
        };
    } catch (err) {
        console.error('No se pudieron leer las visitas del equipo:', err);
        return { visitas: [], espejo: false };
    }
}

/** Flujos y revisiones que este usuario puede ver. Vuelve vacío si el espejo no responde. */
export async function descargarRevisiones() {
    if (!navigator.onLine) return { flujos: [], revisiones: [], espejo: false };

    try {
        const r = await postear({ action: 'leerRevisiones' });
        return {
            flujos: Array.isArray(r?.flujos) ? r.flujos : [],
            revisiones: Array.isArray(r?.revisiones) ? r.revisiones : [],
            espejo: r?.espejo === true
        };
    } catch (err) {
        console.error('No se pudieron leer las revisiones:', err);
        return { flujos: [], revisiones: [], espejo: false };
    }
}

// ---------- administración ----------

/** Reemplaza los catálogos compartidos. Requiere ser admin: el servidor lo vuelve a revisar. */
export async function guardarCatalogosAdmin(cambios) {
    return postear({ action: 'guardarCatalogosAdmin', ...cambios });
}

// ---------- roles, capacidades y usuarios ----------

/**
 * Roles, catálogo de capacidades y usuarios, en una sola ida. Requiere ser admin: el servidor
 * lo vuelve a revisar (`Codigo.gs: leerRBAC`) antes de tocar Supabase.
 */
export async function leerRBAC() {
    return postear({ action: 'leerRBAC' });
}

/**
 * Guarda roles y borra los que se pidieron borrar.
 * Carga: { roles: [...], eliminar: ["clave"] }.
 */
export async function guardarRoles(cambios) {
    return postear({ action: 'guardarRoles', ...cambios });
}

/**
 * Guarda usuarios —con su conjunto de roles— y la jerarquía de quién ve a quién.
 * Carga: { usuarios: [...], jerarquia: [...] }.
 */
export async function guardarUsuarios(cambios) {
    return postear({ action: 'guardarUsuarios', ...cambios });
}

// ---------- territorios ----------

/** Titulares de zona + coberturas vigentes. Requiere ser admin: el servidor lo vuelve a revisar. */
export async function leerTerritorios() {
    return postear({ action: 'leerTerritorios' });
}

/**
 * Asigna/quita titulares y agrega/quita coberturas.
 * Carga: { asignar: [{zona, educador_correo}], quitar_zona: ["001"],
 *          agregar_cobertura: [{zona, educador_correo, desde, hasta, motivo}],
 *          quitar_cobertura: ["uuid"] }.
 */
export async function guardarTerritorios(cambios) {
    return postear({ action: 'guardarTerritorios', ...cambios });
}

// ---------- flujos de revisión ----------

/** Todos los flujos de revisión, activos e inactivos, con su conteo de uso. */
export async function leerFlujos() {
    return postear({ action: 'leerFlujos' });
}

/**
 * Guarda flujos de revisión y borra los que se pidieron borrar.
 * Carga: { flujos: [...], eliminar: ["clave"] }.
 */
export async function guardarFlujos(cambios) {
    return postear({ action: 'guardarFlujos', ...cambios });
}

// ---------- eventos ----------

/** Bitácora de negocio. Va al final: referencia visitas y no bloquea nada si falla. */
export async function sincronizarEventos() {
    const pendientes = eventosPendientes();
    if (pendientes.length === 0) return { enviados: 0 };

    await postear({ action: 'guardarEventos', eventos: pendientes });
    marcarSincronizados(pendientes.map(e => e.id));
    return { enviados: pendientes.length };
}

/**
 * Bitácora de comentarios. Van al final, junto con los eventos: referencian visitas que ya
 * subieron y ninguno de los dos bloquea la captura si falla.
 */
export async function sincronizarComentarios() {
    const pendientes = comentariosPendientes();
    if (pendientes.length === 0) return { enviados: 0 };

    await postear({ action: 'guardarComentarios', comentarios: pendientes });
    marcarComentarios(pendientes.map(c => c.id));
    return { enviados: pendientes.length };
}

/**
 * Revisiones pendientes de subir. Un revisor sin señal sigue trabajando; su bandeja se pone
 * al corriente cuando vuelva la conexión.
 */
export async function sincronizarRevisiones() {
    const pendientes = revisionesPendientes();
    if (pendientes.length === 0) return { enviadas: 0 };

    await postear({ action: 'guardarRevisiones', revisiones: pendientes });
    marcarRevisiones(pendientes.map(r => r.id));
    return { enviadas: pendientes.length };
}

/** Orden importante: primero las filas, luego los archivos, y al final se reenvían las URLs. */
export async function sincronizarTodo() {
    const visitas = await sincronizarVisitas();
    const evidencias = await subirEvidenciasPendientes();
    if (evidencias.subidas > 0) await sincronizarVisitas();
    const eventos = await sincronizarEventos();
    const comentarios = await sincronizarComentarios();
    const revisiones = await sincronizarRevisiones();
    const estrategias = await sincronizarEstrategias();
    return { visitas, evidencias, eventos, comentarios, revisiones, estrategias };
}
