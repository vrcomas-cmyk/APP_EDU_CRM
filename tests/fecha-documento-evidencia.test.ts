/**
 * @vitest-environment happy-dom
 *
 * La "Fecha del documento" se pregunta AL SUBIR la evidencia cuando esta es obligatoria, y no al
 * capturar la actividad: es el momento en que la persona tiene el documento a la vista.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';

const archivosEnDisco = new Map<string, Blob>();
vi.mock('../js/storage.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    return {
        ...real,
        guardarArchivo: vi.fn(async (id: string, blob: Blob) => { archivosEnDisco.set(id, blob); }),
        leerArchivo: vi.fn(async (id: string) => archivosEnDisco.get(id)),
        borrarArchivo: vi.fn(async (id: string) => { archivosEnDisco.delete(id); })
    };
});

import { adjuntarEvidencia, quitarEvidencia, controlEvidencia, fijarFechaDocumento } from '../js/evidencias.js';
import { fechaDocumentoEnEvidencia, fechaDocumentoFaltante } from '../js/catalogos.js';
import { datosFaltantes } from '../js/faltantes.js';
import { faltantesDe } from '../src/modules/actividades/validators/requisitos';
import { agregarVisita, leerVisitas } from '../js/storage.js';
import { visita, sector, actividad } from './ayuda/fixtures.js';

const ponerCatalogo = (campos: Record<string, string>) => localStorage.setItem('datosPWA', JSON.stringify({
    tipos_actividad: [{ nombre: 'Capacitación', campos }]
}));

const pdf = (nombre = 'lista.pdf') => ({ type: 'application/pdf', size: 1024, name: nombre }) as unknown as File;

function conActividad(extra: Record<string, unknown> = {}) {
    const a = actividad({
        tipo: 'Capacitación', area_visitada: 'Área Usuaria', contacto: { nombre: 'Dr. X' },
        evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '', tipo: 'Fotografía' }, ...extra
    });
    agregarVisita(visita({ sectores: [sector({ actividades: [a] })] }));
    return a;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const actividadDe = (id: string): any => (leerVisitas() as any[])
    .flatMap(v => v.sectores).flatMap((s: any) => s.actividades).find((a: any) => a.id === id);

beforeEach(() => { limpiarAlmacen(); archivosEnDisco.clear(); });

describe('¿dónde se pregunta la fecha del documento?', () => {
    test('con la evidencia obligatoria, al subirla', () => {
        ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' });
        assert.equal(fechaDocumentoEnEvidencia('Capacitación'), true);
    });

    test('con la evidencia opcional u oculta se queda en el formulario', () => {
        ponerCatalogo({ evidencia: 'opcional', fecha_documento: 'obligatorio' });
        assert.equal(fechaDocumentoEnEvidencia('Capacitación'), false);
        ponerCatalogo({ evidencia: 'oculto', fecha_documento: 'obligatorio' });
        assert.equal(fechaDocumentoEnEvidencia('Capacitación'), false);
    });

    test('si la fecha está oculta no hay nada que preguntar', () => {
        ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'oculto' });
        assert.equal(fechaDocumentoEnEvidencia('Capacitación'), false);
    });

    test('guardar la actividad ya no exige la fecha cuando se pide al subir', () => {
        ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' });
        const a = conActividad();
        assert.deepEqual(faltantesDe(a as never), []);
    });

    test('con la evidencia opcional, la fecha obligatoria SÍ bloquea el guardado', () => {
        ponerCatalogo({ evidencia: 'opcional', fecha_documento: 'obligatorio' });
        const a = conActividad();
        assert.deepEqual(faltantesDe(a as never).map(f => f.campoId), ['fecha_documento']);
    });
});

describe('adjuntar con la fecha del documento', () => {
    beforeEach(() => ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' }));

    test('guarda la fecha y NO pierde el tipo de evidencia elegido antes', async () => {
        const a = conActividad();
        await adjuntarEvidencia(a.id, pdf(), { fecha_documento: '2026-09-30' });

        const guardada = actividadDe(a.id);
        assert.equal(guardada.fecha_documento, '2026-09-30');
        assert.equal(guardada.evidencia.estado, 'local');
        assert.equal(guardada.evidencia.tipo, 'Fotografía', 'antes se reemplazaba el objeto y se perdía');
        assert.ok(guardada.evidencia.adjuntada, 'queda cuándo se adjuntó (fecha de registro)');
    });

    test('quitar el archivo quita también la fecha que se había preguntado con él', async () => {
        const a = conActividad();
        await adjuntarEvidencia(a.id, pdf(), { fecha_documento: '2026-09-30' });
        await quitarEvidencia(a.id);

        const guardada = actividadDe(a.id);
        assert.equal(guardada.fecha_documento, undefined);
        assert.equal(guardada.evidencia.estado, 'pendiente');
        assert.equal(guardada.evidencia.tipo, 'Fotografía');
    });

    test('quitar el archivo NO borra una fecha capturada en el formulario (evidencia opcional)', async () => {
        ponerCatalogo({ evidencia: 'opcional', fecha_documento: 'obligatorio' });
        const a = conActividad({ fecha_documento: '2026-09-01' });
        await adjuntarEvidencia(a.id, pdf());
        await quitarEvidencia(a.id);

        assert.equal(actividadDe(a.id).fecha_documento, '2026-09-01');
    });

    test('fijarFechaDocumento corrige una fecha que faltó', async () => {
        const a = conActividad();
        await adjuntarEvidencia(a.id, pdf());
        assert.equal(fijarFechaDocumento(a.id, '2026-10-01'), true);
        assert.equal(actividadDe(a.id).fecha_documento, '2026-10-01');
    });
});

describe('la ventana de la fecha del documento', () => {
    beforeEach(() => ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' }));
    afterEach(() => { document.body.replaceChildren(); });

    function elegirArchivo(control: HTMLElement, archivo: File) {
        const input = control.querySelector('input[type="file"]') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [archivo], configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const dialogo = () => document.querySelector('.dialogo-raiz') as HTMLElement | null;
    const boton = (texto: string) => [...(dialogo()?.querySelectorAll('button') || [])]
        .find(b => b.textContent === texto) as HTMLButtonElement;

    function montar(extra: Record<string, unknown> = {}) {
        const a = conActividad(extra);
        const alToast = vi.fn();
        const alCambiar = vi.fn();
        const control = controlEvidencia(a, { alCambiar, alToast } as never) as HTMLElement;
        document.body.appendChild(control);
        return { a, control, alToast, alCambiar };
    }

    test('al elegir el archivo se ABRE una ventana (no un campo más) y no adjunta hasta tener la fecha', async () => {
        const { a, control } = montar();
        elegirArchivo(control, pdf());

        assert.ok(dialogo(), 'aparece la ventana emergente');
        assert.equal(control.querySelector('.evid-paso-fecha'), null, 'ya no es un paso en línea');
        assert.match(dialogo()!.textContent || '', /¿De qué fecha es el documento\? \*/);
        assert.equal(boton('Adjuntar').disabled, true, 'obligatoria: sin fecha no se puede adjuntar');
        assert.equal(actividadDe(a.id).evidencia.estado, 'pendiente');

        const real = dialogo()!.querySelector('input[type="date"]') as HTMLInputElement;
        real.value = '2026-09-30';
        real.dispatchEvent(new Event('input', { bubbles: true }));
        assert.match(dialogo()!.textContent || '', /30\/09\/2026/, 'se lee dd/mm/aaaa');

        boton('Adjuntar').click();
        assert.equal(dialogo(), null, 'la ventana se cierra');
        await vi.waitFor(() => assert.equal(actividadDe(a.id).evidencia.estado, 'local'));
        assert.equal(actividadDe(a.id).fecha_documento, '2026-09-30');
    });

    test('dice qué pasa si la deja para después (la evidencia no se sube hasta tener la fecha)', () => {
        const { control } = montar();
        elegirArchivo(control, pdf());
        assert.match(dialogo()!.textContent || '', /NO se sube hasta que captures la fecha/);
        assert.match(dialogo()!.textContent || '', /Avisos/);
    });

    test('"Poner la fecha después": se adjunta SIN fecha, queda esperándola y se avisa', async () => {
        const { a, control, alToast } = montar();
        elegirArchivo(control, pdf());
        boton('Poner la fecha después').click();

        await vi.waitFor(() => assert.equal(actividadDe(a.id).evidencia.estado, 'local'));
        assert.equal(actividadDe(a.id).fecha_documento, undefined);
        assert.equal(fechaDocumentoFaltante(actividadDe(a.id)), true, 'espera la fecha');
        assert.match(String(alToast.mock.calls[0]?.[0]), /Quedó pendiente la fecha del documento/);
        assert.match(String(alToast.mock.calls[0]?.[0]), /Avisos/);
        assert.equal(datosFaltantes().length, 1, 'aparece en lo que le falta a la persona');
        assert.match(datosFaltantes()[0]!.detalle, /no se sube hasta que captures la fecha/);
    });

    test('mientras falta, la evidencia se ve RESALTADA, con su botón, y no se puede subir a la fuerza', async () => {
        const { a } = montar();
        await adjuntarEvidencia(a.id, pdf());
        const control = controlEvidencia(actividadDe(a.id), {} as never) as HTMLElement;

        const alerta = control.querySelector('.evid-fecha-falta.es-alerta') as HTMLElement;
        assert.ok(alerta, 'bloque resaltado');
        assert.match(alerta.textContent || '', /Falta la fecha del documento/);
        assert.match(alerta.textContent || '', /no se subirá/);
        const subir = [...control.querySelectorAll('button')].find(b => /Falta la fecha$/.test(b.textContent || '')) as HTMLButtonElement;
        assert.equal(subir.disabled, true);
    });

    test('"Poner la fecha" abre la ventana y al guardarla la evidencia ya puede subirse', async () => {
        const { a } = montar();
        await adjuntarEvidencia(a.id, pdf());
        const alToast = vi.fn();
        const control = controlEvidencia(actividadDe(a.id), { alToast, alCambiar: vi.fn() } as never) as HTMLElement;
        document.body.appendChild(control);

        (control.querySelector('.evid-fecha-falta button') as HTMLButtonElement).click();
        assert.ok(dialogo());
        assert.equal(boton('Poner la fecha después'), undefined, 'aquí no hay "después": ya es la segunda vez');

        const real = dialogo()!.querySelector('input[type="date"]') as HTMLInputElement;
        real.value = '2026-10-01';
        real.dispatchEvent(new Event('input', { bubbles: true }));
        boton('Guardar fecha').click();

        assert.equal(actividadDe(a.id).fecha_documento, '2026-10-01');
        assert.equal(fechaDocumentoFaltante(actividadDe(a.id)), false);
        assert.equal(datosFaltantes().length, 0);
        assert.match(String(alToast.mock.calls[0]?.[0]), /ya puede subirse/);
    });

    test('cancelar la ventana no adjunta nada', () => {
        const { a, control } = montar();
        elegirArchivo(control, pdf());
        boton('Cancelar').click();

        assert.equal(dialogo(), null);
        assert.equal(actividadDe(a.id).evidencia.estado, 'pendiente');
    });

    test('Escape cierra la ventana sin adjuntar', () => {
        const { a, control } = montar();
        elegirArchivo(control, pdf());
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        assert.equal(dialogo(), null);
        assert.equal(actividadDe(a.id).evidencia.estado, 'pendiente');
    });

    test('con la fecha OPCIONAL se puede dejar para después sin aviso ni retención', async () => {
        ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'opcional' });
        const { a, control, alToast } = montar();
        elegirArchivo(control, pdf());
        assert.doesNotMatch(dialogo()!.textContent || '', /NO se sube/);
        boton('Poner la fecha después').click();

        await vi.waitFor(() => assert.equal(actividadDe(a.id).evidencia.estado, 'local'));
        assert.equal(fechaDocumentoFaltante(actividadDe(a.id)), false, 'opcional: no retiene');
        assert.equal(alToast.mock.calls.length, 0);
    });

    test('con la evidencia opcional adjunta directo, sin ventana', async () => {
        ponerCatalogo({ evidencia: 'opcional', fecha_documento: 'opcional' });
        const { a, control } = montar();
        elegirArchivo(control, pdf());

        assert.equal(dialogo(), null);
        await vi.waitFor(() => assert.equal(actividadDe(a.id).evidencia.estado, 'local'));
    });
});

describe('fechaDocumentoFaltante', () => {
    test('solo con archivo adjunto, fecha obligatoria y evidencia obligatoria', () => {
        ponerCatalogo({ evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' });
        const base = { tipo: 'Capacitación' };
        assert.equal(fechaDocumentoFaltante({ ...base, evidencia: { estado: 'pendiente' } } as never), false, 'aún sin archivo');
        assert.equal(fechaDocumentoFaltante({ ...base, evidencia: { estado: 'local' } } as never), true);
        assert.equal(fechaDocumentoFaltante({ ...base, evidencia: { estado: 'subida' } } as never), true);
        assert.equal(fechaDocumentoFaltante({ ...base, evidencia: { estado: 'local' }, fecha_documento: '2026-10-01' } as never), false);
    });
});
