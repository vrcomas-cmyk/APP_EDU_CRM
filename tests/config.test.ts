/**
 * Configuración de entorno.
 *
 * La prueba que importa aquí es la del guard contra la `service_role`. Un guard de seguridad
 * sin verificar es peor que no tenerlo: da la confianza sin dar la protección.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    verificarClaveAnonima, verificarEntornoCoincideConProyecto,
    APPS_SCRIPT_URL, SUPABASE_URL, SUPABASE_ANON_KEY, TIMEOUT_MS, ENTORNO
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

describe('guardarraíl de entorno (pruebas vs. producción)', () => {
    const OFICIAL = 'https://fiplfsuhsqibzrpvjvbx.supabase.co';
    const PRUEBA = 'https://cukxritzckostahasdsh.supabase.co';

    test('produccion + proyecto oficial: arranca', () => {
        assert.doesNotThrow(() => verificarEntornoCoincideConProyecto('produccion', OFICIAL));
    });

    test('pruebas + proyecto de prueba: arranca', () => {
        assert.doesNotThrow(() => verificarEntornoCoincideConProyecto('pruebas', PRUEBA));
    });

    test('produccion + proyecto de PRUEBA: no arranca', () => {
        // Este es el caso real que dispararía "producción" quedándose sin datos: alguien
        // copia el .env de la rama `pruebas` sobre `main` sin darse cuenta.
        assert.throws(
            () => verificarEntornoCoincideConProyecto('produccion', PRUEBA),
            /proyecto de PRUEBA/
        );
    });

    test('pruebas + proyecto OFICIAL: no arranca', () => {
        // El caso que de verdad importa evitar: la app de prueba escribiendo sobre datos
        // reales por un .env mal copiado en sentido contrario.
        assert.throws(
            () => verificarEntornoCoincideConProyecto('pruebas', OFICIAL),
            /proyecto OFICIAL/
        );
    });

    test('el .env real que está cargado ahora combina entorno y proyecto', () => {
        assert.doesNotThrow(() => verificarEntornoCoincideConProyecto(ENTORNO, SUPABASE_URL),
            'si esto falla, el propio .env con el que corre la suite está mal configurado');
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
