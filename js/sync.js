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
import { normalizarZona } from './catalogos.js';
import { eventosPendientes, marcarSincronizados } from './eventos.js';
import {
    comentariosPendientes, marcarSincronizados as marcarComentarios
} from './comentarios.js';
import {
    pendientesDeSubir as revisionesPendientes, marcarSincronizadas as marcarRevisiones
} from './revisiones.js';
import { postear, leerCatalogos } from '../src/services/google/appsScript';
import {
    tieneAccesoCalendar, intentarReconexionCalendar, sincronizarEventoVisita, borrarEventoVisita
} from './googleCalendar.js';
import { CLIENT_ID as CALENDAR_CLIENT_ID } from './auth.js';

// ---------- catálogos ----------

export async function descargarCatalogo() {
    const datos = await leerCatalogos();
    guardarCatalogo(normalizarZonasDelCatalogo(datos));
    return datos;
}

/**
 * "Gpo. vendedores" en la hoja de Clientes y "Zona" en la hoja de Ejecutivos son la misma zona
 * escrita a mano en dos hojas distintas — "1", "01" y "001" conviven ahí sin que nadie lo note
 * hasta que dejan de emparejar. Se normaliza aquí, en el único punto donde el catálogo crudo de
 * Apps Script entra a la app, para que `zonaDeCliente`/`ejecutivoDeZona`/`zonasDelCatalogo`
 * (catalogos.js) trabajen siempre sobre el mismo formato de 3 dígitos.
 */
function normalizarZonasDelCatalogo(datos) {
    const clientesZona = datos?.clientes_zona;
    const ejecutivos = datos?.ejecutivos;
    if (!clientesZona && !ejecutivos) return datos;

    const normalizado = { ...datos };
    if (clientesZona && typeof clientesZona === 'object') {
        normalizado.clientes_zona = Object.fromEntries(
            Object.entries(clientesZona).map(([cliente, zona]) => [cliente, normalizarZona(zona)])
        );
    }
    if (ejecutivos && typeof ejecutivos === 'object') {
        normalizado.ejecutivos = Object.fromEntries(
            Object.entries(ejecutivos).map(([zona, ejecutivo]) => [normalizarZona(zona), ejecutivo])
        );
    }
    return normalizado;
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

    // Huella de lo que de verdad se mandó, tomada ANTES del `await`: si alguien edita la misma
    // visita mientras el POST está en vuelo, esa edición no viajó en este envío y no debe
    // marcarse como sincronizada solo por compartir id — se quedaría "al día" en la UI sin
    // haber subido nunca. Comparar contra la huella (no contra el objeto en memoria, que ya
    // pudo mutar) es lo que distingue "llegó" de "coincide por casualidad".
    const huellas = new Map(pendientes.map(v => [v.id, JSON.stringify(soloGuardadas(v))]));

    const resultado = await postear({ action: 'guardarVisitas', visitas: pendientes.map(soloGuardadas) });

    // El servidor ya escribió en Sheets pase lo que pase (esa parte nunca lanza). Pero si el
    // espejo a Supabase falló, `resultado.espejo` viene en `false` — y marcar aquí
    // `sincronizado = true` de todos modos dejaría a esa visita ausente PARA SIEMPRE de la
    // fuente "equipo": el flag local ya diría "sincronizada" y nunca se volvería a mandar. Se
    // deja `sincronizado = false` en ese caso para que el siguiente ciclo la reintente; volver
    // a escribir la misma fila en Sheets no duplica nada (`guardarVisitas` es upsert por id).
    const seEspejeo = resultado?.espejo !== false;
    const visitas = leerVisitas();
    visitas.forEach(v => {
        if (seEspejeo && huellas.has(v.id) && JSON.stringify(soloGuardadas(v)) === huellas.get(v.id)) {
            v.sincronizado = true;
        }
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

    // Misma huella que `sincronizarVisitas`: una edición que llega mientras el POST está en
    // vuelo no debe quedar marcada como sincronizada solo por compartir id.
    const huellas = new Map(pendientes.map(e => [e.id, JSON.stringify(e)]));

    await postear({
        action: 'guardarEstrategias',
        estrategias: pendientes.map(e => ({ ...e, productos: productosATexto(e.productos) }))
    });

    const estrategias = leerEstrategias();
    estrategias.forEach(e => {
        if (huellas.has(e.id) && JSON.stringify(e) === huellas.get(e.id)) e.sincronizado = true;
    });
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

// ---------- reporte de actividades ----------

/**
 * Peso % por sector/actividad, desglose mensual y a qué jefe se le atribuye cada fila EN LA
 * FECHA de esa actividad (no el organigrama de hoy). `filtros`: { desde, hasta, sector,
 * actividad, educador }, todos opcionales.
 */
export async function leerReporteActividades(filtros = {}) {
    return postear({ action: 'leerReporteActividades', ...filtros });
}

/** Qué Sector puede ver cada gerente en el reporte de Actividades. Requiere ser admin. */
export async function leerGerenteSector() {
    return postear({ action: 'leerGerenteSector' });
}

/**
 * Histórico pre-AppSheet, solo lectura. `correo` solo tiene efecto si quien pide es admin
 * (si no, el servidor ya lo acota a lo propio sin importar lo que se mande aquí).
 */
export async function leerHistoricoActividades(correo) {
    return postear({ action: 'leerHistoricoActividades', correo: correo || null });
}

export async function leerHistoricoPlanTrabajo(correo) {
    return postear({ action: 'leerHistoricoPlanTrabajo', correo: correo || null });
}

/** Carga: { gerentes: [{gerente_correo, sectores: ["GASAS", ...]}] }. Reemplazo por gerente. */
export async function guardarGerenteSector(cambios) {
    return postear({ action: 'guardarGerenteSector', ...cambios });
}

// ---------- eventos ----------

/** Bitácora de negocio. Va al final: referencia visitas y no bloquea nada si falla. */
export async function sincronizarEventos() {
    const pendientes = eventosPendientes();
    if (pendientes.length === 0) return { enviados: 0 };

    const resultado = await postear({ action: 'guardarEventos', eventos: pendientes });
    // Igual que en visitas: si el espejo no respondió, no se marca sincronizado — se
    // reintenta en el siguiente ciclo. Antes esto se ignoraba y un evento con el espejo caído
    // quedaba marcado "al día" sin haber llegado nunca a Supabase.
    if (resultado?.espejo !== false) marcarSincronizados(pendientes.map(e => e.id));
    return { enviados: pendientes.length, espejo: resultado?.espejo !== false };
}

/**
 * Bitácora de comentarios. Van al final, junto con los eventos: referencian visitas que ya
 * subieron y ninguno de los dos bloquea la captura si falla.
 */
export async function sincronizarComentarios() {
    const pendientes = comentariosPendientes();
    if (pendientes.length === 0) return { enviados: 0 };

    const resultado = await postear({ action: 'guardarComentarios', comentarios: pendientes });
    if (resultado?.espejo !== false) marcarComentarios(pendientes.map(c => c.id));
    return { enviados: pendientes.length, espejo: resultado?.espejo !== false };
}

/**
 * Revisiones pendientes de subir. Un revisor sin señal sigue trabajando; su bandeja se pone
 * al corriente cuando vuelva la conexión.
 */
export async function sincronizarRevisiones() {
    const pendientes = revisionesPendientes();
    if (pendientes.length === 0) return { enviadas: 0 };

    const resultado = await postear({ action: 'guardarRevisiones', revisiones: pendientes });
    // `marcarRevisiones` BORRA de la cola: si el espejo falló no se llama, porque ahí no
    // queda ningún flag de "pendiente" que reintentar — perderla de la cola la pierde para
    // siempre.
    if (resultado?.espejo !== false) marcarRevisiones(pendientes.map(r => r.id));
    return { enviadas: pendientes.length, espejo: resultado?.espejo !== false };
}

// ---------- Google Calendar ----------

/**
 * Reconcilia las visitas de la app con sus eventos espejo en Google Calendar — la red de
 * seguridad que hace que un registro cargado en la app SIEMPRE termine en Calendar, sin
 * depender de que el usuario haya estado conectado justo en el instante en que guardó (los 4
 * puntos donde `reflejarEnCalendar` se llama en caliente son best-effort; esto es lo que
 * repara lo que ellos se perdieron).
 *
 * Sale barata y sin tocar la red si Calendar no está conectado en este dispositivo NI se
 * pudo reconectar en silencio — el caso normal es que sí: el consentimiento se pidió al
 * iniciar sesión (`js/app.js`), así que la mayoría de las veces solo hace falta renovar el
 * token sin que nadie tenga que abrir Calendario o Mi Día para lograrlo.
 */
export async function sincronizarCalendar() {
    if (!tieneAccesoCalendar()) await intentarReconexionCalendar(CALENDAR_CLIENT_ID);
    if (!tieneAccesoCalendar()) return { revisadas: 0 };

    const visitas = leerVisitas();
    let creados = 0;
    let borrados = 0;
    let fallidos = 0;

    const necesitanEvento = visitas.filter(v =>
        !v.borrador && v.estado !== 'cancelada' && v.dia && v.hora_inicio && v.hora_fin
        && (!v.calendar_event_id || v.calendar_pendiente)
    );
    const necesitanBorrado = visitas.filter(v => v.estado === 'cancelada' && v.calendar_event_id);

    for (const visita of necesitanEvento) {
        try {
            const eraNuevo = !visita.calendar_event_id;
            const id = await sincronizarEventoVisita(visita);
            if (id) {
                // Un id RECIÉN estrenado sí tiene que subir al espejo (otro dispositivo lo
                // necesita para no duplicar el evento); reconfirmar el mismo id que ya
                // conocía este dispositivo no cambió nada que el backend necesite reenviar.
                actualizarVisitaLocal(visita.id, v => {
                    v.calendar_event_id = id;
                    delete v.calendar_pendiente;
                }, { marcarSucio: eraNuevo });
                creados++;
            }
        } catch (err) {
            console.error(`No se pudo reflejar la visita ${visita.id} en Calendar:`, err);
            fallidos++;
        }
    }

    for (const visita of necesitanBorrado) {
        try {
            await borrarEventoVisita(visita.calendar_event_id);
            actualizarVisitaLocal(visita.id, v => { v.calendar_event_id = null; });
            borrados++;
        } catch (err) {
            console.error(`No se pudo borrar de Calendar el evento de ${visita.id}:`, err);
            fallidos++;
        }
    }

    return { revisadas: necesitanEvento.length + necesitanBorrado.length, creados, borrados, fallidos };
}

/**
 * Sube lo que este dispositivo acaba de leer de SU PROPIO Google Calendar
 * (`listarCompromisos()`), para que alguien a cargo pueda verlo sin que su token necesite leer
 * el calendario de nadie más — ver `20260813_pdt_calendar_compromisos.sql`. Mejor esfuerzo,
 * igual que el resto de los espejos: si falla, lo único que pasa es que el gerente ve esto un
 * poco más tarde, nunca bloquea nada de lo que el educador está haciendo.
 */
export async function subirCompromisosCalendar(compromisos, desdeISO, hastaISO) {
    if (!navigator.onLine) return { espejo: false };
    try {
        const r = await postear({
            action: 'guardarCompromisosCalendar',
            compromisos: compromisos.map(c => ({
                id: c.id, titulo: c.titulo, inicio: c.inicio, fin: c.fin,
                todoElDia: c.todoElDia, ubicacion: c.ubicacion, descripcion: c.descripcion, url: c.url
            })),
            desde: desdeISO, hasta: hastaISO
        });
        return { espejo: r?.espejo === true };
    } catch (err) {
        console.error('No se pudieron subir los compromisos de Calendar:', err);
        return { espejo: false };
    }
}

/**
 * Compromisos de Calendar que el EQUIPO ya subió (no los propios: esos se leen en vivo con
 * `listarCompromisos()`). Vuelve vacío en vez de lanzar, mismo criterio que
 * `descargarVisitasEquipo`: es información adicional, que no llegue no puede romper la
 * pantalla de quien está viendo su agenda.
 */
export async function descargarCompromisosCalendarEquipo(desdeISO, hastaISO) {
    if (!navigator.onLine) return { compromisos: [], espejo: false };
    try {
        const r = await postear({ action: 'leerCompromisosCalendarEquipo', desde: desdeISO, hasta: hastaISO });
        return {
            compromisos: Array.isArray(r?.compromisos) ? r.compromisos : [],
            espejo: r?.espejo === true
        };
    } catch (err) {
        console.error('No se pudieron leer los compromisos de Calendar del equipo:', err);
        return { compromisos: [], espejo: false };
    }
}

/**
 * Igual que `storage.actualizarVisita`, pero sin marcar `sincronizado = false` POR DEFECTO: el
 * id del evento y la bandera `calendar_pendiente` son metadatos locales de Calendar, no un
 * cambio de contenido que el backend necesite reenviar en cuanto se sepa. La única excepción
 * es `marcarSucio: true` — cuando el id que se acaba de guardar es nuevo de verdad (recién
 * creado por el reconciliador), y sin subirlo al espejo un segundo dispositivo no tiene forma
 * de saber que el evento ya existe y termina creando uno duplicado.
 */
function actualizarVisitaLocal(id, mutador, { marcarSucio = false } = {}) {
    const visitas = leerVisitas();
    const visita = visitas.find(v => v.id === id);
    if (!visita) return;
    mutador(visita);
    if (marcarSucio) visita.sincronizado = false;
    persistirVisitas(visitas);
}

/**
 * Orden importante: primero las filas, luego los archivos, y al final se reenvían las URLs.
 * Cada etapa corre en su propio `try/catch`: antes, si `sincronizarVisitas` fallaba, ninguna
 * de las siguientes (evidencias, Calendar, eventos, comentarios, revisiones, estrategias) se
 * intentaba siquiera — una sola cola caída dejaba a TODAS las demás sin subir ese ciclo.
 */
export async function sincronizarTodo() {
    const errores = {};
    const etapa = async (nombre, fn, valorPorDefecto) => {
        try {
            return await fn();
        } catch (err) {
            console.error(`Falló la etapa "${nombre}" de sincronizarTodo:`, err);
            errores[nombre] = err.message || String(err);
            return valorPorDefecto;
        }
    };

    const visitas = await etapa('visitas', sincronizarVisitas, { enviadas: 0 });
    const evidencias = await etapa('evidencias', subirEvidenciasPendientes, { subidas: 0, fallidas: 0 });
    if (evidencias.subidas > 0) await etapa('visitas-tras-evidencias', sincronizarVisitas, { enviadas: 0 });
    const calendar = await etapa('calendar', sincronizarCalendar, { revisadas: 0 });
    const eventos = await etapa('eventos', sincronizarEventos, { enviados: 0 });
    const comentarios = await etapa('comentarios', sincronizarComentarios, { enviados: 0 });
    const revisiones = await etapa('revisiones', sincronizarRevisiones, { enviadas: 0 });
    const estrategias = await etapa('estrategias', sincronizarEstrategias, { enviadas: 0 });

    // `sincronizarCalendar` atrapa el error de CADA visita por separado —a propósito, para que
    // una sola falle sin frenar a las demás— así que nunca lanza y `etapa()` nunca la ve
    // fallida, aunque las 30 visitas de alguien hayan fallado las 30. Sin esto, un problema de
    // fondo (API de Calendar sin habilitar, scope faltante, token sin permisos) queda invisible
    // para siempre: ni el chip de sync se pone en rojo, ni el toast de "algunas partes no se
    // sincronizaron" aparece — solo queda un `console.error` por visita que nadie ve.
    if (calendar.fallidos > 0 && calendar.creados === 0 && calendar.borrados === 0) {
        errores.calendar = `${calendar.fallidos} visita(s) no se pudieron reflejar en Google Calendar`;
    }

    const resultado = { visitas, evidencias, calendar, eventos, comentarios, revisiones, estrategias };
    if (Object.keys(errores).length > 0) resultado.errores = errores;
    return resultado;
}
