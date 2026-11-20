/**
 * El borrador de Flujos de revisión: cómo se arma, cómo se valida y cómo se traduce a lo que
 * espera `guardarFlujosAdmin`. Mismo patrón que `borradorRBAC.ts` — el borrador sale de una ida
 * de red (`leerFlujos`), no de una caché local.
 */

import { criteriosPorDefecto } from '@core/puente';
import type { BorradorFlujos, CriterioRevision, FlujoAdmin, ResultadoFlujo } from '@core/tipos';

export const VACIO_FLUJOS: BorradorFlujos = { flujos: [] };

export function flujoNuevo(): FlujoAdmin {
    return {
        clave: '', nombre: '', descripcion: null, ambito: 'visita', permiso: '',
        activo: true, orden: 0, resultados: null, criterios: null, revisiones: 0
    };
}

export function conCampo<K extends keyof FlujoAdmin>(
    f: FlujoAdmin, campo: K, valor: FlujoAdmin[K]
): FlujoAdmin {
    return { ...f, [campo]: valor };
}

/** Un veredicto vacío, para que "+ Agregar veredicto" tenga algo que mostrar de inmediato. */
export function resultadoNuevo(): ResultadoFlujo {
    return {
        valor: '', etiqueta: '', accion: '', tono: 'completa', estilo: 'txt',
        exige_observaciones: false, acepta: true, cierra: true, avisa_educador: false
    };
}

/**
 * Activa/desactiva los "veredictos propios" de un flujo. Al activarlos por primera vez, arranca
 * con un veredicto en blanco en vez de una lista vacía —una lista vacía no se distingue de
 * "sigue usando los de siempre" en la UI, y el CHECK de la base tampoco la acepta—.
 */
export function conVeredictosPropios(f: FlujoAdmin, propios: boolean): FlujoAdmin {
    if (!propios) return { ...f, resultados: null };
    return { ...f, resultados: f.resultados && f.resultados.length ? f.resultados : [resultadoNuevo()] };
}

export function conResultado(f: FlujoAdmin, indice: number, campo: keyof ResultadoFlujo, valor: unknown): FlujoAdmin {
    if (!f.resultados) return f;
    const resultados = f.resultados.map((r, i) => (i === indice ? { ...r, [campo]: valor } : r));
    return { ...f, resultados };
}

export function conNuevoResultado(f: FlujoAdmin): FlujoAdmin {
    return { ...f, resultados: [...(f.resultados || []), resultadoNuevo()] };
}

export function sinResultado(f: FlujoAdmin, indice: number): FlujoAdmin {
    if (!f.resultados) return f;
    return { ...f, resultados: f.resultados.filter((_, i) => i !== indice) };
}

/**
 * Lo que llega del servidor, con `criterios` siempre presente: un servidor sin la migración no
 * manda el campo, y sin normalizar el borrador diferiría de «lo del servidor» y se vería un
 * choque con otro administrador que no existe.
 */
export function normalizarFlujos(flujos: FlujoAdmin[]): FlujoAdmin[] {
    return flujos.map(f => ({ ...f, criterios: f.criterios ?? null }));
}

// ---------- criterios: qué se revisa ----------

/** Una clave que no choca con las demás y no cambia aunque se renombre la etiqueta. */
function claveDeCriterio(): string {
    return 'c_' + Math.random().toString(36).slice(2, 8);
}

export function criterioNuevo(): CriterioRevision {
    return { clave: claveDeCriterio(), etiqueta: '' };
}

/**
 * Activa/desactiva los criterios propios. Al activarlos arranca con los de siempre del flujo, para
 * poder QUITAR los que sobran o RENOMBRAR los que no encajan en vez de escribir todo desde cero.
 * Al desactivar vuelve a «los de siempre» (null).
 */
export function conCriteriosPropios(f: FlujoAdmin, propios: boolean): FlujoAdmin {
    if (!propios) return { ...f, criterios: null };
    return { ...f, criterios: f.criterios ?? criteriosPorDefecto(f.clave) };
}

export function conCriterio(f: FlujoAdmin, indice: number, etiqueta: string): FlujoAdmin {
    if (!f.criterios) return f;
    return { ...f, criterios: f.criterios.map((c, i) => (i === indice ? { ...c, etiqueta } : c)) };
}

export function conNuevoCriterio(f: FlujoAdmin): FlujoAdmin {
    return { ...f, criterios: [...(f.criterios || []), criterioNuevo()] };
}

export function sinCriterio(f: FlujoAdmin, indice: number): FlujoAdmin {
    if (!f.criterios) return f;
    return { ...f, criterios: f.criterios.filter((_, i) => i !== indice) };
}

/** Qué impide guardar los flujos. Devuelve TODOS los problemas, no el primero. */
export function problemasDeFlujos(flujos: FlujoAdmin[]): string[] {
    const problemas: string[] = [];

    if (flujos.some(f => !f.clave.trim())) {
        problemas.push('hay un flujo sin clave');
    }
    if (flujos.some(f => f.clave.trim() && !/^[a-z][a-z0-9_]*$/.test(f.clave.trim()))) {
        problemas.push('hay una clave de flujo con mayúsculas, espacios o acentos');
    }

    const claves = flujos.map(f => f.clave.trim().toLowerCase());
    if (new Set(claves).size !== claves.length) {
        problemas.push('hay dos flujos con la misma clave');
    }

    if (flujos.some(f => !f.permiso.trim())) {
        problemas.push('hay un flujo sin permiso');
    }

    for (const f of flujos) {
        if (!f.resultados) continue;

        if (f.resultados.some(r => !r.valor.trim() || !r.etiqueta.trim())) {
            problemas.push(`el flujo "${f.clave || '(sin clave)'}" tiene un veredicto sin valor o sin etiqueta`);
        }
        const valores = f.resultados.map(r => r.valor.trim().toLowerCase()).filter(Boolean);
        if (new Set(valores).size !== valores.length) {
            problemas.push(`el flujo "${f.clave || '(sin clave)'}" tiene dos veredictos con el mismo valor`);
        }
    }

    for (const f of flujos) {
        if (!f.criterios) continue;
        if (f.criterios.some(c => !String(c.etiqueta || '').trim())) {
            problemas.push(`el flujo "${f.clave || '(sin clave)'}" tiene un criterio sin nombre`);
        }
    }

    return problemas;
}

/**
 * Flujos a enviar y flujos a borrar. Se reenvían TODOS los actuales —`pdt_flujo_guardar` hace
 * upsert— y se listan para borrar los que estaban en la carga original y ya no están en la
 * lista de trabajo. A diferencia de los roles, ningún flujo es "de sistema": todos se pueden
 * borrar mientras no tengan revisiones (esa guarda vive en el servidor).
 */
export function flujosParaGuardar(original: FlujoAdmin[], actual: FlujoAdmin[]) {
    const clavesActuales = new Set(actual.map(f => f.clave));
    const eliminar = original
        .filter(f => !clavesActuales.has(f.clave))
        .map(f => f.clave);

    const flujos = actual.map(f => ({
        clave: f.clave.trim().toLowerCase(),
        nombre: f.nombre,
        descripcion: f.descripcion,
        ambito: f.ambito,
        permiso: f.permiso.trim(),
        activo: f.activo,
        orden: f.orden,
        resultados: f.resultados,
        // Solo clave y etiqueta: lo que el revisor marcó (`ok`) nunca forma parte de la definición.
        criterios: f.criterios
            ? f.criterios.map(c => ({ clave: c.clave, etiqueta: String(c.etiqueta || '').trim() }))
            : null
    }));

    return { flujos, eliminar };
}
