/**
 * Acciones de negocio sobre una visita.
 *
 * Viven aquí y no en el drawer porque las reglas no son de la pantalla: no puede haber
 * check-out sin check-in ni dos check-ins, y eso debe ser cierto lo abra quien lo abra.
 * Cada acción devuelve { ok, error } en vez de lanzar: el que la llama decide cómo avisar.
 */

import { obtenerVisita, actualizarVisita, nuevoId } from './storage.js';
import { ESTADOS, estadoDe, tieneCheckIn, tieneCheckOut, permanenciaMinutos } from './estado.js';
import { obtenerUbicacion, describirDispositivo } from './geo.js';
import { registrar, TIPOS } from './eventos.js';

const ok = (datos = {}) => ({ ok: true, ...datos });
const error = (msg) => ({ ok: false, error: msg });

// ---------- check-in ----------

export async function iniciarVisita(id) {
    const visita = obtenerVisita(id);
    if (!visita) return error('La visita ya no existe.');
    if (estadoDe(visita) === ESTADOS.CANCELADA) return error('Esta visita está cancelada.');
    // Un segundo check-in reescribiría la hora real de llegada, que es justo lo que prueba.
    if (tieneCheckIn(visita)) return error('Esta visita ya tiene check-in.');

    // El GPS no bloquea: si no hay señal, se registra igual y queda constancia de por qué no.
    const ubicacion = await obtenerUbicacion();

    const check = {
        momento: new Date().toISOString(),
        usuario: visita.educador || '',
        usuario_correo: visita.educador_correo || '',
        dispositivo: describirDispositivo(),
        ...ubicacion
    };

    const actualizada = actualizarVisita(id, v => {
        v.check_in = check;
        v.estado = ESTADOS.EN_PROCESO;
    });

    registrar(TIPOS.CHECK_IN, actualizada, {
        momento: check.momento,
        lat: check.lat ?? '', lng: check.lng ?? '',
        precision_m: check.precision_m ?? '',
        sin_ubicacion: check.error || ''
    });

    return ok({ visita: actualizada, ubicacion });
}

// ---------- check-out ----------

export async function finalizarVisita(id) {
    const visita = obtenerVisita(id);
    if (!visita) return error('La visita ya no existe.');
    if (estadoDe(visita) === ESTADOS.CANCELADA) return error('Esta visita está cancelada.');
    if (!tieneCheckIn(visita)) return error('Primero hay que iniciar la visita.');
    if (tieneCheckOut(visita)) return error('Esta visita ya está finalizada.');

    const ubicacion = await obtenerUbicacion();

    const check = {
        momento: new Date().toISOString(),
        usuario: visita.educador || '',
        usuario_correo: visita.educador_correo || '',
        ...ubicacion
    };

    const actualizada = actualizarVisita(id, v => {
        v.check_out = check;
        v.estado = ESTADOS.FINALIZADA;
    });

    const minutos = permanenciaMinutos(actualizada);

    // Dos eventos, no uno: el check-out es el hecho físico (salí del hospital) y la
    // finalización es el hecho de negocio. Coinciden hoy, pero no tienen por qué siempre.
    registrar(TIPOS.CHECK_OUT, actualizada, {
        momento: check.momento,
        lat: check.lat ?? '', lng: check.lng ?? '',
        precision_m: check.precision_m ?? '',
        sin_ubicacion: check.error || ''
    });
    registrar(TIPOS.VISITA_FINALIZADA, actualizada, { permanencia_min: minutos ?? '' });

    return ok({ visita: actualizada, ubicacion, permanencia_min: minutos });
}

// ---------- reagendar ----------

/**
 * No se edita la fecha: se reagenda, y queda el rastro de qué cambió, quién y por qué.
 * Un campo que se puede editar en silencio borra su propia historia.
 */
export function reagendarVisita(id, { dia, hora_inicio, hora_fin, motivo }) {
    const visita = obtenerVisita(id);
    if (!visita) return error('La visita ya no existe.');
    if (estadoDe(visita) === ESTADOS.CANCELADA) return error('Esta visita está cancelada.');
    if (tieneCheckOut(visita)) return error('Una visita finalizada no se reagenda.');
    if (!motivo || !motivo.trim()) return error('El motivo del cambio es obligatorio.');

    const antes = { dia: visita.dia, hora_inicio: visita.hora_inicio, hora_fin: visita.hora_fin };
    const despues = {
        dia: dia || visita.dia,
        hora_inicio: hora_inicio || visita.hora_inicio,
        hora_fin: hora_fin || visita.hora_fin
    };

    if (antes.dia === despues.dia && antes.hora_inicio === despues.hora_inicio
        && antes.hora_fin === despues.hora_fin) {
        return error('No cambiaste la fecha ni el horario.');
    }

    const entrada = {
        id: nuevoId('r'),
        momento: new Date().toISOString(),
        usuario: visita.educador || '',
        motivo: motivo.trim(),
        antes, despues
    };

    const actualizada = actualizarVisita(id, v => {
        v.dia = despues.dia;
        v.hora_inicio = despues.hora_inicio;
        v.hora_fin = despues.hora_fin;
        v.reagendas = [...(v.reagendas || []), entrada];
    });

    registrar(TIPOS.VISITA_REAGENDADA, actualizada, {
        motivo: entrada.motivo,
        antes: `${antes.dia} ${antes.hora_inicio}–${antes.hora_fin}`,
        despues: `${despues.dia} ${despues.hora_inicio}–${despues.hora_fin}`
    });

    return ok({ visita: actualizada });
}

// ---------- cancelar ----------

/**
 * Cancelar no borra: la visita existió y no ocurrió, y eso es información. Además, una
 * cancelada no puede pintarse de rojo — no se te pasó nada.
 */
export function cancelarVisita(id, motivo) {
    const visita = obtenerVisita(id);
    if (!visita) return error('La visita ya no existe.');
    if (estadoDe(visita) === ESTADOS.CANCELADA) return error('Ya está cancelada.');
    if (tieneCheckOut(visita)) return error('Una visita finalizada no se cancela.');

    const actualizada = actualizarVisita(id, v => {
        v.estado = ESTADOS.CANCELADA;
        v.motivo_cancelacion = (motivo || '').trim();
    });

    registrar(TIPOS.VISITA_CANCELADA, actualizada, { motivo: actualizada.motivo_cancelacion });
    return ok({ visita: actualizada });
}

export function reactivarVisita(id) {
    const visita = obtenerVisita(id);
    if (!visita) return error('La visita ya no existe.');
    if (estadoDe(visita) !== ESTADOS.CANCELADA) return error('Esta visita no está cancelada.');

    const actualizada = actualizarVisita(id, v => {
        // El estado al que vuelve depende de lo que ya pasó, no de lo que estaba antes.
        v.estado = v.check_out ? ESTADOS.FINALIZADA : (v.check_in ? ESTADOS.EN_PROCESO : ESTADOS.PROGRAMADA);
        delete v.motivo_cancelacion;
    });
    return ok({ visita: actualizada });
}

// ---------- guardas para la captura ----------

/**
 * Por qué NO se puede registrar una actividad. Devuelve null si sí se puede.
 * La captura sigue abierta después del check-out a propósito: el check-out marca el fin de
 * la presencia física, no el de la captura. Nadie termina de escribir mientras se despide.
 */
export function bloqueoParaActividades(visita) {
    if (!visita) return 'La visita ya no existe.';
    if (estadoDe(visita) === ESTADOS.CANCELADA) return 'Esta visita está cancelada.';
    if (!tieneCheckIn(visita)) return 'Inicia la visita para registrar actividades.';
    return null;
}

export function puedeIniciar(visita) {
    return !!visita && estadoDe(visita) !== ESTADOS.CANCELADA && !tieneCheckIn(visita)
        && !!visita.cliente?.trim();
}

export function puedeFinalizar(visita) {
    return !!visita && estadoDe(visita) !== ESTADOS.CANCELADA
        && tieneCheckIn(visita) && !tieneCheckOut(visita);
}
