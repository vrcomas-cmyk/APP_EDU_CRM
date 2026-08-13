/**
 * `hidden` sobrevive a `display` — el bug que le costó bloquear el login entero.
 *
 * `[hidden]` es una regla de la hoja del navegador (misma especificidad que una sola clase de
 * autor). Cualquier clase que fije `display` en `style.css` le GANA a `[hidden]` si el
 * elemento la lleva puesta; `hidden = true` desde JS deja de tener efecto visual y nadie se da
 * cuenta hasta que un modal estático (no uno que React monta/desmonta condicionalmente) se
 * queda pintado tapando toda la pantalla. `style.css` ya lo documenta dos veces en comentarios
 * (`.app[hidden]`, `.seg[hidden]`) — esta prueba es para que la tercera vez no vuelva a pasar
 * en silencio.
 *
 * Alcance a propósito: solo mira las clases de elementos que en `index.html` YA nacen con
 * `hidden` puesto (el caso real, estático, donde el bug es posible). Una clase que nunca
 * convive con `hidden` en el HTML estático no puede tener este problema — React nunca deja
 * `hidden` puesto sobre un nodo que además define su propio `display` sin la regla de escape.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(raiz, '../index.html'), 'utf8');
const css = readFileSync(path.join(raiz, '../style.css'), 'utf8');

/** Clases de cada elemento del HTML estático que arranca con el atributo `hidden`. */
function clasesConHiddenEstatico(marcado) {
    const clases = new Set();
    const reEtiqueta = /<[a-z][a-z0-9]*\b[^>]*\bhidden\b[^>]*>/gi;
    for (const [etiqueta] of marcado.matchAll(reEtiqueta)) {
        const claseAttr = etiqueta.match(/class="([^"]*)"/);
        if (!claseAttr) continue;
        for (const c of claseAttr[1].split(/\s+/).filter(Boolean)) clases.add(c);
    }
    return clases;
}

/** ¿La clase tiene, en algún selector simple `.clase { ... }`, una declaración de `display`? */
function fijaDisplay(hoja, clase) {
    const re = new RegExp(`\\.${clase}\\s*\\{[^}]*\\bdisplay\\s*:`, 's');
    return re.test(hoja);
}

/** ¿Existe la regla de escape `.clase[hidden] { display: none` (en cualquier orden de props)? */
function tieneReglaDeEscape(hoja, clase) {
    const re = new RegExp(`\\.${clase}\\[hidden\\]\\s*\\{[^}]*\\bdisplay\\s*:\\s*none`, 's');
    return re.test(hoja);
}

describe('style.css — [hidden] no debe perder contra una clase con display', () => {
    const clases = clasesConHiddenEstatico(html);

    test('el HTML estático de verdad tiene elementos "hidden" con clase (si no, esta prueba no prueba nada)', () => {
        assert.ok(clases.size > 0);
    });

    for (const clase of clases) {
        test(`.${clase}: si fija display, debe traer .${clase}[hidden] { display: none }`, () => {
            if (!fijaDisplay(css, clase)) return; // sin display propio, el hidden nativo alcanza
            assert.ok(tieneReglaDeEscape(css, clase),
                `.${clase} fija "display" pero no tiene ".${clase}[hidden] { display: none }" — ` +
                'un elemento así se queda visible aunque el JS le ponga hidden = true.');
        });
    }
});
