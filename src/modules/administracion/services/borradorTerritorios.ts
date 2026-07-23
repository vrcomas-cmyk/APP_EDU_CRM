/**
 * El borrador de Territorios (titulares de zona + coberturas): cómo se arma, cómo se valida y
 * cómo se traduce a lo que espera `guardarTerritorios`.
 *
 * Igual que Accesos, `leerTerritorios` es una ida de red — el borrador se materializa cuando
 * esa respuesta llega (ver `useTerritorios`).
 */

import type { BorradorTerritorios, CoberturaZona, TitularZona } from '@core/tipos';

export const VACIO_TERRITORIOS: BorradorTerritorios = { titulares: [], coberturas: [] };

// ---------- titulares ----------

/** Asigna (o cambia) el titular de una zona. Una zona, un titular: upsert por zona. */
export function conTitular(titulares: TitularZona[], zona: string, correo: string): TitularZona[] {
    const i = titulares.findIndex(t => t.zona === zona);
    if (i === -1) return [...titulares, { zona, educador_correo: correo }];
    return titulares.map((t, idx) => (idx === i ? { ...t, educador_correo: correo } : t));
}

/** Deja la zona sin titular (no la borra del catálogo de zonas, solo de la asignación). */
export function sinTitular(titulares: TitularZona[], zona: string): TitularZona[] {
    return titulares.filter(t => t.zona !== zona);
}

// ---------- coberturas ----------

/**
 * Una cobertura nueva, todavía sin guardar. El id temporal (prefijo `nueva-`) es lo que
 * distingue "esto hay que crearlo" de "esto ya existe" al calcular qué mandar a
 * `agregar_cobertura` — un uuid real de Supabase nunca empieza así.
 */
export function coberturaNueva(): CoberturaZona {
    return {
        id: `nueva-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        zona: '', educador_correo: '', desde: new Date().toISOString().slice(0, 10),
        hasta: null, motivo: null
    };
}

export function esCoberturaNueva(c: CoberturaZona): boolean {
    return c.id.startsWith('nueva-');
}

export function conCobertura(
    coberturas: CoberturaZona[], id: string, cambios: Partial<CoberturaZona>
): CoberturaZona[] {
    return coberturas.map(c => (c.id === id ? { ...c, ...cambios } : c));
}

export function sinCobertura(coberturas: CoberturaZona[], id: string): CoberturaZona[] {
    return coberturas.filter(c => c.id !== id);
}

/** Qué impide guardar. Devuelve TODOS los problemas, no el primero. */
export function problemasDeTerritorios(b: BorradorTerritorios): string[] {
    const problemas: string[] = [];
    const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    if (b.titulares.some(t => !correoValido.test(t.educador_correo.trim()))) {
        problemas.push('hay una zona con un correo de titular que no parece válido');
    }
    const zonasTitular = b.titulares.map(t => t.zona);
    if (new Set(zonasTitular).size !== zonasTitular.length) {
        problemas.push('hay dos titulares para la misma zona');
    }

    for (const c of b.coberturas) {
        if (!c.zona.trim()) { problemas.push('hay una cobertura sin zona'); break; }
    }
    for (const c of b.coberturas) {
        if (!correoValido.test(c.educador_correo.trim())) {
            problemas.push('hay una cobertura con un correo que no parece válido');
            break;
        }
    }
    for (const c of b.coberturas) {
        if (c.hasta && c.hasta < c.desde) {
            problemas.push('hay una cobertura que termina antes de empezar');
            break;
        }
    }

    return problemas;
}

// ---------- payload para el servidor ----------

/**
 * Titulares a asignar y zonas a quitar. Se reenvían TODOS los titulares actuales
 * (`pdt_zona_asignar` hace upsert) y se listan para quitar las zonas que estaban en la carga
 * original y ya no tienen titular en la lista de trabajo.
 */
export function titularesParaGuardar(original: TitularZona[], actual: TitularZona[]) {
    const zonasActuales = new Set(actual.map(t => t.zona));
    const quitarZona = original.filter(t => !zonasActuales.has(t.zona)).map(t => t.zona);

    const asignar = actual.map(t => ({
        zona: t.zona, educador_correo: t.educador_correo.trim().toLowerCase()
    }));

    return { asignar, quitarZona };
}

/**
 * Coberturas a agregar (las nuevas) y a quitar (las que estaban y ya no están). Una cobertura
 * ya existente no se "edita": para cambiarla se quita y se agrega otra — son un registro de
 * quién autorizó qué, no un dato que se corrija en el sitio.
 */
export function coberturasParaGuardar(original: CoberturaZona[], actual: CoberturaZona[]) {
    const agregarCobertura = actual.filter(esCoberturaNueva).map(c => ({
        zona: c.zona, educador_correo: c.educador_correo.trim().toLowerCase(),
        desde: c.desde || null, hasta: c.hasta || null, motivo: c.motivo?.trim() || null
    }));

    const idsActuales = new Set(actual.map(c => c.id));
    const quitarCobertura = original
        .filter(c => !esCoberturaNueva(c) && !idsActuales.has(c.id))
        .map(c => c.id);

    return { agregarCobertura, quitarCobertura };
}
