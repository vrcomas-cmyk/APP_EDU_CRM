/**
 * Un color por persona en el calendario, como en Google Calendar — pero convive con el color
 * de salud (`st-${salud}`), no lo reemplaza: la salud sigue siendo el relleno; la persona es
 * un borde/punto encima.
 *
 * Determinístico y sin estado: el mismo correo da SIEMPRE el mismo color, en cualquier sesión
 * y cualquier vista, sin coordinarse con nadie ni guardar nada. Es lo que hace que el color
 * signifique algo de un vistazo — si dependiera del orden en que aparecen las visitas, el
 * mismo educador cambiaría de color entre una recarga y otra.
 *
 * Usa la paleta `--cat-1..--cat-8` (style.css), ya validada contra daltonismo y ya reservada
 * para "categoría, no estado" — nunca `--cat-otros`, que es "resto agregado", no un noveno
 * tono individual.
 *
 * Con más de 8 personas visibles a la vez puede haber colisión de color entre dos educadores.
 * Es aceptable a propósito: el color aquí es una ayuda de ESCANEO, no un identificador — el
 * nombre en la tarjeta (`ev-educador`) es lo que de verdad dice de quién es. La leyenda junto
 * al filtro (`Calendario.tsx`) desambigua si hace falta. No "arreglar" la colisión inventando
 * un noveno tono — rompería la validación de daltonismo de la paleta.
 */

const CANTIDAD_TONOS = 8;

function hashCorreo(correo: string): number {
    let h = 0;
    for (let i = 0; i < correo.length; i++) {
        h = (h * 31 + correo.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

function indiceDePersona(correoLimpio: string): number {
    return (hashCorreo(correoLimpio) % CANTIDAD_TONOS) + 1;
}

/** `'var(--cat-N)'`, 1..8. Cadena vacía si no hay correo (visita sin dueño reconocible). */
export function colorDePersona(correo: string | undefined | null): string {
    const limpio = (correo || '').trim().toLowerCase();
    if (!limpio) return '';
    return `var(--cat-${indiceDePersona(limpio)})`;
}

const TEXTO_OSCURO = '#101617';
const TEXTO_CLARO = '#fdfdfd';

/**
 * Texto legible sobre `colorDePersona()`. Medido a mano (fórmula de contraste WCAG) contra los
 * 8 tonos `--cat-N`: NINGUNO llega a 4.5:1 con texto blanco, así que oscuro es lo seguro en 7
 * de 8 — salvo `--cat-6` (verde oscuro #008300), el único que se lee mejor en blanco (4.95 vs
 * 3.70). Una sola regla de "blanco u oscuro" para toda la paleta habría fallado ese caso.
 */
const TEXTO_POR_TONO: Record<number, string> = {
    1: TEXTO_OSCURO, 2: TEXTO_OSCURO, 3: TEXTO_OSCURO, 4: TEXTO_OSCURO,
    5: TEXTO_OSCURO, 6: TEXTO_CLARO, 7: TEXTO_OSCURO, 8: TEXTO_OSCURO
};

/** Color de texto para escribir sobre `colorDePersona(correo)` sin perder contraste. */
export function textoDePersona(correo: string | undefined | null): string {
    const limpio = (correo || '').trim().toLowerCase();
    if (!limpio) return TEXTO_OSCURO;
    return TEXTO_POR_TONO[indiceDePersona(limpio)] ?? TEXTO_OSCURO;
}

/**
 * Inicial para el distintivo de persona — un punto de color por sí solo no identifica a
 * nadie sin acercar el cursor; la letra lo vuelve reconocible de un vistazo, como el avatar
 * circular de Google Calendar. Prefiere el nombre sobre el correo cuando hay ambos.
 */
export function inicialDePersona(nombreOCorreo: string | undefined | null): string {
    const limpio = (nombreOCorreo || '').trim();
    if (!limpio) return '?';
    return (limpio[0] ?? '?').toUpperCase();
}
