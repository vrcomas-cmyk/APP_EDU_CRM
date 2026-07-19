/**
 * Qué se ofrece al escribir en la paleta.
 *
 * Sin estado y sin DOM: es la única parte con decisiones de verdad, y así se puede probar sin
 * montar nada.
 */

import { inicioDe } from '@core/puente';
import type { Visita } from '@core/tipos';

export const MAX_RESULTADOS = 8;

/**
 * UN resultado por cliente, no uno por visita.
 *
 * Buscar «Hospital X» y ver la misma fila repetida diez veces no ayuda a llegar a ningún lado:
 * obliga a leer diez fechas para elegir, que es justo el trabajo que la paleta debería quitar.
 *
 * Se prefiere la próxima visita FUTURA —a la que probablemente se quiere saltar— y, si no hay
 * ninguna por venir, la más reciente que ya pasó.
 */
export function resultadosPorCliente(
    visitas: Visita[], consulta: string, ahora: Date = new Date()
): Visita[] {
    const q = consulta.trim().toLowerCase();
    if (!q) return [];

    const porCliente = new Map<string, { visita: Visita; ini: Date | null }>();

    for (const v of visitas) {
        const texto = `${v.cliente || ''} ${v.hospital || ''}`.toLowerCase();
        if (!texto.includes(q)) continue;

        // El id como último recurso: una visita sin cliente ni hospital sigue siendo algo a lo
        // que saltar, y agruparlas todas bajo la misma clave vacía escondería todas menos una.
        const clave = v.cliente || v.hospital || v.id;
        const ini = inicioDe(v);
        const actual = porCliente.get(clave);

        if (!actual) {
            porCliente.set(clave, { visita: v, ini });
            continue;
        }
        if (esMejor(ini, actual.ini, ahora)) porCliente.set(clave, { visita: v, ini });
    }

    return [...porCliente.values()]
        .sort(porFecha)
        .slice(0, MAX_RESULTADOS)
        .map(x => x.visita);
}

/** ¿`candidata` representa mejor a este cliente que `actual`? */
function esMejor(candidata: Date | null, actual: Date | null, ahora: Date): boolean {
    // Una visita sin fecha no puede desbancar a ninguna: no se sabe si ya pasó.
    if (!candidata) return false;

    const actualEsFutura = !!actual && actual >= ahora;
    const candidataEsFutura = candidata >= ahora;

    // Lo que viene le gana a lo que pasó; entre dos futuras, la más próxima.
    if (candidataEsFutura) return !actualEsFutura || candidata < actual!;

    // Entre dos pasadas, la más reciente. Una futura no se cambia por una pasada.
    if (actualEsFutura) return false;
    return !actual || candidata > actual;
}

/**
 * Las que tienen fecha van en orden cronológico; las que no, al final.
 *
 * Antes iban al principio —`(a.ini || 0)` convierte el nulo en 1970— y una visita a la que le
 * falta la hora se colaba por encima de la de mañana.
 */
function porFecha(
    a: { ini: Date | null }, b: { ini: Date | null }
): number {
    if (!a.ini && !b.ini) return 0;
    if (!a.ini) return 1;
    if (!b.ini) return -1;
    return a.ini.getTime() - b.ini.getTime();
}
