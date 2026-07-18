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
import { sesionActual } from './auth.js';

export const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyRdGq_Tef6GGg8MWr7_VNLS-VLvx439MTWPpmjJQ3kjXk_6OvtrFc19ehh7_GoVBZZ/exec";


/**
 * text/plain evita el preflight OPTIONS, que Apps Script no responde. No cambiar a
 * application/json: rompe la sincronización aunque el body siga siendo JSON.
 *
 * El id_token va en el BODY, no en un header Authorization: un header dispararía el mismo
 * preflight que se está evitando. El servidor es quien de verdad lo valida (ver Codigo.gs);
 * aquí solo se manda el que haya en caché, aunque ya esté vencido — el servidor lo rechaza
 * con un mensaje claro y la fila queda pendiente para el siguiente sync.
 */
async function postear(cuerpo) {
    const sesion = sesionActual();
    const respuesta = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...cuerpo, id_token: sesion?.id_token || '' })
    });

    if (!respuesta.ok) throw new Error(`Respuesta del servidor: ${respuesta.status}`);

    const resultado = await respuesta.json().catch(() => null);
    if (resultado && resultado.status === 'error') {
        throw new Error(resultado.message || 'Apps Script reportó un error');
    }
    return resultado;
}

// ---------- catálogos ----------

export async function descargarCatalogo() {
    const respuesta = await fetch(GOOGLE_SCRIPT_URL);
    if (!respuesta.ok) throw new Error(`Error al descargar catálogos: ${respuesta.status}`);

    const datos = await respuesta.json();
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

/** Orden importante: primero las filas, luego los archivos, y al final se reenvían las URLs. */
export async function sincronizarTodo() {
    const visitas = await sincronizarVisitas();
    const evidencias = await subirEvidenciasPendientes();
    if (evidencias.subidas > 0) await sincronizarVisitas();
    const eventos = await sincronizarEventos();
    return { visitas, evidencias, eventos };
}
