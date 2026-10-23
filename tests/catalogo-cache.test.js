/**
 * `leerCatalogo()` reutiliza el objeto ya parseado.
 *
 * El catálogo pesa ~1.3 MB y casi cada helper de `catalogos.js` lo lee; parsearlo en cada llamada
 * bloqueaba el hilo principal 2-4 s tras cada sincronización. La caché se valida contra el texto
 * guardado, así que lo importante de probar es que NUNCA devuelva datos viejos.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';
import { leerCatalogo, guardarCatalogo } from '../js/storage.js';

beforeEach(() => limpiarAlmacen());

describe('leerCatalogo — caché del objeto parseado', () => {
    test('dos lecturas seguidas devuelven el mismo objeto (no se re-parsea)', () => {
        guardarCatalogo({ sectores: ['GASAS'] });
        const a = leerCatalogo();
        assert.deepEqual(a, { sectores: ['GASAS'] });
        assert.equal(leerCatalogo(), a);
    });

    test('tras guardarCatalogo devuelve el contenido nuevo', () => {
        guardarCatalogo({ sectores: ['GASAS'] });
        leerCatalogo();
        guardarCatalogo({ sectores: ['GUANTES'] });
        assert.deepEqual(leerCatalogo(), { sectores: ['GUANTES'] });
    });

    test('una escritura directa a localStorage (otra pestaña) tampoco devuelve datos viejos', () => {
        guardarCatalogo({ sectores: ['GASAS'] });
        leerCatalogo();
        localStorage.setItem('datosPWA', JSON.stringify({ sectores: ['SUTURAS'] }));
        assert.deepEqual(leerCatalogo(), { sectores: ['SUTURAS'] });
    });

    test('si el catálogo se borra, devuelve null y no el último conocido', () => {
        guardarCatalogo({ sectores: ['GASAS'] });
        leerCatalogo();
        limpiarAlmacen();
        assert.equal(leerCatalogo(), null);
    });
});
