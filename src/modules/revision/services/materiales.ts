/**
 * Cómo se lee un material en la revisión: qué es, cuánto y, sobre todo, de dónde salió.
 *
 * El origen (folio SAP de la mercancía sin cargo, o quién la entregó) es lo que permite rastrear
 * el material; quien revisa lo necesita a la vista y no solo el conteo. Si el tipo de actividad
 * lo pide y no se capturó, se dice "Sin origen" en vez de callar: es justo lo que hay que ver.
 */

import { configuracionCampos, MODOS } from '@core/puente';
import type { Actividad, Material } from '@core/tipos';

/** ¿Este tipo de actividad captura el origen del material? (Oculto = no aplica, no se señala.) */
export function pideOrigen(actividad: Actividad): boolean {
    return configuracionCampos(actividad.tipo).material_origen !== MODOS.OCULTO;
}

export function textoMaterial(m: Material, conOrigen: boolean): string {
    const cantidad = ` ×${m.cantidad ?? '—'}${m.unidad ? ` ${m.unidad}` : ''}`;
    const origen = (m.origen || '').trim();
    const sufijo = origen ? ` · Origen: ${origen}` : conOrigen ? ' · Sin origen' : '';
    return `${m.material || 'Sin nombre'}${cantidad}${sufijo}`;
}
