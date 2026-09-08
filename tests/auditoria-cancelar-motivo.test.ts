/**
 * REQUISITO DE NEGOCIO: "Cancelar con motivo" / "el motivo del cambio es obligatorio".
 *
 * `reagendarVisita` sí lo exige a nivel de función de dominio (`js/visita.js:103`). `cancelarVisita`
 * NO: acepta `motivo || ''` sin validar (`js/visita.js:147-156`) y solo el botón del drawer
 * deshabilita el envío si el campo está vacío (`VisitaDrawer.tsx:508`). Cualquier otro caller de
 * `cancelarVisita` —una futura pantalla, un script, la consola— puede cancelar una visita sin
 * dejar motivo, y nada en la capa de dominio lo impide.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { agregarVisita } from '../js/storage.js';
import { cancelarVisita } from '../js/visita.js';
import { visita } from './ayuda/fixtures.js';

beforeEach(() => limpiarAlmacen());

describe('cancelarVisita exige motivo, igual que reagendarVisita', () => {
    test('REQUISITO: cancelar sin motivo debe rechazarse', () => {
        const v = agregarVisita(visita({ estado: 'programada' }));

        const r = cancelarVisita(v.id, '') as any;

        assert.equal(r.ok, false,
            'cancelarVisita(id, "") no debe tener éxito: el motivo de cancelación es obligatorio '
            + 'por requerimiento de negocio, igual que ya lo es para reagendar (js/visita.js:103). '
            + 'Hoy la función de dominio lo acepta (js/visita.js:147-156) y solo un botón de UI '
            + '(VisitaDrawer.tsx:508) impide el caso vacío desde esa pantalla en particular.');
    });

    test('REQUISITO: cancelar con motivo de solo espacios debe rechazarse', () => {
        const v = agregarVisita(visita({ estado: 'programada' }));

        const r = cancelarVisita(v.id, '   ') as any;

        assert.equal(r.ok, false, 'un motivo de solo espacios no es un motivo real');
    });

    test('con motivo real, cancela y lo conserva', () => {
        const v = agregarVisita(visita({ estado: 'programada' }));

        const r = cancelarVisita(v.id, 'El cliente reprogramó la reunión.') as any;

        assert.equal(r.ok, true);
        assert.equal(r.visita?.motivo_cancelacion, 'El cliente reprogramó la reunión.');
    });
});
