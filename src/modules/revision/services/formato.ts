/**
 * Cómo se leen las revisiones. Sin estado y sin DOM: es lo que se puede probar sin montar nada.
 */

import { resultadoDe } from '@core/puente';
import type { FlujoRevision, ResultadoFlujo } from '@core/tipos';

/**
 * El color de un veredicto, en la misma cromía de salud que usan el calendario y el tablero.
 *
 * Lo declara el propio resultado dentro de su flujo. Aprobado y rechazado son verde y rojo,
 * que es justo el par que no se distingue en deuteranopía —por eso el resultado SIEMPRE va
 * acompañado de su etiqueta en texto, y el punto de color solo refuerza.
 *
 * Un valor que el flujo ya no reconoce sale «neutra»: pintarlo del color de otro sería peor
 * que no pintarlo, porque un veredicto renombrado en la base saldría, por ejemplo, verde.
 */
export function tonoResultado(flujo: FlujoRevision | string, resultado: string): string {
    return resultadoDe(flujo, resultado)?.tono || 'neutra';
}

/** Cómo se lee un veredicto. Si el flujo ya no lo reconoce, se muestra tal cual se guardó. */
export function etiquetaResultado(flujo: FlujoRevision | string, resultado: string): string {
    return resultadoDe(flujo, resultado)?.etiqueta || resultado;
}

/** Fecha corta para metadatos. Una fecha ilegible se muestra como «—», no como `Invalid Date`. */
export function fechaCorta(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';

    return d.toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
}

/** «1 elemento» / «3 elementos». */
export function plural(n: number, singular: string, plural_: string): string {
    return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * ¿Este veredicto exige explicación?
 *
 * Mandar de vuelta un trabajo sin decir qué arreglar deja al educador sabiendo que algo está
 * mal y sin nada que hacer. `revisar()` lo vuelve a comprobar —es la regla de negocio y vive
 * ahí—; esto solo permite avisar antes de pulsar.
 */
export function exigeObservaciones(r: ResultadoFlujo): boolean {
    return r.exige_observaciones === true;
}

/** ¿Este veredicto saca el elemento de la cola, o lo devuelve a quien lo capturó? */
export function cierra(r: ResultadoFlujo): boolean {
    return r.cierra === true;
}
