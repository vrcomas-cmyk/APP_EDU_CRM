/**
 * Eliminar una evidencia ya subida: la pide el educador, la autoriza su jefe a cargo.
 *
 * Una evidencia subida es un registro que otros ya pudieron ver y revisar; quitarla sin que nadie
 * lo sepa borraría justo lo que se audita. El archivo NO se borra en el servidor: queda marcado
 * como eliminado y la actividad vuelve a deber su evidencia (ver
 * `supabase/migrations/20261109c_pdt_evidencia_eliminacion.sql`).
 *
 * Aquí vive la copia en memoria de las solicitudes que esta sesión puede ver (las propias y las
 * que le toca autorizar) y las tres acciones. Mismo molde que `avisos.js`.
 */

import { rpc, rpcEstricto } from '../src/services/supabase/rpc';
import { sesionActual } from './auth.js';
import { leerVisitas, guardarVisitas, borrarArchivo } from './storage.js';

let lista = null;

function anunciar() {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pdt:eliminaciones'));
}

export function solicitudesEliminacion() { return lista || []; }

/** La solicitud abierta de esta evidencia, si la hay. */
export function solicitudAbiertaDe(idActividad) {
    return (lista || []).find(s => s.id_actividad === idActividad && s.estado === 'pendiente') || null;
}

/** Las que le toca decidir a esta sesión (no son suyas y las tiene a cargo, o es administrador). */
export function solicitudesPorResolver() {
    return (lista || []).filter(s => s.puedo_resolver);
}

export function olvidarSolicitudes() {
    lista = null;
    anunciar();
}

/**
 * Baja las solicitudes y aplica las que ya se aprobaron a ESTE dispositivo: si el servidor ya
 * eliminó la evidencia, la copia local deja de decir «subida». Devuelve true si algo cambió, para
 * que quien llama repinte. Nunca lanza: es información adicional, no puede romper la pantalla.
 */
export async function descargarSolicitudes() {
    if (!navigator.onLine) return false;
    const token = sesionActual()?.sesion_token;
    if (!token) return false;

    const recibidas = await rpc('pdt_evidencia_solicitudes_sesion', { p_sesion_token: token });
    if (!Array.isArray(recibidas)) return false;

    const antes = JSON.stringify(lista);
    lista = recibidas;
    const cambioLocal = aplicarAprobadas(recibidas);
    const cambio = cambioLocal || antes !== JSON.stringify(lista);
    if (cambio) anunciar();
    return cambio;
}

/**
 * Restablece la evidencia local de lo ya aprobado. Solo si la copia local es ANTERIOR a la
 * aprobación: si después se adjuntó otra, esa es la nueva y no se toca.
 */
function aplicarAprobadas(solicitudes) {
    const miCorreo = String(sesionActual()?.correo || '').toLowerCase();
    const aprobadas = solicitudes.filter(
        s => s.estado === 'aprobada' && String(s.solicitante_correo || '').toLowerCase() === miCorreo
    );
    if (aprobadas.length === 0) return false;

    const visitas = leerVisitas();
    let cambio = false;

    for (const s of aprobadas) {
        for (const visita of visitas) {
            for (const sector of visita.sectores || []) {
                const act = (sector.actividades || []).find(a => a.id === s.id_actividad);
                if (!act || act.evidencia?.estado !== 'subida') continue;
                const adjuntada = act.evidencia.adjuntada || '';
                if (adjuntada && s.resuelto_en && adjuntada > s.resuelto_en) continue;

                act.evidencia = {
                    ...act.evidencia, estado: 'pendiente', nombre: '', mime: '', url: '',
                    adjuntada: undefined, ultimo_error: undefined, intentos: undefined, ultimo_intento: undefined
                };
                visita.sincronizado = false;
                borrarArchivo(act.id).catch(() => {});
                cambio = true;
            }
        }
    }
    if (cambio) guardarVisitas(visitas);
    return cambio;
}

/** El educador pide eliminar su evidencia. Lanza con el motivo legible si no se pudo. */
export async function solicitarEliminacion(idActividad, motivo) {
    const limpio = String(motivo || '').trim();
    if (limpio.length < 5) throw new Error('Explica por qué se elimina (al menos 5 caracteres).');
    await rpcEstricto('pdt_evidencia_solicitar_eliminacion_sesion', {
        p_sesion_token: sesionActual()?.sesion_token || '',
        p_id_actividad: idActividad,
        p_motivo: limpio
    });
    await descargarSolicitudes();
}

/** El jefe decide. Rechazar exige nota. Lanza con el motivo legible si no se pudo. */
export async function resolverEliminacion(id, aprobar, nota = '') {
    if (!aprobar && String(nota).trim().length < 3) throw new Error('Explica por qué se rechaza.');
    await rpcEstricto('pdt_evidencia_resolver_eliminacion_sesion', {
        p_sesion_token: sesionActual()?.sesion_token || '',
        p_id: id,
        p_aprobar: Boolean(aprobar),
        p_nota: String(nota || '').trim() || null
    });
    await descargarSolicitudes();
}
