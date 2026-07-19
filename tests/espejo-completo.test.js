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
    guardarCatalogosAdmin: 'pdt_catalogos_guardar',

    // Estas tres no son espejo de nada: los roles y los flujos de revisión viven SOLO en
    // Postgres, porque una hoja no puede sostener herencia entre roles, negarse a borrar un rol
    // que alguien está usando, ni el CHECK de forma de los veredictos de un flujo. Aparecen aquí
    // igual para que la última prueba —«ninguna acción de guardado sin declarar»— las siga
    // viendo: lo que se comprueba es que toda escritura llegue a Postgres, y para estas eso es
    // aún más cierto que para las demás, no menos.
    guardarRoles: 'pdt_rol_guardar',
    guardarUsuarios: 'pdt_usuario_guardar',
    guardarFlujos: 'pdt_flujo_guardar'
};

/** Las que escriben en Postgres SIN copia en la hoja: su fallo no se puede callar. */
const SOLO_POSTGRES = ['guardarRoles', 'guardarUsuarios', 'guardarFlujos'];

describe('el espejo de Supabase', () => {
    for (const [funcion, rpc] of Object.entries(ESPEJOS)) {
        test(`${funcion} escribe también en Supabase`, () => {
            const cuerpo = cuerpoDe(funcion);

            // `supabaseRPC` o `supabaseRPCEstricto`: son dos transportes con distinta política
            // ante el fallo, y las dos cuentan como llegar a Postgres.
            assert.ok(new RegExp(`supabaseRPC\\w*\\('${rpc}'`).test(cuerpo),
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

    /*
     * Las tres siguientes cubren el reparto de permisos, que es la única escritura capaz de
     * conceder acceso a todo lo demás. Se le pide más que al resto a propósito.
     */

    test('quien reparte permisos es la identidad verificada', () => {
        // Si `p_actor` saliera del cuerpo, cualquiera podría decir «soy el admin» y crearse un
        // rol con todo. Postgres lo vuelve a comprobar, pero comprobaría la mentira.
        for (const funcion of SOLO_POSTGRES) {
            const cuerpo = cuerpoDe(funcion);

            assert.ok(/p_actor: identidad\.correo/.test(cuerpo),
                `${funcion}(): p_actor debe salir de identidad.correo, nunca del cuerpo`);
            assert.ok(!/p_actor: body\./.test(cuerpo),
                `${funcion}(): p_actor jamás puede venir del body`);
        }
    });

    test('administrar roles y usuarios exige ser admin', () => {
        for (const funcion of [...SOLO_POSTGRES, 'leerRBAC']) {
            const cuerpo = cuerpoDe(funcion);

            assert.ok(/if \(!esAdmin\(db, identidad\.correo\)\)/.test(cuerpo),
                `${funcion}(): tiene que negarse a quien no es admin. La lectura también: `
                + 'expone el organigrama completo de la organización.');
        }
    });

    test('sin copia en la hoja, el fallo no se puede callar', () => {
        // `supabaseRPC` devuelve null y sigue, porque para una visita la hoja es la red de
        // seguridad. Los roles no tienen hoja debajo: callar un fallo aquí dejaría al
        // administrador viendo «guardado» sobre un cambio que nunca ocurrió.
        for (const funcion of SOLO_POSTGRES) {
            const cuerpo = cuerpoDe(funcion);

            assert.ok(cuerpo.includes('supabaseRPCEstricto('),
                `${funcion}(): debe usar supabaseRPCEstricto, no el transporte que calla`);

            // TODAS sus llamadas, no solo una. La primera versión de esta prueba se conformaba
            // con encontrar un `supabaseRPCEstricto` en el cuerpo, y así una función con tres
            // llamadas podía pasar dos al transporte que calla sin que nadie se enterara.
            assert.ok(!/[^\w]supabaseRPC\(/.test(cuerpo),
                `${funcion}(): le queda alguna llamada a supabaseRPC, que devuelve null en `
                + 'silencio. Sin copia en la hoja, ese null es un cambio perdido sin aviso.');
            assert.ok(/status: 'error', message: \w+\.error/.test(cuerpo),
                `${funcion}(): el mensaje de Postgres tiene que llegar a la pantalla`);
        }

        const estricto = cuerpoDe('supabaseRPCEstricto');
        assert.ok(!/return null;/.test(estricto),
            'supabaseRPCEstricto no puede devolver null: su razón de existir es no callar');
    });
});
