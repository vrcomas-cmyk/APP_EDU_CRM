/**
 * @vitest-environment happy-dom
 *
 * El canje del código de Google: un solo intento por código, la app se entera FUERA del ciclo
 * de reintento y la persona ve en qué paso va.
 *
 * Contexto: el código de Google es de un solo uso. Reintentar con el mismo después de que el
 * primer intento llegó daba `invalid_grant` ("Bad Request"), y una excepción al pintar la app
 * (dentro del mismo try) contaba como fallo de red y volvía a canjear.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { initAuth, pintarBotonEntrada } from '../js/auth.js';

const RESPUESTA_OK = {
    status: 'ok', sesion_token: 'tok', correo: 'ana@degasa.com', nombre: 'Ana',
    access_token: 'at', expira_en: 3600
};

const json = (cuerpo: unknown) => new Response(JSON.stringify(cuerpo), {
    status: 200, headers: { 'content-type': 'application/json' }
});

let contenedor: HTMLElement;

/** Un `google` falso cuyo popup "devuelve" el código `C1` en cuanto se le pide. */
function instalarGoogle() {
    (window as unknown as { google: unknown }).google = {
        accounts: { oauth2: { initCodeClient: () => {
            const c: Record<string, unknown> = {
                requestCode: () => (c.callback as (r: unknown) => void)({ code: 'C1' })
            };
            return c;
        } } }
    };
}

async function pulsar() {
    await vi.waitFor(() => assert.equal((contenedor.querySelector('button') as HTMLButtonElement).disabled, false));
    (contenedor.querySelector('button') as HTMLButtonElement).click();
}

beforeEach(() => {
    limpiarAlmacen();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    instalarGoogle();
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    contenedor.remove();
});

describe('canje del código de Google', () => {
    test('canjea una vez y avisa a la app con la sesión', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json(RESPUESTA_OK));
        vi.stubGlobal('fetch', fetchMock);
        const sesiones: unknown[] = [];
        initAuth({ onSesion: (s: unknown) => sesiones.push(s) });
        pintarBotonEntrada(contenedor);

        await pulsar();
        await vi.waitFor(() => assert.equal(sesiones.length, 1));

        assert.equal(fetchMock.mock.calls.length, 1);
        assert.equal((sesiones[0] as { correo: string }).correo, 'ana@degasa.com');
    });

    test('si la app falla al arrancar, NO se vuelve a canjear el mismo código', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json(RESPUESTA_OK));
        vi.stubGlobal('fetch', fetchMock);
        initAuth({ onSesion: () => { throw new Error('la app no pudo pintarse'); } });
        pintarBotonEntrada(contenedor);

        await pulsar();
        await vi.advanceTimersByTimeAsync(5000);

        assert.equal(fetchMock.mock.calls.length, 1,
            'un fallo de la app no es un fallo de red: reintentar gastaba el código y daba "Bad Request"');
        assert.match(contenedor.textContent || '', /Recarga la página/);
    });

    test('un corte de red se reintenta con el mismo código y entra', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(json(RESPUESTA_OK));
        vi.stubGlobal('fetch', fetchMock);
        const sesiones: unknown[] = [];
        initAuth({ onSesion: (s: unknown) => sesiones.push(s) });
        pintarBotonEntrada(contenedor);

        await pulsar();
        await vi.advanceTimersByTimeAsync(1000);
        await vi.waitFor(() => assert.equal(sesiones.length, 1));

        assert.equal(fetchMock.mock.calls.length, 2);
    });

    test('si el reintento recibe "ya usado", pide pulsar de nuevo en vez de enseñar un Bad Request', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce(json({ status: 'error', message: 'Bad Request' }));
        vi.stubGlobal('fetch', fetchMock);
        initAuth({ onSesion: () => {} });
        pintarBotonEntrada(contenedor);

        await pulsar();
        await vi.advanceTimersByTimeAsync(1000);
        await vi.waitFor(() => assert.match(contenedor.textContent || '', /interrumpió/));

        assert.doesNotMatch(contenedor.textContent || '', /Bad Request/);
        assert.equal((contenedor.querySelector('button') as HTMLButtonElement).disabled, false,
            'el botón queda libre para pedir un código nuevo');
    });

    test('mientras canjea se ve en qué paso va y el botón no admite un segundo clic', async () => {
        let resolver: (r: Response) => void = () => {};
        vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(r => { resolver = r; })));
        initAuth({ onSesion: () => {} });
        pintarBotonEntrada(contenedor);

        await pulsar();

        const paso = contenedor.querySelector('.gate-paso') as HTMLElement;
        await vi.waitFor(() => assert.match(paso.textContent || '', /Verificando tu cuenta/));
        assert.equal(paso.hidden, false);
        assert.equal((contenedor.querySelector('button') as HTMLButtonElement).disabled, true);

        resolver(json(RESPUESTA_OK));
    });
});
