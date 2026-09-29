/**
 * Toda fecha mostrada va en dd/mm/aaaa (ver memoria del proyecto). `fechaCorta` corta las claves
 * 'YYYY-MM-DD' sin pasar por Date; los instantes con zona se muestran en hora LOCAL — su fecha
 * UTC puede ser el día siguiente.
 */
import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { fechaCorta, fechaHoraCorta } from '../js/fechas.js';

describe('fechaCorta', () => {
    test('una clave de día se lee dd/mm/aaaa, sin corrimiento de zona', () => {
        assert.equal(fechaCorta('2026-09-29'), '29/09/2026');
    });

    test('un datetime-local (sin zona) conserva su día', () => {
        assert.equal(fechaCorta('2026-09-29T23:30'), '29/09/2026');
    });

    test('un instante con zona usa la fecha LOCAL, no la UTC', () => {
        const local = new Date(2026, 8, 29, 19, 0);          // 29/09/2026 19:00 en la zona del equipo
        assert.equal(fechaCorta(local.toISOString()), '29/09/2026');
    });

    test('vacío y basura no revientan', () => {
        assert.equal(fechaCorta(''), '');
        assert.equal(fechaCorta(null), '');
        assert.equal(fechaCorta('no es fecha'), 'no es fecha');
    });
});

describe('fechaHoraCorta', () => {
    test('dd/mm/aaaa HH:MM en hora local', () => {
        assert.equal(fechaHoraCorta(new Date(2026, 6, 5, 9, 5)), '05/07/2026 09:05');
        assert.equal(fechaHoraCorta(new Date(2026, 6, 5, 9, 5).toISOString()), '05/07/2026 09:05');
    });

    test('ilegible o vacío → cadena vacía', () => {
        assert.equal(fechaHoraCorta(undefined), '');
        assert.equal(fechaHoraCorta('nada'), '');
    });
});
