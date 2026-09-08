/**
 * `js/evidencias.js` no tenía NINGÚN archivo de prueba dedicado (verificado: ningún test del
 * repo importa este módulo). Es el corazón de "subir evidencia" — tipo de archivo, tamaño
 * máximo, estado local/pendiente/subida, quitar y volver a subir — así que su cobertura es la
 * de mayor impacto que faltaba en el flujo del Educador.
 *
 * `guardarArchivo`/`leerArchivo`/`borrarArchivo` usan IndexedDB, que el stub de pruebas
 * (`tests/entorno.js`) deliberadamente NO simula (es "un stub pobre" a propósito: lo que
 * necesita un navegador de verdad se prueba abriendo uno). Por eso aquí se reemplazan por un
 * doble en memoria — el resto del módulo (validación de tipo/tamaño, estado de la evidencia
 * en la visita) se prueba tal cual, sin doble.
 */

import { test, describe, beforeEach, vi } from 'vitest';
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

import { adjuntarEvidencia, quitarEvidencia } from '../js/evidencias.js';
import { agregarVisita, leerVisitas } from '../js/storage.js';
import { visita, sector, actividad } from './ayuda/fixtures.js';

/** Un `File` de mentira: `adjuntarEvidencia` solo lee `.type`, `.size` y `.name`. */
function archivo(tipo: string, tamañoBytes: number, nombre = 'archivo'): File {
    return { type: tipo, size: tamañoBytes, name: nombre } as unknown as File;
}

function conActividadPendiente() {
    const a = actividad({ evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' } });
    const s = sector({ actividades: [a] });
    const v = agregarVisita(visita({ sectores: [s] }));
    return { visita: v, actividad: a };
}

beforeEach(() => {
    limpiarAlmacen();
    archivosEnDisco.clear();
});

describe('validación de tipo de archivo', () => {
    test('rechaza un tipo que no es imagen ni PDF', async () => {
        const { actividad: a } = conActividadPendiente();

        await assert.rejects(
            () => adjuntarEvidencia(a.id, archivo('application/zip', 1024, 'evidencia.zip')),
            /Solo se acepta una imagen o un PDF/
        );
    });

    test('rechaza un video', async () => {
        const { actividad: a } = conActividadPendiente();

        await assert.rejects(
            () => adjuntarEvidencia(a.id, archivo('video/mp4', 1024, 'clip.mp4')),
            /Solo se acepta una imagen o un PDF/
        );
    });

    test('un tipo inválido no dejó nada escrito en la actividad', async () => {
        const { visita: v, actividad: a } = conActividadPendiente();

        await adjuntarEvidencia(a.id, archivo('application/zip', 1024)).catch(() => {});

        const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
        assert.equal(actual.evidencia.estado, 'pendiente');
    });
});

describe('validación de tamaño', () => {
    test('rechaza un PDF de más de 10 MB', async () => {
        const { actividad: a } = conActividadPendiente();
        const pesado = 11 * 1024 * 1024;

        await assert.rejects(
            () => adjuntarEvidencia(a.id, archivo('application/pdf', pesado, 'informe.pdf')),
            /El PDF pesa 11\.0 MB y el límite es 10/
        );
    });

    test('acepta un PDF justo en el límite de 10 MB', async () => {
        const { actividad: a } = conActividadPendiente();
        const limite = 10 * 1024 * 1024;

        await assert.doesNotReject(() => adjuntarEvidencia(a.id, archivo('application/pdf', limite, 'informe.pdf')));
    });

    test('un PDF grande no llega a guardarse en el almacén local (no queda huérfano)', async () => {
        const { actividad: a } = conActividadPendiente();

        await adjuntarEvidencia(a.id, archivo('application/pdf', 20 * 1024 * 1024, 'informe.pdf')).catch(() => {});

        assert.equal(archivosEnDisco.has(a.id), false,
            'un archivo rechazado por tamaño no debe quedar guardado localmente');
    });
});

describe('evidencia local pendiente de sincronizar', () => {
    test('un PDF válido queda en estado "local", no "subida"', async () => {
        const { visita: v, actividad: a } = conActividadPendiente();

        await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'informe.pdf'));

        const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
        assert.equal(actual.evidencia.estado, 'local');
        assert.equal(actual.evidencia.nombre, 'informe.pdf');
        assert.equal(actual.evidencia.mime, 'application/pdf');
        assert.equal(actual.evidencia.url, '', 'sin URL: todavía no existe en el servidor');
    });

    test('adjuntar una evidencia marca la visita para re-sincronizar', async () => {
        const { visita: v, actividad: a } = conActividadPendiente();
        agregarVisita; // no-op de tipado
        const antes = leerVisitas().find((x: any) => x.id === v.id);
        antes.sincronizado = true;
        const { guardarVisitas } = await import('../js/storage.js');
        guardarVisitas(leerVisitas());

        await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'informe.pdf'));

        assert.equal(leerVisitas().find((x: any) => x.id === v.id).sincronizado, false);
    });

    test('el archivo queda accesible en el almacén local por el id de la actividad', async () => {
        const { actividad: a } = conActividadPendiente();

        await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'informe.pdf'));

        assert.ok(archivosEnDisco.has(a.id));
    });
});

describe('quitar y volver a subir', () => {
    test('quitarEvidencia regresa la actividad a "pendiente" y borra el archivo local', async () => {
        const { visita: v, actividad: a } = conActividadPendiente();
        await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'informe.pdf'));
        assert.ok(archivosEnDisco.has(a.id));

        await quitarEvidencia(a.id);

        const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
        assert.equal(actual.evidencia.estado, 'pendiente');
        assert.equal(actual.evidencia.nombre, '');
        assert.equal(archivosEnDisco.has(a.id), false);
    });

    test('después de quitarla, se puede adjuntar una nueva', async () => {
        const { visita: v, actividad: a } = conActividadPendiente();
        await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'primera.pdf'));
        await quitarEvidencia(a.id);

        await adjuntarEvidencia(a.id, archivo('application/pdf', 2048, 'segunda.pdf'));

        const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
        assert.equal(actual.evidencia.nombre, 'segunda.pdf');
        assert.equal(actual.evidencia.estado, 'local');
    });

    test('quitar una evidencia que ya estaba "subida" también la deja pendiente localmente', async () => {
        const a = actividad({ evidencia: { estado: 'subida', nombre: 'vieja.pdf', mime: 'application/pdf', url: 'https://drive.test/1' } });
        const s = sector({ actividades: [a] });
        const v = agregarVisita(visita({ sectores: [s] }));

        await quitarEvidencia(a.id);

        const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
        assert.equal(actual.evidencia.estado, 'pendiente');
    });
});

describe('sin conexión (offline)', () => {
    test('adjuntar evidencia no depende de navigator.onLine: se guarda local de todas formas', async () => {
        const original = Object.getOwnPropertyDescriptor(globalThis.navigator, 'onLine');
        Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
        try {
            const { visita: v, actividad: a } = conActividadPendiente();

            await adjuntarEvidencia(a.id, archivo('application/pdf', 1024, 'informe.pdf'));

            const actual = leerVisitas().find((x: any) => x.id === v.id).sectores[0].actividades[0];
            assert.equal(actual.evidencia.estado, 'local');
        } finally {
            if (original) Object.defineProperty(globalThis.navigator, 'onLine', original);
        }
    });
});
