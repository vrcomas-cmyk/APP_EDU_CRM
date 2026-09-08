/**
 * Matemática de color para el editor de tema personalizado.
 *
 * Nadie edita las ~18 variables del tema sueltas: eso es justo lo que ya rompió el contraste
 * una vez en esta misma app (encabezados de fin de semana ilegibles — auditoría UI/UX del
 * 2026-09-04, corregida usando el token equivocado como color de texto). Aquí se editan DOS
 * colores —papel y tinta— y el resto se DERIVA, igual que se hizo a mano para el tema DEGASA:
 * el comentario de ese bloque en `style.css` ya dice que retintar `--ink` es lo único que hace
 * falta para que el resto de la app se sienta "de marca" sin tocar un selector más.
 *
 * Los cuatro colores de ESTADO (`--st-plan/miss/part/done`) y la paleta CATEGÓRICA
 * (`--cat-1..8`) nunca se derivan del tema: son semántica de salud/categoría, no de marca, y
 * se copian tal cual de `style.css` según el modo — así un tema personalizado nunca puede
 * romper la lectura de "esta visita tiene evidencia pendiente" en el calendario.
 *
 * Acoplamiento a mano, a propósito: estos hex son una copia de los de `style.css`. Si algún
 * día cambian ahí, hay que actualizarlos aquí también — no hay forma de leer CSS desde este
 * archivo sin montar nada, y montar algo solo para leer una constante es más frágil que
 * mantener dos copias sincronizadas a mano.
 */

export interface DerivarTemaEntrada {
    modo: 'claro' | 'oscuro';
    /** `--paper`: el fondo. */
    paper: string;
    /** `--ink`: texto principal y color de marca/acento. */
    ink: string;
}

/** Las variables que un tema (base o personalizado) declara. Una sola lista, compartida por
 *  `derivarTema` (qué se calcula) y `js/tema.js` (qué se limpia al cambiar de tema). */
export const VARIABLES_DE_TEMA = [
    '--paper', '--surface', '--surface-2', '--ink', '--ink-2', '--muted', '--rule', '--rule-soft',
    '--st-plan', '--st-miss', '--st-part', '--st-done',
    '--st-plan-bg', '--st-miss-bg', '--st-part-bg', '--st-done-bg',
    '--cat-1', '--cat-2', '--cat-3', '--cat-4', '--cat-5', '--cat-6', '--cat-7', '--cat-8'
] as const;

type MapaVariables = Record<(typeof VARIABLES_DE_TEMA)[number], string>;

const ESTADO_CLARO = {
    '--st-plan': '#8A9691', '--st-miss': '#C81E3A', '--st-part': '#0B72B9', '--st-done': '#1F8A54',
    '--st-plan-bg': '#EEF2F1', '--st-miss-bg': '#FBEEF0', '--st-part-bg': '#EAF2F8', '--st-done-bg': '#EAF4EE',
    '--cat-1': '#3987e5', '--cat-2': '#d95926', '--cat-3': '#199e70', '--cat-4': '#c98500',
    '--cat-5': '#d55181', '--cat-6': '#008300', '--cat-7': '#9085e9', '--cat-8': '#e66767'
} as const;

const ESTADO_OSCURO = {
    '--st-plan': '#7E8C87', '--st-miss': '#E86176', '--st-part': '#5AA8DC', '--st-done': '#5CB98A',
    '--st-plan-bg': '#1B2223', '--st-miss-bg': '#2A1519', '--st-part-bg': '#10222D', '--st-done-bg': '#10241A',
    '--cat-1': '#3987e5', '--cat-2': '#d95926', '--cat-3': '#199e70', '--cat-4': '#c98500',
    '--cat-5': '#d55181', '--cat-6': '#008300', '--cat-7': '#9085e9', '--cat-8': '#e66767'
} as const;

// ---------- color ----------

export function hexARgb(hex: string): [number, number, number] {
    const limpio = hex.replace('#', '').trim();
    const completo = limpio.length === 3
        ? limpio.split('').map(c => c + c).join('')
        : limpio.padEnd(6, '0').slice(0, 6);
    const n = parseInt(completo, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbAHex([r, g, b]: [number, number, number]): string {
    const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** Interpolación lineal en sRGB — el mismo espacio en el que `color-mix()` ya opera en el CSS
 *  de esta app, así que un tema derivado aquí se comporta como los que ya existen. */
export function mezclar(a: string, b: string, pct: number): string {
    const [ar, ag, ab] = hexARgb(a);
    const [br, bg, bb] = hexARgb(b);
    const t = Math.max(0, Math.min(1, pct));
    return rgbAHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

function luminanciaRelativa(hex: string): number {
    const canal = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const [r, g, b] = hexARgb(hex);
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Ratio de contraste WCAG entre dos colores — 1:1 (indistinguibles) a 21:1 (negro sobre blanco). */
export function contraste(a: string, b: string): number {
    const l1 = luminanciaRelativa(a);
    const l2 = luminanciaRelativa(b);
    const [claro, oscuro] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (claro + 0.05) / (oscuro + 0.05);
}

// ---------- derivación ----------

/** A partir de papel+tinta, calcula el resto de la escala — mismos pasos que se aplicaron a
 *  mano para construir el tema DEGASA. */
export function derivarTema({ modo, paper, ink }: DerivarTemaEntrada): MapaVariables {
    const haciaOscuro = modo === 'claro' ? '#000000' : '#FFFFFF';
    const estado = modo === 'claro' ? ESTADO_CLARO : ESTADO_OSCURO;

    return {
        '--paper': paper,
        '--surface': mezclar(paper, haciaOscuro, 0.03),
        '--surface-2': mezclar(paper, haciaOscuro, 0.07),
        '--ink': ink,
        '--ink-2': mezclar(ink, paper, 0.25),
        '--muted': mezclar(ink, paper, 0.45),
        '--rule': mezclar(ink, paper, 0.85),
        '--rule-soft': mezclar(ink, paper, 0.92),
        ...estado
    };
}

// ---------- validación ----------

export interface ProblemaTema {
    /** `error` bloquea guardar; `aviso` no. */
    nivel: 'error' | 'aviso';
    mensaje: string;
}

const MINIMO_TEXTO = 4.5;
const MINIMO_TEXTO_SECUNDARIO = 3.0;

/**
 * ¿Este tema se puede guardar? Vacío = sí. Cada regla dice CONTRA QUÉ falla, no solo "mal
 * contraste" — quien edita necesita saber qué mover.
 */
export function problemasDeTema(entrada: DerivarTemaEntrada): ProblemaTema[] {
    const problemas: ProblemaTema[] = [];
    const t = derivarTema(entrada);

    if (entrada.modo === 'claro' && luminanciaRelativa(entrada.paper) < 0.5) {
        problemas.push({
            nivel: 'error',
            mensaje: 'Elegiste modo claro con un papel oscuro — el resto de la app asumirá texto claro sobre este fondo y se va a leer al revés.'
        });
    }
    if (entrada.modo === 'oscuro' && luminanciaRelativa(entrada.paper) >= 0.5) {
        problemas.push({
            nivel: 'error',
            mensaje: 'Elegiste modo oscuro con un papel claro — mismo problema, al revés.'
        });
    }

    const paresCriticos: Array<[string, string, string]> = [
        [t['--ink'], t['--paper'], 'texto principal sobre el fondo'],
        [t['--ink'], t['--surface'], 'texto principal sobre una tarjeta'],
        [t['--ink'], t['--surface-2'], 'texto principal sobre un fondo hundido'],
        [t['--ink-2'], t['--paper'], 'texto secundario sobre el fondo']
    ];
    for (const [fg, bg, donde] of paresCriticos) {
        const ratio = contraste(fg, bg);
        if (ratio < MINIMO_TEXTO) {
            problemas.push({
                nivel: 'error',
                mensaje: `Contraste insuficiente en ${donde} (${ratio.toFixed(1)}:1, se necesitan ${MINIMO_TEXTO}:1).`
            });
        }
    }

    // Texto sobre un botón primario (fondo = --ink, texto = --paper) — el par al revés.
    const ratioBoton = contraste(t['--paper'], t['--ink']);
    if (ratioBoton < MINIMO_TEXTO_SECUNDARIO) {
        problemas.push({
            nivel: 'error',
            mensaje: `Contraste insuficiente en el texto de un botón principal (${ratioBoton.toFixed(1)}:1, se necesitan ${MINIMO_TEXTO_SECUNDARIO}:1).`
        });
    }

    const ratioMuted = contraste(t['--muted'], t['--paper']);
    if (ratioMuted < MINIMO_TEXTO_SECUNDARIO) {
        problemas.push({
            nivel: 'aviso',
            mensaje: `El texto secundario (--muted) queda con poco contraste (${ratioMuted.toFixed(1)}:1) — legible pero apretado.`
        });
    }

    return problemas;
}
