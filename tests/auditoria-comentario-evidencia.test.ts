/**
 * REQUISITO DE NEGOCIO: "Colocar comentarios en: visita; sector; actividad; evidencia."
 *
 * El modelo de datos soporta los 4 ámbitos: `AMBITOS.EVIDENCIA` existe en `js/comentarios.js`
 * y `AmbitoComentario` incluye `'evidencia'` en `src/core/tipos.ts`. Pero ningún componente de
 * React llama a `comentar({ ambito: 'evidencia', ... })` ni a `AMBITOS.EVIDENCIA`: solo
 * visita, sector y actividad están conectados en la interfaz (`VisitaDrawer.tsx`,
 * `NivelSector.tsx`, `montarActividad.tsx`). Un usuario real no tiene forma de comentar una
 * evidencia específica — solo la actividad que la contiene.
 *
 * Esta prueba es estática (lee el código fuente, no monta componentes) y falla mientras el
 * ámbito "evidencia" siga sin un punto de entrada real en la UI. Si se conecta, se vuelve a
 * poner en verde sola.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function archivosTsxBajo(dir: string): string[] {
    const resultado: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) resultado.push(...archivosTsxBajo(ruta));
        else if (entrada.name.endsWith('.tsx') || entrada.name.endsWith('.ts')) resultado.push(ruta);
    }
    return resultado;
}

const codigoFuenteUI = archivosTsxBajo(join(raiz, 'src'))
    .map(ruta => readFileSync(ruta, 'utf8'))
    .join('\n');

describe('los 4 ámbitos de comentario declarados en el modelo', () => {
    test('visita, sector y actividad tienen un punto de entrada en la UI', () => {
        assert.ok(/ambito:\s*AMBITOS\.VISITA/.test(codigoFuenteUI));
        assert.ok(/ambito:\s*AMBITOS\.SECTOR/.test(codigoFuenteUI));
        assert.ok(/ambito:\s*AMBITOS\.ACTIVIDAD/.test(codigoFuenteUI));
    });

    test('REQUISITO: evidencia también debería tener un punto de entrada en la UI', () => {
        const conectado = /ambito:\s*AMBITOS\.EVIDENCIA/.test(codigoFuenteUI)
            || /ambito:\s*['"]evidencia['"]/.test(codigoFuenteUI);

        assert.ok(conectado,
            'AmbitoComentario incluye "evidencia" (src/core/tipos.ts) y js/comentarios.js define '
            + 'AMBITOS.EVIDENCIA, pero ningún componente de src/modules/** lo usa: no hay forma de '
            + 'que un Educador, Analista o Gerente comente una evidencia específica desde la '
            + 'interfaz. El requisito de negocio "colocar comentarios en... evidencia" no está '
            + 'implementado, solo modelado.');
    });
});
