/**
 * Todo lo que se escribe en Sheets se escribe también en Supabase.
 *
 * Esta prueba no ejecuta Apps Script —corre en Google, no aquí— sino que lee su código y
 * comprueba una invariante estructural: cada acción que GUARDA algo tiene que llamar a
 * `supabaseRPC`.
 *
 * Existe porque el espejo se completó a mano y a destiempo. Visitas y revisiones lo tenían
 * desde el principio; eventos, comentarios y catálogos se quedaron solo en la hoja durante
 * meses, y nadie lo notó porque la app funciona igual de bien sin espejo. El día que se
 * migre a Supabase, lo que no esté espejado sencillamente no existirá.
 *
 * Una prueba estática es poco, pero es exactamente lo que falló: nadie se olvidó de que el
 * espejo funcionara, se olvidaron de escribirlo.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const codigo = readFileSync(join(raiz, 'apps-script', 'Codigo.gs'), 'utf8');

/** El cuerpo de una función de nivel superior, de su `function x(` al `\n}` que la cierra. */
function cuerpoDe(nombre) {
    const inicio = codigo.indexOf(`function ${nombre}(`);
    assert.notEqual(inicio, -1, `Apps Script debe seguir teniendo ${nombre}()`);

    const fin = codigo.indexOf('\n}', inicio);
    assert.notEqual(fin, -1, `no se encontró el final de ${nombre}()`);

    return codigo.slice(inicio, fin);
}

/**
 * Las acciones que ESCRIBEN, con la función de Postgres que debe recibir su espejo.
 *
 * `subirEvidencia` no está: sube el archivo a Drive y su URL viaja dentro de la actividad,
 * así que llega al espejo por `pdt_espejo_guardar`. Es la única escritura cuyo espejo es
 * indirecto, y por eso se anota aquí en vez de dejar que su ausencia parezca un descuido.
 */
const ESPEJOS = {
    guardarVisitas: 'pdt_espejo_guardar',
    guardarEventos: 'pdt_eventos_guardar',
    guardarComentarios: 'pdt_comentarios_guardar',
    guardarRevisiones: 'pdt_revision_guardar',
    guardarCatalogosAdmin: 'pdt_catalogos_guardar'
};

describe('el espejo de Supabase', () => {
    for (const [funcion, rpc] of Object.entries(ESPEJOS)) {
        test(`${funcion} escribe también en Supabase`, () => {
            const cuerpo = cuerpoDe(funcion);

            assert.ok(cuerpo.includes(`supabaseRPC('${rpc}'`),
                `${funcion}() escribe en Sheets pero no llama a ${rpc}: `
                + 'lo que no esté espejado no existirá el día que se migre a Supabase');
        });
    }

    test('no hay acciones de guardado sin espejo declarado', () => {
        // Recoge los `case 'guardarX':` del despachador. Un manejador nuevo aparece aquí sin
        // que nadie tenga que acordarse de agregarlo a la lista de arriba.
        const acciones = [...codigo.matchAll(/case '(guardar\w+)':/g)].map(m => m[1]);

        assert.ok(acciones.length >= 5, `se esperaban varias acciones, salieron ${acciones.length}`);

        const sinEspejo = acciones.filter(a => !ESPEJOS[a]);
        assert.deepEqual(sinEspejo, [],
            `estas acciones guardan y nadie declaró su espejo: ${sinEspejo.join(', ')}`);
    });

    test('el espejo va DESPUÉS de escribir en la hoja', () => {
        // Sheets es la fuente operativa. Si el espejo fuera primero y fallara, una captura
        // válida se perdería por un problema de la copia, que es exactamente al revés de lo
        // que debe pasar.
        for (const funcion of ['guardarVisitas', 'guardarEventos', 'guardarComentarios']) {
            const cuerpo = cuerpoDe(funcion);
            const hoja = Math.max(cuerpo.indexOf('upsert('), cuerpo.indexOf('.setValues('));
            const espejo = cuerpo.indexOf('supabaseRPC(');

            assert.ok(hoja !== -1 && espejo > hoja,
                `${funcion}(): el espejo debe ir después de la escritura en la hoja`);
        }
    });

    test('un fallo del espejo no puede tumbar la captura', () => {
        const cuerpo = cuerpoDe('supabaseRPC');

        // Devuelve null en vez de lanzar, en los tres caminos: sin clave, con respuesta que
        // no es 200, y ante una excepción de red.
        assert.equal((cuerpo.match(/return null;/g) || []).length, 3,
            'supabaseRPC debe devolver null y nunca lanzar: si lanzara, un Supabase caído '
            + 'haría fallar el guardado en Sheets, que es la fuente operativa');
        assert.ok(cuerpo.includes('muteHttpExceptions: true'));
    });

    test('la identidad del espejo es la verificada, no la que mande el cliente', () => {
        // Un cliente manipulado no debe poder escribir bitácora ni comentarios a nombre de
        // otro. El correo que se le pasa a Postgres sale SIEMPRE de `identidad`.
        for (const funcion of ['guardarEventos', 'guardarComentarios', 'guardarRevisiones']) {
            const cuerpo = cuerpoDe(funcion);
            const llamada = cuerpo.slice(cuerpo.indexOf('supabaseRPC('));

            assert.ok(/p_\w*correo: identidad\.correo/.test(llamada),
                `${funcion}(): el correo del espejo debe salir de identidad.correo`);
        }
    });
});
