/**
 * Cómo se leen las revisiones. Sin estado y sin DOM: es lo que se puede probar sin montar nada.
 */

import { RESULTADOS } from '@core/puente';
import type { ResultadoRevision } from '@core/tipos';

/**
 * El color de un veredicto, en la misma cromía de salud que usan el calendario y el tablero.
 *
 * Aprobado y rechazado son verde y rojo, que es justo el par que no se distingue en
 * deuteranopía —por eso el resultado SIEMPRE va acompañado de su etiqueta en texto, y el punto
 * de color solo refuerza.
 */
export function tonoResultado(resultado: string): string {
    return {
        [RESULTADOS.APROBADO as string]: 'completa',
        [RESULTADOS.RECHAZADO as string]: 'sin-registrar',
        [RESULTADOS.CORRECCION as string]: 'faltan-evidencias'
    }[resultado] || 'neutra';
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
 * ¿Se puede mandar este veredicto?
 *
 * Rechazar o pedir corrección sin decir por qué deja al educador sin nada que hacer: sabe que
 * está mal, no qué arreglar. `revisar()` lo vuelve a comprobar —es la regla de negocio y vive
 * ahí—; esto solo permite avisar antes de pulsar.
 */
export function exigeObservaciones(resultado: ResultadoRevision): boolean {
    return resultado !== RESULTADOS.APROBADO;
}
