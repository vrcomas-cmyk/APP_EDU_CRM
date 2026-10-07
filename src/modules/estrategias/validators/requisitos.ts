/**
 * Qué exige una estrategia para poder guardarse.
 *
 * Solo el cliente es fijo: una estrategia sin cliente no es de nadie. Lo demás lo decide
 * Administración (Formularios → Estrategia), y por defecto nada más es obligatorio — igual que
 * antes de que fuera configurable.
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
    if (esRequeridoEn('estrategia', 'sector') && !lleno(d.sector)) falta.push('Sector');
    if (esRequeridoEn('estrategia', 'grupo_articulo') && !lleno(d.grupo)) falta.push('Grupo de artículo');
    if (esRequeridoEn('estrategia', 'tipo') && !lleno(d.tipo)) falta.push('Estrategia');
    if (esRequeridoEn('estrategia', 'etapa') && !lleno(d.etapa)) falta.push('Etapa');
    if (esRequeridoEn('estrategia', 'proyecto') && !lleno(d.proyecto)) falta.push('Proyecto / objetivo');
    if (esRequeridoEn('estrategia', 'productos') && d.productos.length === 0) falta.push('Productos');
    if (esRequeridoEn('estrategia', 'observaciones') && !lleno(d.observaciones)) falta.push('Observaciones');

    return falta;
}
