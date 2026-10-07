/**
 * @vitest-environment happy-dom
 *
 * Capturar una actividad (borrador) marca la visita como "por sincronizar" con cada tecla, pero el
 * borrador nunca se sube. Antes cada ciclo "subía" la misma visita y avisaba "1 visita
 * sincronizada" mientras la persona aún escribía, sin haber registrado nada.
 */

import { test, describe, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';

const llamadas = vi.fn();
vi.mock('../src/services/supabase/rpc', () => ({
    rpc: vi.fn(),
    rpcEstricto: vi.fn(async (nombre: string, args: unknown) => { llamadas(nombre, args); return { ok: true }; })
}));

import { sincronizarVisitas } from '../js/sync.js';
import { agregarVisita, actualizarVisita, obtenerVisita } from '../js/storage.js';
import { visita, sector, actividad } from './ayuda/fixtures.js';

beforeEach(() => {
    limpiarAlmacen();
    llamadas.mockClear();
});

describe('sincronizarVisitas y los borradores de actividad', () => {
    test('un cambio que solo toca un borrador no vuelve a subir ni a avisar', async () => {
        const v = agregarVisita(visita({ sectores: [sector({ actividades: [] })] }));

        assert.equal((await sincronizarVisitas()).enviadas, 1, 'la primera vez sí sube');
        assert.equal(llamadas.mock.calls.length, 1);

        // La persona abre "Registrar actividad": nace un borrador y la visita se marca sucia.
        actualizarVisita(v.id, (x: any) => {
            x.sectores[0].actividades.push(actividad({ id: 'a-borrador', guardada: undefined }));
            x.sincronizado = false;
        });
        const r = await sincronizarVisitas();

        assert.equal(r.enviadas, 0, 'no hay nada nuevo que el servidor deba saber');
        assert.equal(llamadas.mock.calls.length, 1, 'ni una llamada de red más');
        assert.equal(obtenerVisita(v.id).sincronizado, true, 'queda al día, sin quedarse en cola');
    });

    test('un cambio real en la visita sí se sube', async () => {
        const v = agregarVisita(visita({ sectores: [sector()] }));
        await sincronizarVisitas();

        actualizarVisita(v.id, (x: any) => { x.hospital = 'Otro hospital'; x.sincronizado = false; });
        const r = await sincronizarVisitas();

        assert.equal(r.enviadas, 1);
        assert.equal(llamadas.mock.calls.length, 2);
    });

    test('al sellar la actividad (ya es un hecho) sí se sube', async () => {
        const v = agregarVisita(visita({ sectores: [sector({ actividades: [] })] }));
        await sincronizarVisitas();

        actualizarVisita(v.id, (x: any) => {
            x.sectores[0].actividades.push(actividad({ id: 'a-sellada', guardada: { momento: '2026-10-06T10:00:00Z', usuario: 'Ana' } }));
            x.sincronizado = false;
        });
        const r = await sincronizarVisitas();

        assert.equal(r.enviadas, 1);
    });
});
