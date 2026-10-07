/**
 * @vitest-environment happy-dom
 *
 * La subida automática de evidencias: se ve cómo va, un fallo deja rastro y se puede reintentar,
 * y dos ciclos a la vez no suben el mismo archivo dos veces.
 *
 * IndexedDB no existe en el stub de pruebas: el almacén de archivos se reemplaza por un doble en
 * memoria (mismo criterio que `auditoria-evidencias.test.ts`).
 */

import { test, describe, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';

const archivos = new Map<string, Blob>();

vi.mock('../js/storage.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    return {
        ...real,
        leerArchivo: vi.fn(async (id: string) => archivos.get(id)),
        borrarArchivo: vi.fn(async (id: string) => { archivos.delete(id); })
    };
});

const subirAStorage = vi.fn();
vi.mock('../src/services/supabase/evidencias', () => ({
    subirEvidenciaAStorage: (...a: unknown[]) => subirAStorage(...a),
    urlDeLecturaEvidencia: vi.fn()
}));
vi.mock('../src/services/supabase/rpc', () => ({
    rpc: vi.fn(), rpcEstricto: vi.fn(async () => ({ ok: true }))
}));

import { subirEvidenciasPendientes, progresoSubidaEvidencias, evidenciasSinArchivoLocal } from '../js/sync.js';
import { agregarVisita, leerVisitas } from '../js/storage.js';
import { fijarFechaDocumento } from '../js/evidencias.js';
import { visita, sector, actividad } from './ayuda/fixtures.js';
import type { Evidencia, Visita } from '../src/core/tipos';

function conEvidenciaLocal(id: string, conArchivo = true) {
    const a = actividad({ id, evidencia: { estado: 'local', nombre: `${id}.jpg`, mime: 'image/jpeg', url: '' } });
    agregarVisita(visita({ sectores: [sector({ actividades: [a] })] }));
    if (conArchivo) archivos.set(id, new Blob(['x'], { type: 'image/jpeg' }));
}

const evidenciaDe = (id: string): Evidencia | undefined => (leerVisitas() as Visita[])
    .flatMap((v) => v.sectores || []).flatMap((s) => s.actividades || []).find((a) => a.id === id)?.evidencia;

beforeEach(() => {
    limpiarAlmacen();
    archivos.clear();
    subirAStorage.mockReset();
});

describe('subida automática de evidencias', () => {
    test('sube, marca como subida y anuncia el progreso', async () => {
        subirAStorage.mockResolvedValue({ ruta: 'a/b.jpg' });
        conEvidenciaLocal('ev-1');
        const avances: Array<{ hechas: number; total: number }> = [];
        const oyente = (e: Event) => avances.push((e as CustomEvent).detail);
        window.addEventListener('pdt:evidencia-progreso', oyente);

        const r = await subirEvidenciasPendientes();
        window.removeEventListener('pdt:evidencia-progreso', oyente);

        assert.deepEqual(r, { subidas: 1, fallidas: 0 });
        assert.equal(evidenciaDe('ev-1')?.estado, 'subida');
        assert.ok(avances.some(a => a.total === 1), 'anuncia que hay 1 por subir');
        assert.equal(progresoSubidaEvidencias().enCurso, false, 'al terminar ya no está en curso');
    });

    test('un fallo no se traga: queda el motivo y los intentos, y sigue en cola', async () => {
        subirAStorage.mockRejectedValue(new Error('El servidor no respondió a tiempo.'));
        conEvidenciaLocal('ev-2');

        const r = await subirEvidenciasPendientes();

        assert.deepEqual(r, { subidas: 0, fallidas: 1 });
        const ev = evidenciaDe('ev-2');
        assert.equal(ev?.estado, 'local', 'sigue en cola para reintentar');
        assert.match(ev?.ultimo_error || '', /no respondió/);
        assert.equal(ev?.intentos, 1);

        await subirEvidenciasPendientes();
        assert.equal(evidenciaDe('ev-2')?.intentos, 2, 'cada reintento suma');
    });

    test('al subir bien después de fallar, se limpia el error', async () => {
        subirAStorage.mockRejectedValueOnce(new Error('sin señal')).mockResolvedValueOnce({ ruta: 'a/c.jpg' });
        conEvidenciaLocal('ev-3');

        await subirEvidenciasPendientes();
        assert.equal(evidenciaDe('ev-3')?.intentos, 1);
        await subirEvidenciasPendientes();

        const ev = evidenciaDe('ev-3');
        assert.equal(ev?.estado, 'subida');
        assert.equal(ev?.ultimo_error, undefined);
    });

    test('sin archivo en este dispositivo no es un error: se anota y no se reintenta con ruido', async () => {
        conEvidenciaLocal('ev-4', false);

        const r = await subirEvidenciasPendientes();

        assert.deepEqual(r, { subidas: 0, fallidas: 0 });
        assert.ok(evidenciasSinArchivoLocal().has('ev-4'));
        assert.equal(evidenciaDe('ev-4')?.ultimo_error, undefined);
    });

    test('dos ciclos a la vez suben el archivo UNA vez', async () => {
        let liberar: () => void = () => {};
        subirAStorage.mockImplementation(() => new Promise(r => { liberar = () => r({ ruta: 'a/d.jpg' }); }));
        conEvidenciaLocal('ev-5');

        const primero = subirEvidenciasPendientes();
        const segundo = subirEvidenciasPendientes();
        await vi.waitFor(() => assert.equal(subirAStorage.mock.calls.length, 1));
        liberar();
        await Promise.all([primero, segundo]);

        assert.equal(subirAStorage.mock.calls.length, 1);
    });
});

describe('la fecha del documento retiene la subida', () => {
    function conFechaObligatoria(id: string) {
        localStorage.setItem('datosPWA', JSON.stringify({ tipos_actividad: [{
            nombre: 'Capacitación', campos: { evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' }
        }] }));
        const a = actividad({ id, tipo: 'Capacitación', evidencia: { estado: 'local', nombre: `${id}.jpg`, mime: 'image/jpeg', url: '' } });
        agregarVisita(visita({ sectores: [sector({ actividades: [a] })] }));
        archivos.set(id, new Blob(['x'], { type: 'image/jpeg' }));
    }

    test('sin la fecha NO se sube, no cuenta como fallo y no deja un error en la actividad', async () => {
        conFechaObligatoria('ev-f1');
        subirAStorage.mockResolvedValue({ ruta: 'a/f.jpg' });

        const r = await subirEvidenciasPendientes();

        assert.deepEqual(r, { subidas: 0, fallidas: 0 });
        assert.equal(subirAStorage.mock.calls.length, 0);
        assert.equal(evidenciaDe('ev-f1')?.estado, 'local');
        assert.equal(evidenciaDe('ev-f1')?.ultimo_error, undefined);
    });

    test('en cuanto se captura la fecha, sube sola', async () => {
        conFechaObligatoria('ev-f2');
        subirAStorage.mockResolvedValue({ ruta: 'a/g.jpg' });
        await subirEvidenciasPendientes();
        assert.equal(subirAStorage.mock.calls.length, 0);

        assert.equal(fijarFechaDocumento('ev-f2', '2026-10-01'), true);
        const r = await subirEvidenciasPendientes();

        assert.deepEqual(r, { subidas: 1, fallidas: 0 });
        assert.equal(evidenciaDe('ev-f2')?.estado, 'subida');
    });
});
