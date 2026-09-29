/**
 * Qué estrategias avanza una visita.
 *
 * Una visita puede trabajar varias (una por sector, o varias en el mismo sector si son de grupos
 * de artículo distintos). El modelo guarda `ids_estrategias` y conserva `id_estrategia` con la
 * primera — lo leen Sheets, los indicadores y las visitas guardadas antes de esto. Funciones puras:
 * no tocan almacenamiento, para poder probar las reglas sin montar nada.
 */

import type { Actividad, Estrategia, Sector, Visita } from '@core/tipos';

type ConEstrategias = Pick<Visita, 'id_estrategia' | 'ids_estrategias'>;

/** Todas las estrategias de la visita, sea nueva (arreglo) o vieja (un solo id). */
export function idsEstrategiasDe(visita: ConEstrategias): string[] {
    if (visita.ids_estrategias?.length) return [...visita.ids_estrategias];
    return visita.id_estrategia ? [visita.id_estrategia] : [];
}

/** Guarda el conjunto elegido: arreglo + `id_estrategia` = la primera; vacío → se limpian ambos. */
export function fijarEstrategias(visita: ConEstrategias, ids: string[]): void {
    const unicos = [...new Set(ids)];
    visita.ids_estrategias = unicos.length ? unicos : undefined;
    visita.id_estrategia = unicos[0];
}

/**
 * Aplica una nueva selección de estrategias sobre una visita (borrador o programada):
 *  - marcar una AGREGA su sector si la visita aún no lo tiene (como programado: venía del plan);
 *  - desmarcarla QUITA su sector solo si vino del plan (`programado`), no tiene actividades y
 *    ninguna otra estrategia marcada lo usa — nunca borra trabajo ni sectores que alguien agregó.
 */
export function aplicarSeleccion(
    visita: Pick<Visita, 'id_estrategia' | 'ids_estrategias' | 'sectores'>,
    estrategiasDelCliente: Estrategia[],
    nuevosIds: string[],
    nuevoId: (prefijo: string) => string
): void {
    const previos = new Set(idsEstrategiasDe(visita));
    const nuevos = new Set(nuevosIds);
    const porId = new Map(estrategiasDelCliente.map(e => [e.id, e]));
    const sectorDe = (id: string) => porId.get(id)?.sector || '';

    visita.sectores ??= [];

    for (const id of nuevos) {
        if (previos.has(id)) continue;
        const nombre = sectorDe(id);
        if (nombre && !visita.sectores.some(s => s.nombre === nombre)) {
            visita.sectores.push({
                id: nuevoId('s'), nombre, objetivo: '', origen: [], actividades: [], programado: true
            });
        }
    }

    for (const id of previos) {
        if (nuevos.has(id)) continue;
        const nombre = sectorDe(id);
        if (!nombre) continue;
        const otraLoUsa = [...nuevos].some(otro => sectorDe(otro) === nombre);
        if (otraLoUsa) continue;

        const i = visita.sectores.findIndex(s => s.nombre === nombre);
        const sector = visita.sectores[i];
        if (sector && sector.programado === true && !(sector.actividades?.length)) {
            visita.sectores.splice(i, 1);
        }
    }

    fijarEstrategias(visita, nuevosIds);
}

/** ¿Alguna actividad GUARDADA cubre este sector? Incluye las de "Subir Actividad" con varios sectores. */
function actividadesGuardadasDe(visita: Pick<Visita, 'sectores'>, sector: Sector): Actividad[] {
    const salida: Actividad[] = [];
    for (const s of visita.sectores || []) {
        for (const a of s.actividades || []) {
            if (!a.guardada) continue;
            const propia = s.id === sector.id;
            const compartida = Array.isArray(a.sectores_ids) && a.sectores_ids.includes(sector.id);
            if (propia || compartida) salida.push(a);
        }
    }
    return salida;
}

/**
 * Las estrategias de la visita que de verdad se TRABAJARON — solo a esas se les cuenta avance.
 *
 *  - Visita antigua (solo `id_estrategia`, sin `ids_estrategias`): cuenta como siempre, sin
 *    exigir que se haya trabajado.
 *  - Visita nueva: una estrategia cuenta si el sector de la estrategia tuvo al menos una
 *    actividad guardada. Si en ese mismo sector hay varias estrategias marcadas (grupos de
 *    artículo distintos), cuenta la que coincide con el grupo de algún material capturado; si no
 *    se capturó ningún material (o no se reconoce su grupo) no hay cómo distinguirlas y cuentan
 *    todas las de ese sector.
 *
 * `grupoDeMaterial(sector, texto)` resuelve el grupo de artículo de un material capturado desde
 * el catálogo; se inyecta para no depender del almacenamiento aquí.
 */
export function estrategiasTrabajadas(
    visita: Pick<Visita, 'id_estrategia' | 'ids_estrategias' | 'sectores'>,
    estrategias: Estrategia[],
    grupoDeMaterial: (sector: string, material: string) => string | undefined = () => undefined
): string[] {
    const ids = idsEstrategiasDe(visita);
    if (!visita.ids_estrategias?.length) return ids;   // visita antigua

    const porId = new Map(estrategias.map(e => [e.id, e]));
    const marcadas = ids.map(id => porId.get(id)).filter((e): e is Estrategia => !!e);

    const trabajadas: string[] = [];
    for (const estrategia of marcadas) {
        const sector = (visita.sectores || []).find(s => s.nombre === estrategia.sector);
        if (!sector) continue;

        const actividades = actividadesGuardadasDe(visita, sector);
        if (actividades.length === 0) continue;

        const mismoSector = marcadas.filter(e => e.sector === estrategia.sector);
        if (mismoSector.length === 1 || !estrategia.grupo_articulo) {
            trabajadas.push(estrategia.id);
            continue;
        }

        const grupos = new Set(
            actividades
                .flatMap(a => a.materiales || [])
                .map(m => grupoDeMaterial(estrategia.sector || '', m.material))
                .filter((g): g is string => !!g)
        );
        // Sin materiales reconocibles no se puede distinguir: cuentan todas las del sector.
        if (grupos.size === 0 || grupos.has(estrategia.grupo_articulo)) trabajadas.push(estrategia.id);
    }
    return trabajadas;
}
