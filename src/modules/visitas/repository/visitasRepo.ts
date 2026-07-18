/**
 * Repositorio de visitas.
 *
 * La única puerta a los datos de visitas. Hoy detrás hay localStorage (`js/storage.js`);
 * mañana puede haber Supabase y después DuckDB, y el resto de la app no debería enterarse.
 *
 * Mientras dura la migración esto es además la frontera de TIPOS: `js/storage.js` es
 * JavaScript sin anotar, así que todo lo que sale de ahí entra como `any`. Convertirlo aquí,
 * en un solo archivo, evita que el `any` se derrame por los componentes — que es como se
 * pierde la ventaja de haber migrado a TypeScript.
 */

import * as almacen from '../../../../js/storage.js';

import type { Visita } from '@core/tipos';

export function leerVisitas(): Visita[] {
    return almacen.leerVisitas() as Visita[];
}

export function obtenerVisita(id: string): Visita | null {
    return (almacen.obtenerVisita(id) ?? null) as Visita | null;
}

export function agregarVisita(visita: Visita): Visita {
    return almacen.agregarVisita(visita) as Visita;
}

/**
 * Aplica un cambio y marca la visita como pendiente de subir.
 *
 * Todo edit pasa por aquí. Si la marca de "sin sincronizar" se olvidara en algún camino
 * alterno, el cambio se quedaría para siempre en el teléfono sin que nadie lo note.
 */
export function actualizarVisita(id: string, mutador: (v: Visita) => void): Visita | null {
    return (almacen.actualizarVisita(id, mutador) ?? null) as Visita | null;
}

export function eliminarVisita(id: string): void {
    almacen.eliminarVisita(id);
}

export function nuevoId(prefijo: string): string {
    return almacen.nuevoId(prefijo) as string;
}

/** Hospitales ya escritos, del más usado al menos. Alimenta las sugerencias. */
export function historialHospitales(): string[] {
    return almacen.historialHospitales() as string[];
}

/** Clientes del catálogo descargado. Son ~11.5k: nunca se pintan todos. */
export function clientesDelCatalogo(): string[] {
    const cat = almacen.leerCatalogo() as { clientes?: string[] } | null;
    return Array.isArray(cat?.clientes) ? cat.clientes : [];
}
