/**
 * Sesiones por DISPOSITIVO, no por cuenta.
 *
 * Una misma cuenta en varios dispositivos es un caso de uso declarado de esta app, y un
 * bug concreto lo rompió: `pdt_google_credenciales` guardaba UN solo `sesion_hash` por
 * correo, así que cada inicio de sesión nuevo invalidaba la sesión del dispositivo
 * anterior ("Tu sesión ya no es válida") y todo lo que esa compu intentaba sincronizar
 * quedaba rechazado — el check-in se hacía en un dispositivo y jamás llegaba al otro.
 *
 * Esta prueba es estática, igual que `espejo-completo.test.js`: Apps Script y Postgres no
 * corren aquí, pero las invariantes que impiden volver a ese bug se pueden leer del código.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const codigo = readFileSync(join(raiz, 'apps-script', 'Codigo.gs'), 'utf8');
const auth = readFileSync(join(raiz, 'js', 'auth.js'), 'utf8');
const migracion = readFileSync(
    join(raiz, 'supabase', 'migrations', '20260821_pdt_sesiones_por_dispositivo.sql'), 'utf8');

/** El cuerpo de una función de nivel superior, de su `function x(` al `\n}` que la cierra. */
function cuerpoDe(nombre, fuente = codigo) {
    const inicio = fuente.indexOf(`function ${nombre}(`);
    assert.notEqual(inicio, -1, `se esperaba ${nombre}() en el archivo`);
    const fin = fuente.indexOf('\n}', inicio);
    assert.notEqual(fin, -1, `no se encontró el final de ${nombre}()`);
    return fuente.slice(inicio, fin);
}

describe('sesiones por dispositivo', () => {
    test('el Client ID del Apps Script coincide con el de la PWA', () => {
        // Si difieren, Google rechaza el canje del código de login ("invalid_client") y
        // `verificarIdentidad` rechaza el id_token ("Token de otra aplicación"). Es un
        // estado que nunca puede funcionar: el mismo OAuth client en ambos lados, o nada.
        const deAuth = auth.match(/CLIENT_ID = '([^']+)'/);
        const deScript = codigo.match(/CLIENT_ID = '([^']+)'/);

        assert.ok(deAuth && deScript, 'ambos archivos deben declarar CLIENT_ID');
        assert.equal(deScript[1], deAuth[1],
            'Codigo.gs y auth.js deben usar el MISMO Client ID de Google');
    });

    test('cerrar sesión borra SOLO la sesión de este dispositivo', () => {
        // Si el logout borrara la credencial de la cuenta (`pdt_google_credenciales_olvidar`),
        // cerrar sesión en una compu quitaría el permiso de Calendar a los demás dispositivos
        // de la misma cuenta. Cerrar sesión es local al dispositivo.
        const cuerpo = cuerpoDe('cerrarSesionGoogle');

        assert.ok(/pdt_sesion_olvidar/.test(cuerpo),
            'el logout debe llamar a pdt_sesion_olvidar, que borra solo la sesión del dispositivo');
        assert.ok(!/pdt_google_credenciales_olvidar/.test(cuerpo),
            'el logout NO debe borrar la credencial de la cuenta: eso quitaría Calendar a todos');
        assert.ok(/huellaSesion\(body\.sesion_token/.test(cuerpo),
            'la sesión a borrar sale de body.sesion_token, no del correo');
    });

    test('la migración separa las sesiones de la credencial', () => {
        assert.ok(/create table if not exists pdt_sesiones/.test(migracion),
            'debe nacer una tabla de sesiones, una fila por dispositivo');
        assert.ok(/drop column sesion_hash/.test(migracion),
            'la credencial de la cuenta deja de llevar una sola sesión');
        assert.ok(/on conflict \(sesion_hash\)/.test(migracion),
            'cada sesión se guarda por su propio hash, sin pisar la de otro dispositivo');
        assert.ok(/create or replace function pdt_sesion_olvidar/.test(migracion),
            'debe existir la función de cerrar sesión de un dispositivo');
    });

    test('la migración conserva la sesión que ya existía', () => {
        // La migración corre sobre una base con datos: si el `insert ... select` de la
        // sesión actual no estuviera, el `drop column` la perdería y habría que volver a
        // iniciar sesión en el único dispositivo que funcionaba.
        const desdeCredencial = migracion.indexOf('from pdt_google_credenciales');
        const aSesiones = migracion.indexOf('insert into pdt_sesiones');
        assert.ok(aSesiones !== -1 && desdeCredencial > aSesiones,
            'la sesión vigente debe migrarse a pdt_sesiones antes de soltar la columna');
        assert.ok(migracion.indexOf('drop column sesion_hash') > desdeCredencial,
            'la columna se suelta DESPUÉS de haber rescatado la sesión');
    });
});