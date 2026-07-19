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
    leerArchivo, borrarArchivo, todasLasActividades
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

    await postear({ action: 'guardarVisitas', visitas: pendientes.map(soloGuardadas) });

    // Se relee: el usuario pudo editar algo mientras el POST estaba en vuelo, y marcar
    // esa edición como sincronizada la perdería.
    const idsEnviados = new Set(pendientes.map(v => v.id));
    const visitas = leerVisitas();
    visitas.forEach(v => {
        if (idsEnviados.has(v.id)) v.sincronizado = true;
    });
    persistirVisitas(visitas);

    return { enviadas: pendientes.length };
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
    return { visitas, evidencias, eventos, comentarios, revisiones };
}
