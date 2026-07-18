/**
 * Capa de servicios.
 *
 * Es la única frontera con el exterior, así que es donde tiene que estar el cuidado: aquí se
 * decide qué cuenta como fallo, qué se reintenta y qué no. Un error mal clasificado produce
 * una cola que nunca vacía o una fila que se marca como subida sin haberse escrito.
 *
 * Todo se prueba con dobles explícitos. Ninguna prueba toca la red.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { pedirJSON, ErrorDeRed, hayConexion } from '@services/http';
import { postear, leerCatalogos, configurarToken } from '@services/google/appsScript';
import { rpc, rpcEstricto } from '@services/supabase/rpc';
import { APPS_SCRIPT_URL } from '@services/config';

/** Respuesta de mentira con la forma mínima que consume la capa de servicios. */
function respuesta(cuerpo: unknown, { ok = true, status = 200, statusText = 'OK' } = {}) {
    const texto = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    return {
        ok, status, statusText,
        text: async () => texto,
        json: async () => JSON.parse(texto)
    } as unknown as Response;
}

type Llamada = [string, RequestInit | undefined];

/**
 * Sustituye `fetch` por un doble TIPADO y devuelve un lector de sus llamadas.
 *
 * El tipo explícito no es adorno: sin él el mock se infiere sin parámetros y cada aserción
 * sobre las cabeceras necesita un `as` que apaga justo la comprobación que interesa.
 */
function espiarFetch(responder: (url: string, init?: RequestInit) => Promise<Response>) {
    const espia = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(responder);
    globalThis.fetch = espia as unknown as typeof fetch;

    return {
        espia,
        llamada(i = 0): { url: string; init: RequestInit; cabeceras: Record<string, string> } {
            const args = espia.mock.calls[i] as Llamada | undefined;
            assert.ok(args, `no hubo llamada número ${i} a fetch`);
            const init = args[1] ?? {};
            return { url: args[0], init, cabeceras: (init.headers ?? {}) as Record<string, string> };
        }
    };
}

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; vi.restoreAllMocks(); });

describe('pedirJSON', () => {
    test('devuelve el cuerpo interpretado', async () => {
        globalThis.fetch = vi.fn(async () => respuesta({ hola: 'mundo' })) as never;
        assert.deepEqual(await pedirJSON('/x'), { hola: 'mundo' });
    });

    test('una respuesta vacía no revienta', async () => {
        globalThis.fetch = vi.fn(async () => respuesta('')) as never;
        assert.equal(await pedirJSON('/x'), undefined);
    });

    test('un cuerpo que no es JSON lanza ErrorDeRed, no SyntaxError', async () => {
        globalThis.fetch = vi.fn(async () => respuesta('<html>error 500</html>')) as never;

        await assert.rejects(() => pedirJSON('/x'), (err: Error) => {
            assert.ok(err instanceof ErrorDeRed,
                'un proxy que devuelve HTML es un fallo de red, no un bug de parseo');
            return true;
        });
    });

    test('un HTTP de error incluye el detalle del cuerpo', async () => {
        globalThis.fetch = vi.fn(async () =>
            respuesta('permiso denegado', { ok: false, status: 403, statusText: 'Forbidden' })) as never;

        await assert.rejects(() => pedirJSON('/x'), (err: ErrorDeRed) => {
            assert.equal(err.estado, 403);
            assert.match(err.message, /permiso denegado/);
            return true;
        });
    });

    test('solo manda Content-Type cuando hay cuerpo', async () => {
        const { llamada } = espiarFetch(async () => respuesta({}));

        await pedirJSON('/x');
        assert.equal(llamada(0).cabeceras['Content-Type'], undefined);

        await pedirJSON('/x', { metodo: 'POST', cuerpo: { a: 1 } });
        assert.equal(llamada(1).cabeceras['Content-Type'], 'application/json');
    });

    test('aborta al vencer el tiempo y lo dice en el mensaje', async () => {
        globalThis.fetch = vi.fn((_url, init?: RequestInit) => new Promise((_, rechazar) => {
            init?.signal?.addEventListener('abort', () => {
                const err = new Error('abortado');
                err.name = 'AbortError';
                rechazar(err);
            });
        })) as never;

        await assert.rejects(() => pedirJSON('/x', { timeoutMs: 10 }), (err: ErrorDeRed) => {
            assert.ok(err instanceof ErrorDeRed);
            assert.match(err.message, /tardó más de 10 ms/);
            assert.equal(err.estado, null);
            return true;
        });
    });
});

describe('ErrorDeRed.esTransitorio — de esto depende que una cola vacíe', () => {
    const de = (estado: number | null) => new ErrorDeRed('x', '/u', estado).esTransitorio;

    test('sin respuesta se reintenta: pudo ser la señal', () => {
        assert.equal(de(null), true);
    });

    test('los 5xx se reintentan', () => {
        assert.equal(de(500), true);
        assert.equal(de(503), true);
    });

    test('408 y 429 se reintentan', () => {
        assert.equal(de(408), true);
        assert.equal(de(429), true);
    });

    test('los 4xx de permiso o de datos NO se reintentan', () => {
        for (const estado of [400, 401, 403, 404, 422]) {
            assert.equal(de(estado), false,
                `reintentar un ${estado} para siempre es cómo se hace una cola que nunca vacía`);
        }
    });
});

describe('Apps Script', () => {
    beforeEach(() => configurarToken(() => 'token-de-prueba'));

    test('declara text/plain para no disparar el preflight', async () => {
        const { llamada } = espiarFetch(async () => respuesta({ status: 'ok' }));

        await postear({ accion: 'guardarVisitas' });
        const tipo = llamada().cabeceras['Content-Type'];

        assert.ok(tipo);
        assert.match(tipo, /^text\/plain/,
            'Apps Script no responde OPTIONS: application/json rompe la sincronización entera');
    });

    test('el id_token viaja en el CUERPO, no en una cabecera', async () => {
        const { llamada } = espiarFetch(async () => respuesta({ status: 'ok' }));

        await postear({ accion: 'x' });

        const { init, cabeceras } = llamada();
        assert.equal(JSON.parse(init.body as string).id_token, 'token-de-prueba');
        assert.equal(cabeceras['Authorization'], undefined,
            'una cabecera de autorización dispararía el preflight que se está evitando');
    });

    test('un 200 con status:error SÍ es un fallo', async () => {
        globalThis.fetch = vi.fn(async () =>
            respuesta({ status: 'error', message: 'Token vencido' })) as never;

        await assert.rejects(() => postear({ accion: 'x' }), (err: Error) => {
            assert.match(err.message, /Token vencido/);
            return true;
        });
        // Si no se mirara, la fila se marcaría como sincronizada sin haberse escrito nunca.
    });

    test('una respuesta ilegible se trata como vacía, no como error', async () => {
        globalThis.fetch = vi.fn(async () => ({
            ok: true, status: 200, statusText: 'OK',
            json: async () => { throw new Error('no es json'); }
        })) as unknown as never;

        assert.deepEqual(await postear({ accion: 'x' }), {});
    });

    test('un HTTP de error se propaga con su código', async () => {
        globalThis.fetch = vi.fn(async () => respuesta('', { ok: false, status: 502 })) as never;

        await assert.rejects(() => postear({ accion: 'x' }), (err: ErrorDeRed) => {
            assert.equal(err.estado, 502);
            assert.equal(err.esTransitorio, true);
            return true;
        });
    });

    test('sin proveedor de token manda cadena vacía, no revienta', async () => {
        configurarToken(() => '');
        const { llamada } = espiarFetch(async () => respuesta({ status: 'ok' }));

        await postear({ accion: 'x' });
        assert.equal(JSON.parse(llamada().init.body as string).id_token, '',
            'el servidor lo rechaza con un mensaje claro; comprobarlo aquí duplicaría la regla');
    });

    test('leerCatalogos usa GET contra la misma URL', async () => {
        const { llamada } = espiarFetch(async () => respuesta({ sectores: ['GASAS'] }));

        assert.deepEqual(await leerCatalogos(), { sectores: ['GASAS'] });
        assert.equal(llamada().url, APPS_SCRIPT_URL);
    });
});

describe('Supabase RPC', () => {
    test('manda la clave pública en apikey y en Authorization', async () => {
        const { llamada } = espiarFetch(async () => respuesta({ ok: true }));

        await rpcEstricto('pdt_perfil', { correo: 'ana@x.com' });

        const { url, init, cabeceras } = llamada();
        assert.match(url, /\/rest\/v1\/rpc\/pdt_perfil$/);
        assert.equal(init.method, 'POST');

        assert.ok(cabeceras['apikey']);
        assert.ok(cabeceras['Authorization']);
        assert.match(cabeceras['Authorization'], /^Bearer /);
        assert.deepEqual(JSON.parse(init.body as string), { correo: 'ana@x.com' });
    });

    test('rpc devuelve null ante un fallo en vez de tumbar el arranque', async () => {
        globalThis.fetch = vi.fn(async () => respuesta('', { ok: false, status: 500 })) as never;
        vi.spyOn(console, 'error').mockImplementation(() => {});

        assert.equal(await rpc('pdt_perfil'), null,
            'un Supabase caído no debe dejar sin app a quien solo quiere capturar offline');
    });

    test('rpcEstricto sí propaga, para quien pueda actuar ante el fallo', async () => {
        globalThis.fetch = vi.fn(async () => respuesta('', { ok: false, status: 500 })) as never;
        await assert.rejects(() => rpcEstricto('pdt_perfil'));
    });

    test('un 42501 no se reintenta: es permiso, no red', async () => {
        globalThis.fetch = vi.fn(async () =>
            respuesta('permission denied', { ok: false, status: 403 })) as never;

        await assert.rejects(() => rpcEstricto('pdt_espejo_guardar'), (err: ErrorDeRed) => {
            assert.equal(err.esTransitorio, false);
            return true;
        });
    });
});

describe('hayConexion', () => {
    test('sin navigator asume que sí, para no bloquear en Node', () => {
        assert.equal(hayConexion(), true);
    });
});
