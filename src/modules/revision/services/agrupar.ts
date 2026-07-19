/**
 * Cómo se agrupa la cola de revisión. Sin estado y sin DOM, igual que `formato.ts`: la
 * pregunta que resuelve es de dominio ("¿a qué grupo pertenece este pendiente?"), no de pintar.
 *
 * Educador y semana se pueden combinar: una bandeja de veinte elementos se revisa distinto si
 * se quiere ver "todo lo de esta persona" o "todo lo de esta semana", y a veces las dos cosas
 * a la vez ("lo de Ana de esta semana"). Por eso son dos interruptores independientes y no un
 * único selector.
 */

import { claveDia, desdeClave, etiquetaRangoSemana, inicioSemana } from '@core/puente';
import type { PendienteRevision } from '@core/tipos';

export interface CriteriosAgrupacion {
    educador: boolean;
    semana: boolean;
}

export const SIN_AGRUPAR: CriteriosAgrupacion = { educador: false, semana: false };

export interface GrupoPendientes {
    clave: string;
    etiqueta: string;
    items: PendienteRevision[];
}

function claveEducador(item: PendienteRevision): { clave: string; etiqueta: string } {
    const etiqueta = item.educador || item.educador_correo || 'Sin educador';
    return { clave: (item.educador_correo || etiqueta).toLowerCase(), etiqueta };
}

/** Semana de trabajo (lunes a domingo) a la que pertenece el día de la visita. */
function claveSemana(item: PendienteRevision): { clave: string; etiqueta: string } {
    const dia = item.visita.dia;
    if (!dia) return { clave: '0000-00-00', etiqueta: 'Sin fecha' };

    const lunes = inicioSemana(desdeClave(dia));
    return { clave: claveDia(lunes), etiqueta: etiquetaRangoSemana(lunes) };
}

/**
 * Agrupa los pendientes según los criterios activos. Sin ninguno, es un solo grupo sin
 * etiqueta —la lista de siempre—, para que activar y desactivar agrupación no cambie nada más
 * que el encabezado.
 */
export function agruparPendientes(
    pendientes: PendienteRevision[],
    criterios: CriteriosAgrupacion
): GrupoPendientes[] {
    if (!criterios.educador && !criterios.semana) {
        return pendientes.length ? [{ clave: '_todos', etiqueta: '', items: pendientes }] : [];
    }

    const grupos = new Map<string, GrupoPendientes>();

    for (const item of pendientes) {
        const partes: string[] = [];
        const etiquetas: string[] = [];

        // Semana primero: es el eje que más importa para priorizar el trabajo atrasado.
        if (criterios.semana) {
            const { clave, etiqueta } = claveSemana(item);
            partes.push(clave);
            etiquetas.push(etiqueta);
        }
        if (criterios.educador) {
            const { clave, etiqueta } = claveEducador(item);
            partes.push(clave);
            etiquetas.push(etiqueta);
        }

        const clave = partes.join('::');
        if (!grupos.has(clave)) grupos.set(clave, { clave, etiqueta: etiquetas.join(' · '), items: [] });
        grupos.get(clave)!.items.push(item);
    }

    const salida = [...grupos.values()];

    // Con semana de por medio, lo reciente primero (la clave es la fecha del lunes, ordena
    // igual como texto que como fecha). Solo por educador, alfabético: no hay "reciente" que
    // priorizar y Z→A leería raro.
    return criterios.semana
        ? salida.sort((a, b) => b.clave.localeCompare(a.clave))
        : salida.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));
}
