/**
 * Comentarios: el recorte por MAX_LOCALES nunca debe descartar un pendiente (Fase 3 del plan
 * de migración a Supabase). Mismo bug que `tests/eventos-cola.test.js` — `slice(-0)` devuelve
 * el arreglo completo en vez de vacío — pero en `comentar()`.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { comentar, leerComentarios } from '../js/comentarios.js';

beforeEach(() => localStorage.clear());

describe('poda de la cola de comentarios', () => {
    test('con solo sincronizados, poda hasta MAX_LOCALES', () => {
        // MAX_LOCALES = 3000 en js/comentarios.js.
        const comentarios = Array.from({ length: 3005 }, (_, i) => ({
            id: `c-${i}`, ambito: 'visita', id_ambito: 'v-1', id_visita: 'v-1',
            cliente: '', hospital: '', texto: 'x', usuario: '', usuario_correo: '',
            momento: new Date().toISOString(), sincronizado: true
        }));
        localStorage.setItem('comentarios', JSON.stringify(comentarios));

        const r = comentar({ ambito: 'visita', idAmbito: 'v-1', texto: 'nuevo', visita: { id: 'v-1' } });

        assert.ok(r.ok, 'el comentario nuevo debe aceptarse');
        assert.equal(leerComentarios().length, 3000,
            'sin el fix, slice(-0) devolvía TODOS los sincronizados y esto crecía sin tope');
    });

    test('con más pendientes que MAX_LOCALES, ninguno se pierde', () => {
        const pendientes = Array.from({ length: 3000 }, (_, i) => ({
            id: `p-${i}`, ambito: 'visita', id_ambito: 'v-1', id_visita: 'v-1',
            cliente: '', hospital: '', texto: 'x', usuario: '', usuario_correo: '',
            momento: new Date().toISOString(), sincronizado: false
        }));
        localStorage.setItem('comentarios', JSON.stringify(pendientes));

        comentar({ ambito: 'visita', idAmbito: 'v-1', texto: 'nuevo', visita: { id: 'v-1' } });

        const pendientesGuardados = leerComentarios().filter(c => !c.sincronizado);
        assert.equal(pendientesGuardados.length, 3001,
            'los 3000 pendientes originales más el nuevo: ninguno se descarta');
    });
});
