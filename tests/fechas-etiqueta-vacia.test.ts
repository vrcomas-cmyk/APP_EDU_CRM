/**
 * Regresión: `etiquetaDiaLarga('')` producía "Undefined NaN De Undefined" en el encabezado de
 * `VisitaDrawer` para toda visita nueva, porque `nuevaVisita()` (fabricas.ts) deja `dia: ''` a
 * propósito hasta que el usuario elige fecha — y `desdeClave('')` da Invalid Date, de donde
 * salían los `undefined`/`NaN`. Encontrado en revisión visual UI/UX del 2026-09-04.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { etiquetaDiaLarga, claveHoy } from '../js/fechas.js';

describe('etiquetaDiaLarga con clave vacía o inválida', () => {
    test('cadena vacía no produce "Undefined NaN De Undefined"', () => {
        assert.equal(etiquetaDiaLarga(''), 'Sin fecha aún');
    });

    test('undefined tampoco revienta', () => {
        assert.equal(etiquetaDiaLarga(undefined as unknown as string), 'Sin fecha aún');
    });

    test('una clave con formato roto cae al mismo mensaje, no a NaN', () => {
        assert.equal(etiquetaDiaLarga('no-es-una-fecha'), 'Sin fecha aún');
    });

    test('una fecha válida sigue funcionando igual que antes', () => {
        assert.equal(etiquetaDiaLarga(claveHoy()).startsWith('Hoy ·'), true);
    });
});
