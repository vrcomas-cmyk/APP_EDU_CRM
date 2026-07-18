/**
 * Configuración de entorno.
 *
 * La prueba que importa aquí es la del guard contra la `service_role`. Un guard de seguridad
 * sin verificar es peor que no tenerlo: da la confianza sin dar la protección.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    verificarClaveAnonima, APPS_SCRIPT_URL, SUPABASE_URL, SUPABASE_ANON_KEY, TIMEOUT_MS
} from '@services/config';

/** Arma un JWT de mentira con el rol pedido. No se firma: el guard solo lee la carga. */
function jwt(carga: Record<string, unknown>): string {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(carga)}.firma-falsa`;
}

describe('guard de la clave publicada', () => {
    test('una clave anon pasa', () => {
        assert.doesNotThrow(() => verificarClaveAnonima(jwt({ role: 'anon', iss: 'supabase' })));
    });

    test('una service_role se detiene en seco', () => {
        assert.throws(
            () => verificarClaveAnonima(jwt({ role: 'service_role', iss: 'supabase' })),
            /rol "service_role"/,
            'publicarla daría a internet permiso para saltarse TODAS las políticas de la base'
        );
    });

    test('cualquier rol privilegiado, no solo service_role', () => {
        assert.throws(() => verificarClaveAnonima(jwt({ role: 'postgres' })), /rol "postgres"/);
        assert.throws(() => verificarClaveAnonima(jwt({ role: 'authenticated' })), /rol/);
    });

    test('una cadena que no es JWT no tumba el arranque', () => {
        // Podría ser una clave de otro formato. Solo se detiene lo que sí se pudo leer Y
        // resultó privilegiado; ante la duda, no se bloquea el arranque de la app.
        assert.doesNotThrow(() => verificarClaveAnonima('no-es-un-jwt'));
        assert.doesNotThrow(() => verificarClaveAnonima(''));
        assert.doesNotThrow(() => verificarClaveAnonima('a.b.c'));
    });

    test('un JWT sin rol declarado pasa', () => {
        assert.doesNotThrow(() => verificarClaveAnonima(jwt({ iss: 'otro-proveedor' })));
    });
});

describe('las variables se leen del entorno', () => {
    test('las tres obligatorias tienen valor', () => {
        assert.ok(APPS_SCRIPT_URL.startsWith('https://'));
        assert.ok(SUPABASE_URL.startsWith('https://'));
        assert.ok(SUPABASE_ANON_KEY.length > 0);
    });

    test('la clave que se está usando de verdad es anónima', () => {
        assert.doesNotThrow(() => verificarClaveAnonima(SUPABASE_ANON_KEY),
            'esto corre contra el .env real: si alguien pega la clave equivocada, falla aquí');
    });

    test('el timeout es un número positivo', () => {
        assert.ok(Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS > 0);
    });
});
