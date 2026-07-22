/**
 * @vitest-environment happy-dom
 *
 * Los compromisos de Google Calendar dentro de la rejilla de horas.
 *
 * Archivo aparte de `Calendario.test.tsx` a propósito: mockear `tieneAccesoCalendar` para
 * probar esto afectaría a las ~30 pruebas de ese archivo, que dependen del comportamiento
 * real (sin Calendar conectado, que es el caso por defecto).
 */

import { test, describe, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { render, cleanup } from '@testing-library/react';
import { act } from 'react';

const compromisos = [
    { id: 'c-1', titulo: 'Junta de zona', inicio: '', fin: '', todoElDia: false, url: 'https://calendar.google.com/x' },
    { id: 'c-2', titulo: 'Capacitación anual', inicio: '', fin: '', todoElDia: true, url: '' }
];

vi.mock('@core/puente', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    tieneAccesoCalendar: () => true,
    listarCompromisos: async (desdeISO: string) => {
        const dia = desdeISO.slice(0, 10);
        return compromisos.map(c => ({
            ...c,
            inicio: c.todoElDia ? dia : `${dia}T10:00:00.000Z`,
            fin: c.todoElDia ? dia : `${dia}T11:00:00.000Z`
        }));
    }
}));

import { Calendario } from '@modules/agenda/components/Calendario';
import { guardarVisitas } from '../js/storage.js';

const nada = () => {};

afterEach(cleanup);

describe('compromisos de Calendar en la rejilla', () => {
    test('un compromiso con hora se dibuja como bloque de solo lectura', async () => {
        guardarVisitas([]);
        await act(async () => {
            render(
                <Calendario version={1} onAbrirVisita={nada} onCrearEn={nada} onCambio={nada} avisar={nada} />
            );
        });

        const bloque = document.querySelector('.compromiso-externo');
        assert.ok(bloque, 'el compromiso con hora debe pintarse en la rejilla');
        assert.match(bloque!.textContent || '', /Junta de zona/);
        assert.equal(bloque!.getAttribute('href'), 'https://calendar.google.com/x');
    });

    test('un compromiso de todo el día NO se dibuja en la rejilla de horas', async () => {
        guardarVisitas([]);
        await act(async () => {
            render(
                <Calendario version={1} onAbrirVisita={nada} onCrearEn={nada} onCambio={nada} avisar={nada} />
            );
        });

        assert.ok(!document.body.textContent?.includes('Capacitación anual'),
            'todo el día no tiene una hora que posicionar; se ve en "Mi día", no aquí');
    });
});
