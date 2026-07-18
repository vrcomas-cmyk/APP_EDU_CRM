/**
 * Generación del service worker.
 *
 * Es lo que decide si la app funciona sin señal, que en esta aplicación no es un caso borde:
 * se usa dentro de hospitales, donde abrir sin cobertura es lo normal.
 *
 * El riesgo concreto que cubren estas pruebas es que `cache.addAll` falla ENTERO si un solo
 * archivo de la lista no existe — y un service worker que no se instala no avisa a nadie, solo
 * deja la app rota offline en los teléfonos que ya la tenían.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { generarSW, listaDeAssets } from '../src/app/generarSW';

const construidos = [
    'index.html',
    'assets/index-abc123.js',
    'assets/index-def456.css',
    'assets/react-ghi789.js',
    'assets/index-abc123.js.map',
    'icon.svg',
    'manifest.json'
];

describe('listaDeAssets', () => {
    test('incluye la raíz y el shell siempre', () => {
        const assets = listaDeAssets([]);
        assert.ok(assets.includes('./'), 'sin la raíz no hay desde dónde arrancar offline');
        assert.ok(assets.includes('./index.html'));
    });

    test('recoge js, css, svg y json del build', () => {
        const assets = listaDeAssets(construidos);

        assert.ok(assets.includes('./assets/index-abc123.js'));
        assert.ok(assets.includes('./assets/index-def456.css'));
        assert.ok(assets.includes('./icon.svg'), 'sin el ícono, la app instalada pierde su identidad');
        assert.ok(assets.includes('./manifest.json'));
    });

    test('excluye los mapas de fuente', () => {
        const assets = listaDeAssets(construidos);
        assert.ok(!assets.some(a => a.endsWith('.map')),
            'pesan cientos de KB y no sirven de nada sin conexión');
    });

    test('no repite la raíz ni el shell si ya venían en la lista', () => {
        const assets = listaDeAssets(['index.html', 'index.html']);
        assert.equal(assets.filter(a => a === './index.html').length, 1,
            'un duplicado en addAll no falla, pero descarga el archivo dos veces');
    });

    test('normaliza las rutas a relativas', () => {
        const assets = listaDeAssets(['assets/x.js']);
        assert.ok(assets.includes('./assets/x.js'));
        assert.ok(!assets.includes('assets/x.js'));
    });

    test('respeta las que ya vienen absolutas', () => {
        assert.ok(listaDeAssets(['/assets/x.js']).includes('/assets/x.js'));
    });

    test('el orden es estable, para que dos builds iguales den el mismo archivo', () => {
        const a = listaDeAssets([...construidos]);
        const b = listaDeAssets([...construidos].reverse());
        assert.deepEqual(a, b);
    });
});

describe('generarSW', () => {
    const sw = generarSW({ archivos: construidos, version: 'v1234abcd' });

    test('declara la versión en el nombre del caché', () => {
        assert.match(sw, /const CACHE_NAME = 'visitas-pwa-v1234abcd';/,
            'sin cambiar el nombre, los navegadores siguen sirviendo la versión vieja');
    });

    test('purga los cachés que no son el actual', () => {
        assert.match(sw, /caches\.delete/);
        assert.match(sw, /llave !== CACHE_NAME/,
            'sin purgar, cada despliegue deja la copia anterior ocupando cuota para siempre');
    });

    test('NUNCA cachea el backend ni la identidad', () => {
        for (const host of ['script.google.com', 'accounts.google.com', 'supabase.co']) {
            assert.ok(sw.includes(host),
                `${host} debe quedar excluido: una copia vieja del script de sesión deja a alguien atascado en un login que ya no funciona`);
        }
    });

    test('la navegación se responde con el shell cacheado', () => {
        assert.match(sw, /mode === 'navigate'/,
            'sin esto, abrir la app sin señal en una URL cualquiera da error de red');
    });

    test('toma el control de inmediato', () => {
        assert.match(sw, /skipWaiting/);
        assert.match(sw, /clients\.claim/);
    });

    test('el resultado es JavaScript válido', () => {
        assert.doesNotThrow(() => new Function(`
            const self = { addEventListener() {} };
            const caches = {};
            ${sw}
        `), 'un SW con error de sintaxis no se instala y nadie se entera');
    });

    test('avisa de que no se edite a mano', () => {
        assert.match(sw, /No editar a mano/,
            'sin el aviso, alguien edita el archivo y el siguiente build lo pisa en silencio');
    });
});
