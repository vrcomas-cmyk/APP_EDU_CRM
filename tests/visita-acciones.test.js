/**
 * `puedeIniciar`/`puedeFinalizar`: cuándo se puede marcar check-in y check-out.
 *
 * El check-in afirma "llegué y empecé". Para una visita a cliente eso exige tener a quién
 * —de ahí que pida `cliente`—; Administrativo/Evento no tiene a quién, así que exigir el
 * mismo dato ahí dejaba el botón deshabilitado para siempre sin explicar por qué.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { puedeIniciar, puedeFinalizar, iniciarVisita } from '../js/visita.js';
import { agregarVisita } from '../js/storage.js';
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

describe('iniciarVisita — blindaje contra dos visitas abiertas a la vez', () => {
    beforeEach(() => limpiarAlmacen());

    test('con otra visita del mismo educador ya abierta, el segundo check-in se rechaza', async () => {
        const correo = 'ana@degasa.com';
        agregarVisita(visita({
            id: 'v-abierta', educador_correo: correo, cliente: 'Hospital Uno',
            check_in: checkIn(), estado: 'en-proceso'
        }));
        const segunda = agregarVisita(visita({ id: 'v-nueva', educador_correo: correo, cliente: 'Hospital Dos' }));

        const r = await iniciarVisita(segunda.id);

        assert.equal(r.ok, false);
        assert.match(r.error, /Hospital Uno/, 'el mensaje debe decir CUÁL visita quedó abierta');
    });

    test('la visita abierta de OTRO educador no bloquea', async () => {
        agregarVisita(visita({
            id: 'v-de-otro', educador_correo: 'beto@degasa.com', cliente: 'Hospital Uno',
            check_in: checkIn(), estado: 'en-proceso'
        }));
        const mia = agregarVisita(visita({ id: 'v-mia', educador_correo: 'ana@degasa.com', cliente: 'Hospital Dos' }));

        const r = await iniciarVisita(mia.id);

        assert.equal(r.ok, true);
    });

    test('una visita ya cerrada (con check-out) no cuenta como abierta', async () => {
        const correo = 'ana@degasa.com';
        agregarVisita(visita({
            id: 'v-cerrada', educador_correo: correo, cliente: 'Hospital Uno',
            check_in: checkIn(), check_out: checkIn(), estado: 'finalizada'
        }));
        const nueva = agregarVisita(visita({ id: 'v-nueva', educador_correo: correo, cliente: 'Hospital Dos' }));

        const r = await iniciarVisita(nueva.id);

        assert.equal(r.ok, true);
    });

    test('una visita cancelada con check-in no cuenta como abierta', async () => {
        const correo = 'ana@degasa.com';
        agregarVisita(visita({
            id: 'v-cancelada', educador_correo: correo, cliente: 'Hospital Uno',
            check_in: checkIn(), estado: 'cancelada'
        }));
        const nueva = agregarVisita(visita({ id: 'v-nueva', educador_correo: correo, cliente: 'Hospital Dos' }));

        const r = await iniciarVisita(nueva.id);

        assert.equal(r.ok, true);
    });
});
