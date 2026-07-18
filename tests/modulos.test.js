/**
 * Integridad del proyecto.
 *
 * Estas pruebas no miran comportamiento, miran que las piezas encajen. Existen por dos
 * accidentes reales:
 *
 *   1. Un borrado por índices dejó un fragmento de código al final de un archivo. `node --check`
 *      lo dio por bueno —resultó ser sintaxis válida— y nadie lo notó hasta abrir la app.
 *      Importar cada módulo de verdad sí lo detecta.
 *
 *   2. Un módulo nuevo que no se agregó a la lista del service worker. Esa lista ya no se
 *      mantiene a mano —la genera el build— y su prueba vive en `sw.test.ts`.
 *
 * Durante la reorganización en módulos son la red de seguridad principal: mover un archivo
 * sin actualizar quien lo importa falla aquí, no en producción.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const modulos = readdirSync(join(raiz, 'js'))
    .filter(f => f.endsWith('.js'))
    .sort();

describe('todos los módulos cargan', () => {
    for (const archivo of modulos) {
        test(`js/${archivo}`, async () => {
            await assert.doesNotReject(
                // @vite-ignore — la lista sale del disco en tiempo de ejecución, que es
                // justo el punto: un módulo nuevo entra a la prueba sin que nadie lo agregue.
                () => import(/* @vite-ignore */ `../js/${archivo}`),
                `js/${archivo} no se pudo importar: un import roto o código sobrante al final`
            );
        });
    }
});

describe('index.html', () => {
    const html = readFileSync(join(raiz, 'index.html'), 'utf8');

    test('carga la app como módulo ES', () => {
        assert.match(html, /<script[^>]+type="module"[^>]+src="js\/app\.js"/,
            'sin type="module" los import fallan en silencio');
    });

    test('no quedan scripts sueltos apuntando a módulos', () => {
        const sueltos = [...html.matchAll(/<script(?![^>]*type="module")[^>]*src="(js\/[^"]+)"/g)];
        assert.deepEqual(sueltos.map(m => m[1]), []);
    });
});
