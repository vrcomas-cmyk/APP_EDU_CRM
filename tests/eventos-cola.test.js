/**
 * Bitácora de eventos: el recorte por MAX_LOCALES nunca debe descartar un pendiente (Fase 3
 * del plan de migración a Supabase).
 *
 * Existe por un bug real que se encontró al escribir esta fase: `slice(-0)` en JavaScript
 * devuelve el arreglo COMPLETO, no vacío (`-0 === 0`). Cuando los eventos pendientes por sí
 * solos ya llenaban o superaban `MAX_LOCALES`, la poda de sincronizados calculaba
 * `conservar = 0` y `subidos.slice(-0)` colaba TODOS los sincronizados de vuelta — la
 * bitácora crecía sin límite en vez de taparse. La prueba fija ese caso exacto.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { registrar, leerEventos, TIPOS } from '../js/eventos.js';

beforeEach(() => localStorage.clear());

describe('poda de la bitácora de eventos', () => {
    test('con solo sincronizados, poda hasta MAX_LOCALES', () => {
        // MAX_LOCALES = 2000 en js/eventos.js. Con 2005 sincronizados y ninguno pendiente,
        // debe quedar exactamente en el tope, no crecer sin límite.
        const eventos = Array.from({ length: 2005 }, (_, i) => ({
            id: `e-${i}`, tipo: TIPOS.CHECK_IN, momento: new Date().toISOString(),
            id_visita: 'v-1', cliente: '', hospital: '', educador: '', educador_correo: '',
            dispositivo: '', datos: {}, sincronizado: true
        }));
        localStorage.setItem('eventos', JSON.stringify(eventos));

        registrar(TIPOS.CHECK_IN, { id: 'v-1' }); // dispara la poda al pasar de 2000

        assert.equal(leerEventos().length, 2000,
            'sin el fix, slice(-0) devolvía TODOS los sincronizados y esto crecía sin tope');
    });

    test('con más pendientes que MAX_LOCALES, ninguno se pierde', () => {
        const pendientes = Array.from({ length: 2000 }, (_, i) => ({
            id: `p-${i}`, tipo: TIPOS.CHECK_IN, momento: new Date().toISOString(),
            id_visita: 'v-1', cliente: '', hospital: '', educador: '', educador_correo: '',
            dispositivo: '', datos: {}, sincronizado: false
        }));
        const sincronizados = Array.from({ length: 50 }, (_, i) => ({
            id: `s-${i}`, tipo: TIPOS.CHECK_IN, momento: new Date().toISOString(),
            id_visita: 'v-1', cliente: '', hospital: '', educador: '', educador_correo: '',
            dispositivo: '', datos: {}, sincronizado: true
        }));
        localStorage.setItem('eventos', JSON.stringify([...sincronizados, ...pendientes]));

        registrar(TIPOS.CHECK_IN, { id: 'v-1' });

        const guardados = leerEventos();
        const pendientesGuardados = guardados.filter(e => !e.sincronizado);
        assert.equal(pendientesGuardados.length, 2001,
            'los 2000 pendientes originales más el que se acaba de registrar: ninguno se descarta');
    });
});
