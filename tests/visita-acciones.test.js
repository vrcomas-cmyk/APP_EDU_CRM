/**
 * `puedeIniciar`/`puedeFinalizar`: cuándo se puede marcar check-in y check-out.
 *
 * El check-in afirma "llegué y empecé". Para una visita a cliente eso exige tener a quién
 * —de ahí que pida `cliente`—; Administrativo/Evento no tiene a quién, así que exigir el
 * mismo dato ahí dejaba el botón deshabilitado para siempre sin explicar por qué.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { puedeIniciar, puedeFinalizar } from '../js/visita.js';
import { visita, checkIn } from './ayuda/fixtures.js';

describe('puedeIniciar', () => {
    test('una visita a cliente sí exige cliente', () => {
        assert.equal(puedeIniciar(visita({ cliente: 'Cliente Uno' })), true);
        assert.equal(puedeIniciar(visita({ cliente: '' })), false);
        assert.equal(puedeIniciar(visita({ cliente: '   ' })), false, 'espacios en blanco no cuentan');
    });

    test('administrativo y evento NO exigen cliente', () => {
        assert.equal(puedeIniciar(visita({ tipo: 'administrativo', cliente: undefined })), true);
        assert.equal(puedeIniciar(visita({ tipo: 'evento', cliente: undefined })), true);
    });

    test('cancelada o ya con check-in no se puede iniciar, sea el tipo que sea', () => {
        assert.equal(puedeIniciar(visita({ tipo: 'administrativo', estado: 'cancelada' })), false);
        assert.equal(puedeIniciar(visita({ tipo: 'administrativo', check_in: checkIn() })), false);
    });

    test('sin visita, false', () => {
        assert.equal(puedeIniciar(null), false);
    });
});

describe('puedeFinalizar', () => {
    test('exige check-in, sin importar el tipo', () => {
        assert.equal(puedeFinalizar(visita({ tipo: 'administrativo' })), false);
        assert.equal(puedeFinalizar(visita({ tipo: 'administrativo', check_in: checkIn() })), true);
    });
});
