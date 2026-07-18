/**
 * Reglas del horario de una visita.
 *
 * Dos decisiones de producto que conviene no perder al reorganizar el código:
 *
 *   1. **El fin nunca se calcula solo.** Una capacitación de dos horas y una entrega de veinte
 *      minutos no duran igual, y rellenar el fin con un valor plausible hace que se acepte sin
 *      leerlo.
 *
 *   2. **Mover el inicio MUEVE el bloque.** Reagendar corre la visita conservando su duración;
 *      no la estira. Arrastrar el inicio de las 9:00 a las 11:00 en una visita de dos horas
 *      debe dar 11:00–13:00, no 11:00–11:00.
 */

const MINUTOS_POR_DEFECTO = 60;
const MAX_MINUTOS = 23 * 60 + 59;

/** 'HH:MM' → minutos desde medianoche. Una cadena vacía vale 0, no NaN. */
export function horaAMinutos(hora: string | undefined): number {
    const [h, m] = (hora || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/** Minutos → 'HH:MM', topado a 23:59 para no saltar de día. */
export function minutosAHora(min: number): string {
    const total = Math.max(0, Math.min(Math.round(min), MAX_MINUTOS));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function sumarMinutos(hora: string, min: number): string {
    return minutosAHora(horaAMinutos(hora) + min);
}

/**
 * Duración actual en minutos, o `null` si todavía no hay una que valga.
 *
 * Un horario incompleto o invertido no tiene duración: devolver 0 obligaría a quien llame a
 * distinguir "dura cero" de "no sé", y esa distinción se pierde en cuanto alguien la olvida.
 */
export function duracionMinutos(inicio?: string, fin?: string): number | null {
    if (!inicio || !fin) return null;
    const d = horaAMinutos(fin) - horaAMinutos(inicio);
    return d > 0 ? d : null;
}

export interface Rango {
    hora_inicio: string;
    hora_fin: string;
}

/**
 * Mueve el inicio conservando la duración.
 *
 * Cuando no hay duración previa que conservar —horario a medio capturar— se usa una hora. Ese
 * default sí es legítimo: no rellena un campo que el usuario deba decidir, solo evita dejar
 * un rango invertido después de un gesto que sí fue explícito.
 */
export function moverInicio(rango: Partial<Rango>, nuevoInicio: string): Rango {
    const duracion = duracionMinutos(rango.hora_inicio, rango.hora_fin) ?? MINUTOS_POR_DEFECTO;
    return { hora_inicio: nuevoInicio, hora_fin: sumarMinutos(nuevoInicio, duracion) };
}

export type ResultadoFin =
    | { ok: true; hora_fin: string }
    | { ok: false; error: string };

/**
 * Valida un fin nuevo contra el inicio actual.
 *
 * Rechazar en vez de corregir en silencio: mover la hora que el usuario NO tocó, para arreglar
 * la que sí tocó, produce un horario que nadie eligió y que se descubre tarde.
 */
export function cambiarFin(inicio: string | undefined, nuevoFin: string): ResultadoFin {
    if (!nuevoFin) return { ok: false, error: 'Falta la hora de término.' };

    if (horaAMinutos(nuevoFin) <= horaAMinutos(inicio)) {
        return { ok: false, error: 'La hora de fin debe ser posterior al inicio.' };
    }
    return { ok: true, hora_fin: nuevoFin };
}
