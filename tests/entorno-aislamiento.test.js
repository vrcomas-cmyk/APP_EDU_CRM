/**
 * Aislamiento de almacenamiento entre la app oficial y la de prueba (Fase 0/3 del plan de
 * migración a Supabase). Prueba el núcleo puro de `js/entorno.js` — no importa `js/app.js` ni
 * depende de qué `.env` cargó el proceso de test, por la misma razón que `config.test.ts`
 * prueba `verificarEntornoCoincideConProyecto` como función pura.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { claveEn, nombreDBEn } from '../js/entorno.js';

describe('prefijo de localStorage por entorno', () => {
    test('produccion no antepone nada: no romper claves ya guardadas en dispositivos reales', () => {
        assert.equal(claveEn('produccion', 'visitas'), 'visitas');
        assert.equal(claveEn('produccion', 'sesion'), 'sesion');
    });

    test('pruebas antepone "pruebas:"', () => {
        assert.equal(claveEn('pruebas', 'visitas'), 'pruebas:visitas');
        assert.equal(claveEn('pruebas', 'sesion'), 'pruebas:sesion');
    });

    test('la clave de un entorno nunca coincide con la del otro', () => {
        // Esto es lo que de verdad importa: si algún día "pruebas" y "produccion" produjeran
        // la misma clave para el mismo nombre, las dos apps volverían a compartir localStorage
        // en el mismo navegador — justo el bug que este módulo existe para evitar.
        for (const nombre of ['visitas', 'sesion', 'datosPWA', 'comentarios', 'eventos']) {
            assert.notEqual(claveEn('produccion', nombre), claveEn('pruebas', nombre));
        }
    });
});

describe('nombre de la base IndexedDB por entorno', () => {
    test('produccion usa el nombre tal cual', () => {
        assert.equal(nombreDBEn('produccion', 'visitas-db'), 'visitas-db');
    });

    test('pruebas usa una base separada', () => {
        assert.equal(nombreDBEn('pruebas', 'visitas-db'), 'visitas-db-pruebas');
    });

    test('nunca es la misma base para los dos entornos', () => {
        assert.notEqual(nombreDBEn('produccion', 'visitas-db'), nombreDBEn('pruebas', 'visitas-db'));
    });
});
