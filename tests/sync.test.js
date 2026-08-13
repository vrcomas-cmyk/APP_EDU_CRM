/**
 * `sincronizarTodo` y el acuse de `sincronizarVisitas`.
 *
 * Dos garantías que antes no existían: una cola caída no debe congelar a las demás (cada
 * etapa corre en su propio try/catch), y una edición que llega MIENTRAS el POST está en vuelo
 * no debe marcarse como sincronizada solo por compartir id con lo que sí se mandó.
 */

import { test, describe, vi, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

const postear = vi.fn();

vi.mock('../src/services/google/appsScript', () => ({
    postear: (...args) => postear(...args),
    leerCatalogos: vi.fn(async () => ({}))
}));

vi.mock('../js/googleCalendar.js', () => ({
    tieneAccesoCalendar: vi.fn(() => false),
    intentarReconexionCalendar: vi.fn(async () => false),
    sincronizarEventoVisita: vi.fn(async () => null),
    borrarEventoVisita: vi.fn(async () => {})
}));

import { agregarVisita, leerVisitas, guardarVisitas } from '../js/storage.js';
import { registrar, TIPOS } from '../js/eventos.js';
import { sincronizarTodo, sincronizarVisitas, sincronizarCalendar } from '../js/sync.js';
import { visita } from './ayuda/fixtures.js';
import * as googleCalendar from '../js/googleCalendar.js';

beforeEach(() => {
    limpiarAlmacen();
    postear.mockReset();
    googleCalendar.tieneAccesoCalendar.mockReset().mockReturnValue(false);
    googleCalendar.intentarReconexionCalendar.mockReset().mockResolvedValue(false);
    googleCalendar.sincronizarEventoVisita.mockReset().mockResolvedValue(null);
});

describe('sincronizarTodo — una etapa caída no bloquea a las demás', () => {
    test('si guardarVisitas falla, los eventos pendientes igual se intentan y suben', async () => {
        const v = agregarVisita(visita({ sincronizado: false }));
        registrar(TIPOS.VISITA_PROGRAMADA, v);

        postear.mockImplementation(async ({ action }) => {
            if (action === 'guardarVisitas') throw new Error('Apps Script no respondió');
            if (action === 'guardarEventos') return { status: 'ok', espejo: true };
            return { status: 'ok' };
        });

        const r = await sincronizarTodo();

        assert.ok(r.errores?.visitas, 'la etapa de visitas debe quedar registrada como fallida');
        assert.equal(r.eventos.enviados, 1, 'la etapa de eventos debió correr de todos modos');

        const llamadas = postear.mock.calls.map(([body]) => body.action);
        assert.ok(llamadas.includes('guardarEventos'),
            'una cola caída no debe impedir que se intenten las demás');
    });

    test('sin ningún fallo, no hay campo "errores" en el resultado', async () => {
        postear.mockResolvedValue({ status: 'ok', espejo: true });
        const r = await sincronizarTodo();
        assert.equal(r.errores, undefined);
    });
});

describe('sincronizarCalendar — reconecta sola en vez de rendirse', () => {
    test('sin token, intenta reconectar en silencio antes de reconciliar', async () => {
        googleCalendar.tieneAccesoCalendar.mockReturnValue(false);
        googleCalendar.intentarReconexionCalendar.mockResolvedValue(false);

        const r = await sincronizarCalendar();

        assert.equal(googleCalendar.intentarReconexionCalendar.mock.calls.length, 1,
            'debe intentar la reconexión silenciosa antes de rendirse');
        assert.equal(r.revisadas, 0);
    });

    test('si la reconexión silenciosa funciona, reconcilia en el mismo ciclo', async () => {
        const v = agregarVisita(visita({ dia: '2026-08-20', hora_inicio: '09:00', hora_fin: '10:00' }));

        // El token "aparece" justo cuando se intenta reconectar, como si de verdad se hubiera
        // renovado — antes de eso `tieneAccesoCalendar()` decía que no había acceso.
        let reconectado = false;
        googleCalendar.tieneAccesoCalendar.mockImplementation(() => reconectado);
        googleCalendar.intentarReconexionCalendar.mockImplementation(async () => {
            reconectado = true;
            return true;
        });
        googleCalendar.sincronizarEventoVisita.mockResolvedValue('evt-nuevo');

        const r = await sincronizarCalendar();

        assert.equal(r.creados, 1, 'no debía quedarse esperando al próximo ciclo de 5 min');
        assert.equal(leerVisitas().find(x => x.id === v.id).calendar_event_id, 'evt-nuevo');
    });
});

describe('sincronizarVisitas — acuse por huella, no por id', () => {
    test('una edición concurrente al POST no se marca sincronizada', async () => {
        const v = agregarVisita(visita({ sincronizado: false, notas: 'original' }));

        // El POST "tarda": mientras está en vuelo, alguien edita la misma visita otra vez.
        postear.mockImplementation(async () => {
            const visitas = leerVisitas();
            const enVivo = visitas.find(x => x.id === v.id);
            enVivo.notas = 'editada durante el envío';
            enVivo.sincronizado = false;
            guardarVisitas(visitas);
            return { status: 'ok', espejo: true };
        });

        await sincronizarVisitas();

        const final = leerVisitas().find(x => x.id === v.id);
        assert.equal(final.sincronizado, false,
            'la edición que llegó durante el POST no viajó en ese envío; no debe darse por subida');
        assert.equal(final.notas, 'editada durante el envío', 'la edición no debe perderse');
    });

    test('sin edición concurrente, sí se marca sincronizada', async () => {
        agregarVisita(visita({ sincronizado: false }));
        postear.mockResolvedValue({ status: 'ok', espejo: true });

        await sincronizarVisitas();

        assert.ok(leerVisitas().every(v => v.sincronizado === true));
    });
});
