/**
 * Cómo se rotula un campo según el modo que Administración le dio.
 *
 * Existe para que ningún formulario repita el "¿lleva asterisco?": un obligatorio se anuncia en
 * su etiqueta, no solo cuando falla el guardado.
 */

import { esRequeridoEn, esVisibleEn } from '@core/puente';
import type { IdFormulario } from '@core/tipos';

/** "Objetivo" o "Objetivo *" según el campo sea obligatorio en ese formulario. */
export function rotuloEn(formulario: IdFormulario, campoId: string, texto: string): string {
    return esRequeridoEn(formulario, campoId) ? `${texto} *` : texto;
}

export { esVisibleEn };
