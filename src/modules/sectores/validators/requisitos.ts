/**
 * Qué exige un sector, y qué se hace con los que quedan a medias.
 */

import type { Sector, Visita } from '@core/tipos';

/**
 * Los tres que el sector exige.
 *
 * Sin ellos el sector no dice nada útil sobre a qué se fue: "GASAS" solo es una etiqueta.
 * El objetivo explica qué se buscaba, el origen de dónde salió la petición y `solicitado_por`
 * a quién responderle — que es justo lo que alguien preguntará tres meses después.
 */
export function faltaEnSector(sector: Partial<Sector> | null | undefined): string[] {
    const falta: string[] = [];

    if (!(sector?.objetivo || '').trim()) falta.push('Objetivo');
    if (!(sector?.origen || []).length) falta.push('Origen de la actividad');
    if (!(sector?.solicitado_por || '').trim()) falta.push('Solicitado por');

    return falta;
}

export function sectorCompleto(sector: Partial<Sector> | null | undefined): boolean {
    return faltaEnSector(sector).length === 0;
}

/**
 * Se puede editar mientras la visita no lo haya sellado.
 *
 * El sello lo pone Guardar visita, no el botón de este sector: mientras la visita sea borrador
 * todo sigue siendo corregible, y sellar antes mentiría sobre eso.
 */
export function esEditable(sector: Sector): boolean {
    return !sector.guardado;
}

/**
 * Los que se quedan a medias se descartan al cerrar la ventana.
 *
 * No es "trabajo perdido": un sector sin objetivo ni origen no dice nada, y dejarlo colgado
 * obligaría después a adivinar si se quiso agregar o si fue un clic de más. Los sellados
 * nunca se tocan — ya son parte de lo que la visita afirmó.
 */
export function conservables(sectores: Sector[]): Sector[] {
    return sectores.filter(s => s.guardado || sectorCompleto(s));
}

/**
 * Igual que `conservables`, pero acotado a los sectores agregados EN ESTA SESIÓN de la
 * ventana (`idsAgregados`) — nunca a los que ya existían al abrirla.
 *
 * `conservables` barre TODO `visita.sectores`, así que si la visita nace con varios sectores
 * precreados (por ejemplo al generarla desde una Estrategia con más de uno elegido) y el
 * usuario completa solo el primero antes de cerrar, los demás —que nadie tocó todavía, no que
 * se hayan agregado y abandonado aquí— se borraban igual. Abandonar UNO agregado ahora sigue
 * podándose; los hermanos que ya venían de antes se quedan tal cual, completos o no.
 */
export function podarAgregadosIncompletos(sectores: Sector[], idsAgregados: Set<string>): Sector[] {
    return sectores.filter(s => !idsAgregados.has(s.id) || s.guardado || sectorCompleto(s));
}

/** Los del catálogo que esta visita todavía no usa. */
export function sectoresLibres(catalogo: string[], visita: Visita): string[] {
    const usados = new Set((visita.sectores || []).map(s => s.nombre));
    return catalogo.filter(nombre => !usados.has(nombre));
}
