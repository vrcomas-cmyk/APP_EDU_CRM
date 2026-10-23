/**
 * Captura de "Generar visita" por sector y grupo de artículo.
 *
 * Cada sector seleccionado tiene su propia tarjeta; si trabaja varios grupos de artículo, cada
 * grupo lleva su objetivo, solicitante y origen (con la opción de copiar el del grupo anterior).
 * La visita guarda UN objetivo / solicitante / origen por sector, así que al final se consolidan.
 * Funciones puras: sin almacenamiento ni React, para probar las reglas solas.
 */

import type { Estrategia } from '@core/tipos';

export interface DatosGrupo {
    objetivo: string;
    origen: string[];
    solicitado: string;
}

export const GRUPO_VACIO: DatosGrupo = { objetivo: '', origen: [], solicitado: '' };

/** Sin grupo de artículo el sector es una sola unidad de captura: la clave termina en '|'. */
export const claveGrupo = (sector: string, grupo?: string) => `${sector}|${grupo || ''}`;

export interface SectorACapturar {
    sector: string;
    /** Grupos distintos de las estrategias elegidas ('' = estrategia sin grupo). */
    grupos: string[];
}

export function sectoresACapturar(seleccionadas: Estrategia[]): SectorACapturar[] {
    const mapa = new Map<string, Set<string>>();
    for (const e of seleccionadas) {
        if (!e.sector) continue;
        mapa.set(e.sector, (mapa.get(e.sector) ?? new Set<string>()).add(e.grupo_articulo || ''));
    }
    return [...mapa.entries()].map(([sector, grupos]) => ({ sector, grupos: [...grupos] }));
}

const completo = (d?: DatosGrupo) =>
    !!d && d.objetivo.trim() !== '' && d.origen.length > 0 && d.solicitado.trim() !== '';

/** Un sector está completo cuando TODOS sus grupos tienen objetivo, origen y solicitado por. */
export function sectorCompleto(s: SectorACapturar, datos: Record<string, DatosGrupo>): boolean {
    return s.grupos.every(g => completo(datos[claveGrupo(s.sector, g)]));
}

/** Lo que falta, por sector: `[]` cuando ya se puede generar. */
export function faltantes(sectores: SectorACapturar[], datos: Record<string, DatosGrupo>): string[] {
    return sectores.filter(s => !sectorCompleto(s, datos)).map(s => s.sector);
}

const unicos = (xs: string[]) => [...new Set(xs.map(x => x.trim()).filter(Boolean))];

/**
 * Consolida lo capturado por grupo en lo que guarda la visita por sector. Con más de un grupo el
 * objetivo se antepone con el nombre del grupo; si es el mismo texto para todos, se escribe una vez.
 */
export function consolidarPorSector(sectores: SectorACapturar[], datos: Record<string, DatosGrupo>) {
    const objetivos: Record<string, string> = {};
    const origenes: Record<string, string[]> = {};
    const solicitados: Record<string, string> = {};

    for (const { sector, grupos } of sectores) {
        const filas = grupos.map(g => ({ grupo: g, d: datos[claveGrupo(sector, g)] ?? GRUPO_VACIO }));
        const textos = unicos(filas.map(f => f.d.objetivo));

        objetivos[sector] = filas.length === 1 || textos.length <= 1
            ? (textos[0] ?? '')
            : filas.filter(f => f.d.objetivo.trim())
                .map(f => (f.grupo ? `${f.grupo}: ${f.d.objetivo.trim()}` : f.d.objetivo.trim()))
                .join('; ');
        origenes[sector] = unicos(filas.flatMap(f => f.d.origen));
        solicitados[sector] = unicos(filas.map(f => f.d.solicitado)).join(', ');
    }
    return { objetivos, origenes, solicitados };
}
