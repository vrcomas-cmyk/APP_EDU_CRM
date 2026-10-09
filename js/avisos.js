/**
 * Avisos al educador: lo que un revisor le devolvió (rechazado, requiere corrección…).
 *
 * Viven en el servidor (`pdt_avisos`, los crea un trigger al guardar la revisión) y aquí solo hay
 * una copia en memoria de lo que se bajó, más el aviso al resto de la app cuando cambia. Es el
 * mismo molde que `revisiones.js`: estado en memoria + evento, sin que cada pantalla tenga que
 * conocer de dónde salió el dato.
 *
 * `null` = todavía no se ha bajado nada. NO es lo mismo que "cero avisos": el menú pinta un
 * indicador de carga en vez de prometer que no hay nada pendiente.
 */

let lista = null;
// Ids que ya se conocían: sirve para saber qué avisos son NUEVOS y merecen un aviso emergente.
const conocidos = new Set();

function anunciar() {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pdt:avisos'));
}

/**
 * Reemplaza lo que hay con lo que bajó del servidor. Devuelve los avisos NUEVOS sin leer (los
 * que esta sesión todavía no había visto), para avisar con un toast una sola vez por cada uno.
 */
export function ponerAvisos(recibidos) {
    const entrantes = Array.isArray(recibidos) ? recibidos : [];

    // Lo que ya marcaste leído o resuelto aquí no se "des-marca" porque el servidor tarde en
    // confirmar: se respeta la marca local hasta que el servidor coincida.
    const locales = new Map((lista || []).map(a => [a.id, a]));
    lista = entrantes.map(a => {
        const previo = locales.get(a.id);
        return {
            ...a,
            leido_en: a.leido_en || previo?.leido_en || null,
            resuelto_en: a.resuelto_en || previo?.resuelto_en || null
        };
    });

    const nuevos = lista.filter(a => !a.resuelto_en && !a.leido_en && !conocidos.has(a.id));
    lista.forEach(a => conocidos.add(a.id));

    anunciar();
    return nuevos;
}

export function hayAvisosCargados() { return lista !== null; }

/** Los que siguen sin resolver, del más reciente al más viejo. */
export function avisosAbiertos() {
    return (lista || []).filter(a => !a.resuelto_en)
        .sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));
}

export function avisosSinLeer() {
    return avisosAbiertos().filter(a => !a.leido_en);
}

/** Aplica la marca ya mismo en pantalla; el servidor la confirma después (`marcarAvisos`). */
export function marcarLocal(ids, accion) {
    const conjunto = new Set(ids);
    const ahora = new Date().toISOString();
    lista = (lista || []).map(a => {
        if (!conjunto.has(a.id)) return a;
        return accion === 'resuelto'
            ? { ...a, leido_en: a.leido_en || ahora, resuelto_en: ahora, resuelto_motivo: 'educador' }
            : { ...a, leido_en: a.leido_en || ahora };
    });
    anunciar();
}

export function olvidarAvisos() {
    lista = null;
    conocidos.clear();
    anunciar();
}
