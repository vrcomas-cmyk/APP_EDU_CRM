/**
 * Puente visita ↔ Google Calendar.
 *
 * Silencioso por diseño: sin conexión a Calendar, no debe intentar nada ni marcar error. Con
 * conexión, guarda el id que Calendar devuelve para poder actualizar el mismo evento después
 * en vez de crear uno nuevo cada vez.
 */

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

const estado = { conectado: false };

vi.mock('@core/puente', () => ({
    tieneAccesoCalendar: () => estado.conectado,
    sincronizarEventoVisita: vi.fn(async () => 'evt-123'),
    borrarEventoVisita: vi.fn(async () => {})
}));

import { reflejarEnCalendar, quitarDeCalendar } from '@modules/visitas/services/calendarSync';
import * as puente from '@core/puente';
import type { Visita } from '@core/tipos';

const visita: Visita = {
    id: 'v-1', cliente: 'Cliente Uno', dia: '2026-07-21',
    hora_inicio: '09:00', hora_fin: '10:00'
};

beforeEach(() => {
    estado.conectado = false;
    vi.clearAllMocks();
});

describe('reflejarEnCalendar', () => {
    test('sin Calendar conectado, no llama a la API ni al editar', async () => {
        const editar = vi.fn();
        await reflejarEnCalendar(visita, editar);

        assert.equal((puente.sincronizarEventoVisita as ReturnType<typeof vi.fn>).mock.calls.length, 0);
        assert.equal(editar.mock.calls.length, 0);
    });

    test('conectado, guarda el id que Calendar devolvió', async () => {
        estado.conectado = true;
        const editar = vi.fn((mutador: (v: Visita) => void) => {
            const copia = { ...visita };
            mutador(copia);
            assert.equal(copia.calendar_event_id, 'evt-123');
        });

        await reflejarEnCalendar(visita, editar);
        assert.equal(editar.mock.calls.length, 1);
    });

    test('si Calendar responde el mismo id que ya tenía, no reescribe', async () => {
        estado.conectado = true;
        const yaSincronizada = { ...visita, calendar_event_id: 'evt-123' };
        const editar = vi.fn();

        await reflejarEnCalendar(yaSincronizada, editar);
        assert.equal(editar.mock.calls.length, 0);
    });
});

describe('quitarDeCalendar', () => {
    test('sin Calendar conectado, no llama a borrar', async () => {
        await quitarDeCalendar({ ...visita, calendar_event_id: 'evt-123' });
        assert.equal((puente.borrarEventoVisita as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    });

    test('conectado y con evento, lo borra', async () => {
        estado.conectado = true;
        await quitarDeCalendar({ ...visita, calendar_event_id: 'evt-123' });
        assert.deepEqual(
            (puente.borrarEventoVisita as ReturnType<typeof vi.fn>).mock.calls[0],
            ['evt-123']
        );
    });

    test('conectado pero sin evento previo, no llama a borrar', async () => {
        estado.conectado = true;
        await quitarDeCalendar(visita);
        assert.equal((puente.borrarEventoVisita as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    });
});
