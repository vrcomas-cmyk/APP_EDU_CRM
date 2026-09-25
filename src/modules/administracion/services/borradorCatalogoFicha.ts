/**
 * El borrador de un catálogo ficha+activo genérico (clave, nombre, descripción, activo, orden,
 * conteo de uso) — el mismo patrón de `borradorFlujos.ts` sin los veredictos, que hoy usan
 * los catálogos de Estrategia (Tipos y Etapas). Se comparte en vez de duplicarse porque las
 * únicas diferencias entre esos dos catálogos están en el texto y en a qué RPC llaman, no en
 * cómo se edita una fila.
 */

import type { CatalogoFicha } from '@core/tipos';

export function fichaNueva(): CatalogoFicha {
    return { clave: '', nombre: '', descripcion: '', activo: true, orden: 0, usos: 0 };
}

export function conCampoFicha<K extends keyof CatalogoFicha>(
    f: CatalogoFicha, campo: K, valor: CatalogoFicha[K]
): CatalogoFicha {
    return { ...f, [campo]: valor };
}

/** Qué impide guardar el catálogo. `etiqueta` es el nombre del catálogo, para el mensaje. */
export function problemasDeFichas(fichas: CatalogoFicha[], etiqueta: string): string[] {
    const problemas: string[] = [];

    if (fichas.some(f => !f.clave.trim())) {
        problemas.push(`hay ${etiqueta === 'etapa' ? 'una' : 'un'} ${etiqueta} sin clave`);
    }
    if (fichas.some(f => f.clave.trim() && !/^[a-z][a-z0-9_]*$/.test(f.clave.trim()))) {
        problemas.push(`hay una clave de ${etiqueta} con mayúsculas, espacios o acentos`);
    }

    const claves = fichas.map(f => f.clave.trim().toLowerCase());
    if (new Set(claves).size !== claves.length) {
        problemas.push(`hay dos ${etiqueta}s con la misma clave`);
    }

    if (fichas.some(f => !f.nombre.trim())) {
        problemas.push(`hay ${etiqueta === 'etapa' ? 'una' : 'un'} ${etiqueta} sin nombre`);
    }

    return problemas;
}

/**
 * Fichas a enviar y claves a borrar. Se reenvían TODAS las actuales —el RPC hace upsert— y se
 * listan para borrar las que estaban en la carga original y ya no están en la lista de trabajo.
 */
export function fichasParaGuardar(original: CatalogoFicha[], actual: CatalogoFicha[]) {
    const clavesActuales = new Set(actual.map(f => f.clave));
    const eliminar = original
        .filter(f => !clavesActuales.has(f.clave))
        .map(f => f.clave);

    const fichas = actual.map(f => ({
        clave: f.clave.trim().toLowerCase(),
        nombre: f.nombre.trim(),
        descripcion: f.descripcion?.trim() || null,
        activo: f.activo,
        orden: f.orden
    }));

    return { fichas, eliminar };
}
