/**
 * @vitest-environment happy-dom
 *
 * ¿Arranca la aplicación?
 *
 * Existe por un fallo concreto: al mover los módulos al riel quité tres botones de
 * `index.html` y dejé vivo un `el.dashboard.addEventListener(...)` sobre un elemento que ya no
 * existía. Eso revienta en la primera línea del arranque y deja la pantalla en blanco —y
 * `tsc` no lo ve, porque `app.js` es JavaScript.
 *
 * Las 465 pruebas que había pasaban con la app rota. Ninguna la encendía.
 *
 * Esta la enciende: monta el HTML real, dispara `DOMContentLoaded` y comprueba que se pinte
 * algo. No sustituye abrir un navegador —no dice nada de cómo se ve— pero sí responde a la
 * única pregunta que ninguna otra respondía.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

/** El `<body>` real de index.html, sin los `<script>`. */
function cargarHTML() {
    const html = readFileSync(join(raiz, 'index.html'), 'utf8');
    const cuerpo = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? '';
    document.body.innerHTML = cuerpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

const errores: unknown[] = [];

beforeEach(() => {
    localStorage.clear();
    errores.length = 0;
    vi.resetModules();

    // Un error dentro de un manejador de eventos no rechaza ninguna promesa: se traga solo.
    // Se captura para poder afirmar que NO hubo.
    vi.spyOn(console, 'error').mockImplementation((...args) => {
        // Sin red, la carga de catálogos y del perfil fallan y lo REPORTAN: es el
        // comportamiento correcto offline, no un fallo del arranque. Lo que se vigila aquí es
        // que nada más se rompa.
        const texto = args.map(String).join(' ');
        if (/catálogos|perfil de permisos|conectar|fetch/i.test(texto)) return;
        errores.push(args);
    });

    cargarHTML();

    /**
     * Doble de Google Identity.
     *
     * `cargarGSI` hace cortocircuito si `window.google` ya existe, así que esto evita que se
     * inyecte el `<script>` real —que happy-dom rechaza con una excepción no capturable—. Es
     * además más fiel que dejarlo fallar: en producción GSI SÍ carga, y lo que se quiere
     * comprobar aquí es el arranque normal, no el degradado.
     */
    (globalThis as Record<string, unknown>).google = {
        accounts: { id: { initialize() {}, renderButton() {}, prompt() {}, disableAutoSelect() {} } }
    };

    localStorage.setItem('sesion', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x'
    }));
    localStorage.setItem('datosPWA', JSON.stringify({
        clientes: ['Cliente Uno'], sectores: ['GASAS'], origenes: ['BI']
    }));
});

afterEach(() => {
    // `app.js` deja un `setInterval` repintando el calendario cada minuto y no ofrece forma de
    // pararlo: en el navegador vive tanto como la pestaña. Aquí cada prueba enciende otra app,
    // y los temporizadores se acumulan sobre un `document` que ya no existe.
    //
    // No hace fallar ninguna prueba —todas pasan— pero happy-dom no logra cerrar el entorno
    // con ellos vivos: se queda esperando ~16 s y vitest mata el worker. El síntoma es
    // desconcertante, porque el informe dice que todo pasó y aun así la ejecución falla.
    for (const id of intervalos.splice(0)) clearInterval(id as number);

    // Sin esto los manejadores se acumulan sobre el mismo `document` y el de la primera prueba
    // atiende los eventos de la última, actuando sobre nodos que ya no están en la página.
    for (const o of oyentes.splice(0)) {
        document.removeEventListener(o.tipo, o.fn, o.opts as boolean | undefined);
    }

    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (globalThis as Record<string, unknown>).google;
});

/** Los listeners que la app colgó de `document`, para poder descolgarlos. */
const oyentes: Array<{ tipo: string; fn: EventListenerOrEventListenerObject; opts?: unknown }> = [];

/** Los temporizadores que registró la app durante el arranque, para poder pararlos. */
// El tipo del identificador cambia según se resuelva `setInterval` al del DOM o al de Node,
// y aquí da igual: solo se guarda para devolverlo a `clearInterval`.
const intervalos: unknown[] = [];

/**
 * Deja que React monte y corra sus efectos.
 *
 * Un microtask no basta: el arranque encadena render, efectos y un segundo pintado con el
 * perfil ya leído. Esperar de menos hace que la prueba falle por impaciencia y no por un bug,
 * que es la peor clase de prueba: enseña a desconfiar de la suite.
 */
const asentar = () => new Promise(r => setTimeout(r, 50));

/**
 * Enciende la app.
 *
 * Todo aquí es aislamiento. `vi.resetModules()` reimporta `app.js` en cada prueba, pero el
 * `document` NO se reinicia: sus listeners se acumulan, y cada uno cierra sobre la instancia
 * de módulos de SU prueba, con sus contenedores ya arrancados del DOM.
 *
 * Dos consecuencias, las dos vividas:
 *
 *   - `DOMContentLoaded`: despachando el evento, para la sexta prueba habría seis aplicaciones
 *     peleándose por el mismo `#main`. Por eso el arranque se captura y se INVOCA, que es lo
 *     mismo que hace el navegador pero sin arrastrar los anteriores.
 *
 *   - El resto (`keydown`, sobre todo): el manejador de la prueba 1 corre PRIMERO y gana. Con
 *     Ctrl+K, abría la paleta de su propia instancia —dentro de un contenedor que su `afterEach`
 *     ya había quitado—, así que la prueba 15 no veía nada y pasaba en solitario. Por eso se
 *     apuntan todos y se retiran al terminar.
 */
async function arrancar() {
    let arranque: (() => void) | null = null;

    const original = document.addEventListener.bind(document);
    const espia = vi.spyOn(document, 'addEventListener')
        .mockImplementation((tipo: string, fn: EventListenerOrEventListenerObject, ...resto) => {
            if (tipo === 'DOMContentLoaded') { arranque = fn as () => void; return; }
            oyentes.push({ tipo, fn, opts: resto[0] });
            return original(tipo, fn, ...resto);
        });

    const original_setInterval = globalThis.setInterval;
    const espiaTimer = vi.spyOn(globalThis, 'setInterval')
        .mockImplementation(((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
            const id = (original_setInterval as (...a: unknown[]) => unknown)(fn, ms, ...args);
            intervalos.push(id);
            return id;
        }) as unknown as typeof setInterval);

    const espiaDoc = espia;
    await import('../js/app.js');

    assert.ok(arranque, 'app.js debe registrar su arranque en DOMContentLoaded');

    // El arranque registra el grueso de los listeners: el espía sigue puesto durante la
    // llamada y se retira después.
    (arranque as () => void)();
    espiaDoc.mockRestore();

    await asentar();
    espiaTimer.mockRestore();
}

const perfil = (extra: Record<string, unknown> = {}) => {
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', rol: 'educador',
        es_admin: false, permisos: ['visitas.crear', 'visitas.consultar', 'dashboards.personal'],
        alcance: ['ana@x.com'], invitado: true, origen: 'prueba', ...extra
    }));
};

describe('arranque', () => {
    test('no revienta y sale del gate con sesión', async () => {
        perfil();
        await arrancar();

        assert.equal(document.getElementById('app')?.hidden, false,
            'con sesión la app debe mostrarse');
        assert.deepEqual(errores, [], `el arranque escribió errores: ${JSON.stringify(errores)}`);
    });

    test('pinta el calendario dentro de main', async () => {
        perfil();
        await arrancar();

        const main = document.getElementById('main')!;
        assert.ok(main.querySelector('.grid, .agenda-list'),
            'el calendario debe renderizarse: si no, la pantalla queda en blanco');
    });

    test('sin sesión muestra el gate y NO intenta pintar la app', async () => {
        localStorage.removeItem('sesion');
        await arrancar();

        assert.equal(document.getElementById('gate')?.hidden, false);
        assert.deepEqual(errores, []);
    });
});

describe('el riel de módulos', () => {
    test('un educador con tablero personal ve calendario e indicadores', async () => {
        perfil();
        await arrancar();

        const rotulos = [...document.querySelectorAll('.nav-item .nav-txt')].map(e => e.textContent);
        assert.deepEqual(rotulos, ['Calendario', 'Indicadores']);
    });

    test('sin permiso de tablero NO aparece el módulo', async () => {
        perfil({ permisos: ['visitas.crear', 'visitas.consultar'] });
        await arrancar();

        const rotulos = [...document.querySelectorAll('.nav-item .nav-txt')].map(e => e.textContent);
        assert.ok(!rotulos.includes('Indicadores'),
            'un botón que lleva a "no tienes permiso" es una promesa rota, y revela que el módulo existe');
    });

    test('un administrador los ve todos', async () => {
        perfil({ es_admin: true, rol: 'administrador' });
        await arrancar();

        const rotulos = [...document.querySelectorAll('.nav-item .nav-txt')].map(e => e.textContent);
        assert.ok(rotulos.includes('Administración'));
        assert.ok(rotulos.includes('Revisión'));
    });

    test('el calendario arranca marcado como activo', async () => {
        perfil();
        await arrancar();

        // Se busca el nodo y luego su rótulo, en vez de con un selector compuesto: happy-dom
        // no resuelve bien `.a.b .c`, y una prueba no debe fallar por el motor del DOM.
        const activo = [...document.querySelectorAll('.nav-item')]
            .find(b => b.classList.contains('is-activo'));

        assert.ok(activo, 'algún módulo debe estar marcado como activo');
        assert.equal(activo.querySelector('.nav-txt')?.textContent, 'Calendario');
        assert.equal(activo.getAttribute('aria-current'), 'page',
            'el estado activo también se anuncia a los lectores de pantalla');
    });

    test('cada opción lleva TEXTO, no solo un icono', async () => {
        perfil({ es_admin: true });
        await arrancar();

        for (const item of document.querySelectorAll('.nav-item')) {
            assert.ok((item.querySelector('.nav-txt')?.textContent || '').length > 0,
                'un icono solo no dice qué hay detrás');
            assert.ok((item.querySelector('.nav-txt-corto')?.textContent || '').length > 0,
                'y en móvil hace falta el rótulo corto');
        }
    });
});

describe('cambiar de módulo', () => {
    test('elegir Indicadores sustituye la vista', async () => {
        perfil();
        await arrancar();

        const boton = [...document.querySelectorAll('.nav-item')]
            .find(b => b.textContent?.includes('Indicadores')) as HTMLButtonElement;

        boton.click();
        await asentar();

        const main = document.getElementById('main')!;
        assert.ok(main.querySelector('.vista-dashboard'),
            `debe verse el tablero. errores=${JSON.stringify(errores)} main=${main.innerHTML.slice(0, 400)}`);
        assert.equal(main.querySelector('.grid'), null,
            'y el calendario debe dejar de ocupar la pantalla, no quedarse debajo');
    });

    test('el contexto de fechas se esconde fuera del calendario', async () => {
        perfil();
        await arrancar();

        const boton = [...document.querySelectorAll('.nav-item')]
            .find(b => b.textContent?.includes('Indicadores')) as HTMLButtonElement;

        boton.click();
        await asentar();

        assert.equal((document.getElementById('cal-modo') as HTMLElement).hidden, true,
            'dejarlo visible sugeriría que el selector de vistas sigue haciendo algo');
    });

    test('Revisión es una vista, no un modal encima del calendario', async () => {
        perfil({
            permisos: ['visitas.crear', 'visitas.consultar', 'dashboards.personal',
                       'evidencias.aprobar']
        });
        await arrancar();

        const boton = [...document.querySelectorAll('.nav-item')]
            .find(b => b.textContent?.includes('Revisión')) as HTMLButtonElement;

        assert.ok(boton, 'con permiso de aprobar evidencias, Revisión debe ofrecerse');

        boton.click();
        await asentar();

        const main = document.getElementById('main')!;
        assert.ok(main.querySelector('.vista-revision'), 'debe verse la bandeja');
        assert.equal(main.querySelector('.grid'), null,
            'el calendario deja la pantalla, no se queda debajo');
    });

    test('sin permiso de consultar visitas NO se ofrece Revisión', async () => {
        // La cola sale de `consultarVisitas()`, que sin ese permiso devuelve vacío siempre:
        // el botón prometería trabajo que no se puede ver.
        perfil({ permisos: ['evidencias.aprobar', 'dashboards.personal'] });
        await arrancar();

        const rotulos = [...document.querySelectorAll('.nav-item .nav-txt')].map(e => e.textContent);
        assert.ok(!rotulos.includes('Revisión'));
    });

    test('Administración también es una vista: ya no queda ningún modal', async () => {
        perfil({ es_admin: true, rol: 'administrador' });
        await arrancar();

        const boton = [...document.querySelectorAll('.nav-item')]
            .find(b => b.textContent?.includes('Administración')) as HTMLButtonElement;

        boton.click();
        await asentar();

        const main = document.getElementById('main')!;
        assert.ok(main.querySelector('.vista-admin'));
        assert.equal(main.querySelector('.grid'), null);

        // `.drawer-raiz` es el contenedor de los paneles modales. Con el drawer de visitas
        // cerrado no debe haber NINGUNO: revisión y administración montaban el suyo al
        // arrancar, aunque nadie los hubiera abierto.
        assert.equal(document.querySelectorAll('.drawer-raiz').length, 0,
            'ningún módulo monta ya un panel modal');
    });

    test('Ctrl+K abre la paleta de comandos', async () => {
        // La paleta se monta en su propio contenedor colgado de `document.body`, no dentro del
        // árbol de vistas: es `z-index: 55` y tiene que quedar por encima del drawer.
        perfil();
        await arrancar();

        assert.equal(document.querySelector('.paleta-raiz'), null, 'arranca cerrada');

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'k', ctrlKey: true, bubbles: true, cancelable: true
        }));
        await asentar();

        assert.ok(document.querySelector('.paleta-raiz'), 'Ctrl+K debe abrirla');
        assert.ok(document.querySelector('.paleta-opt'), 'y ofrecer sus acciones');
    });

    test('se puede volver al calendario', async () => {
        perfil();
        await arrancar();

        const item = (t: string) => [...document.querySelectorAll('.nav-item')]
            .find(b => b.textContent?.includes(t)) as HTMLButtonElement;

        item('Indicadores').click();
        await asentar();
        item('Calendario').click();
        await asentar();

        assert.ok(document.getElementById('main')!.querySelector('.grid, .agenda-list'));
    });
});
