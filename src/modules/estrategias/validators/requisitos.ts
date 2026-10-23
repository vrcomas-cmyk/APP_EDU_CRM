/**
 * Qué exige una estrategia para poder guardarse.
 *
 * Cliente, Sector y Grupo de artículo son fijos: sin ellos la estrategia no dice dónde ni qué
 * se trabaja. Lo demás lo decide Administración (Formularios → Estrategia).
 */

import { esRequeridoEn } from '@core/puente';

export interface DatosEstrategia {
    cliente: string;
    sector: string;
    grupo: string;
    tipo: string;
    etapa: string;
    proyecto: string;
    productos: string[];
    observaciones: string;
}

const lleno = (v: string) => v.trim().length > 0;

/** Lo que falta, con el nombre que ve el usuario. `[]` cuando ya se puede guardar. */
export function faltaEnEstrategia(d: DatosEstrategia): string[] {
    const falta: string[] = [];

    if (!lleno(d.cliente)) falta.push('Cliente');
    if (!lleno(d.sector)) falta.push('Sector');
    if (!lleno(d.grupo)) falta.push('Grupo de artículo');
    if (esRequeridoEn('estrategia', 'tipo') && !lleno(d.tipo)) falta.push('Estrategia');
    if (esRequeridoEn('estrategia', 'etapa') && !lleno(d.etapa)) falta.push('Etapa');
    if (esRequeridoEn('estrategia', 'proyecto') && !lleno(d.proyecto)) falta.push('Proyecto / objetivo');
    if (esRequeridoEn('estrategia', 'productos') && d.productos.length === 0) falta.push('Productos');
    if (esRequeridoEn('estrategia', 'observaciones') && !lleno(d.observaciones)) falta.push('Observaciones');

    return falta;
}
