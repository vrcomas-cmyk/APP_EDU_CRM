/**
 * La matemática de los tres gestos del calendario.
 *
 * Está separada de los manejadores de puntero a propósito: lo que se equivoca en un arrastre
 * no es el evento, es el cálculo del rango resultante. Aquí se puede probar sin puntero.
 */

import {
    type Ventana, ajustarAMedia, redondearMedia, decimalAHora, horaADecimal
} from './ventana';

export interface Rango {
    inicio: string;
    fin: string;
}

/** Duración mínima de una visita creada arrastrando. Media hora es la unidad de la rejilla. */
const MINIMA_H = 0.5;

/**
 * Arrastrar sobre un hueco vacío: de dónde a dónde.
 *
 * Admite arrastre hacia arriba —se ordenan los extremos— porque nadie decide el sentido del
 * gesto antes de empezarlo.
 */
export function rangoDeCreacion(horaInicial: number, horaActual: number, v: Ventana): Rango {
    const [desde, hasta] = horaInicial <= horaActual
        ? [horaInicial, horaActual]
        : [horaActual, horaInicial];

    const inicio = ajustarAMedia(desde, v);
    const fin = ajustarAMedia(Math.max(hasta, desde + MINIMA_H), v, { esFin: true });

    // Contra el borde inferior de la rejilla ambos extremos pueden colapsar en el mismo valor.
    // Devolver un rango de duración cero crearía una visita imposible de ver y de guardar.
    if (fin <= inicio) {
        const iniDec = horaADecimal(inicio);
        return {
            inicio: ajustarAMedia(iniDec - MINIMA_H, v),
            fin: ajustarAMedia(iniDec, v, { esFin: true })
        };
    }

    return { inicio, fin };
}

/**
 * Mover una visita: se desplaza CONSERVANDO la duración.
 *
 * Arrastrar el cuerpo de una tarjeta corre la visita; no la estira. Para cambiar la duración
 * está la manija inferior, que es un gesto distinto sobre un objetivo distinto.
 */
export function rangoDeMovimiento(
    inicioOriginal: string | undefined,
    duracionH: number,
    desplazamientoPx: number,
    altoDeHoraPx: number
): Rango {
    const nuevoInicio = redondearMedia(horaADecimal(inicioOriginal) + desplazamientoPx / altoDeHoraPx);
    return {
        inicio: decimalAHora(nuevoInicio),
        fin: decimalAHora(nuevoInicio + duracionH)
    };
}

/**
 * Redimensionar: solo se mueve el fin, y nunca por debajo de media hora.
 *
 * Sin el piso, arrastrar la manija hacia arriba produciría duraciones de cero o negativas, y
 * una tarjeta de altura cero deja de poder agarrarse: la visita quedaría inalcanzable.
 */
export function nuevoFinPorRedimension(
    inicio: string | undefined,
    duracionOriginalH: number,
    desplazamientoPx: number,
    altoDeHoraPx: number
): { fin: string; duracionH: number } {
    const duracionH = Math.max(MINIMA_H, redondearMedia(duracionOriginalH + desplazamientoPx / altoDeHoraPx));
    return { fin: decimalAHora(horaADecimal(inicio) + duracionH), duracionH };
}

/** ¿El puntero se movió lo suficiente para que esto sea un arrastre y no un clic? */
export function esArrastre(dx: number, dy: number, umbral: number): boolean {
    return Math.hypot(dx, dy) >= umbral;
}
