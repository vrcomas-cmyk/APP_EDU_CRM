/**
 * @vitest-environment happy-dom
 *
 * Flujos de revisión: la pantalla de administración.
 *
 * Igual que Accesos, esto no tiene caché local: cada prueba dobla `leerFlujos`/`guardarFlujos`
 * de `js/sync.js` para no depender de que haya un Apps Script contestando.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';

const leidas: unknown[] = [];
const guardadas: unknown[] = [];
let respuesta: { status: string; message?: string } = { status: 'ok' };

vi.mock('../js/sync.js', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    leerFlujos: async () => {
        const datos = {
            flujos: [
                {
                    clave: 'evidencia', nombre: 'Evidencias', descripcion: null,
                    ambito: 'actividad', permiso: 'evidencias.aprobar', activo: true, orden: 1,
                    resultados: null, revisiones: 3
                },
                {
                    clave: 'calidad_visita', nombre: 'Calidad de la visita', descripcion: null,
                    ambito: 'visita', permiso: 'visitas.calificar', activo: true, orden: 2,
                    resultados: [
                        { valor: 'efectiva', etiqueta: 'Efectiva', accion: '✓ Efectiva',
                          tono: 'completa', estilo: 'principal', acepta: true, cierra: true }
                    ],
                    revisiones: 0
                }
            ]
        };
        leidas.push(datos);
        return { status: 'ok', ...datos };
    },
    guardarFlujos: async (cambios: unknown) => { guardadas.push(cambios); return respuesta; }
}));

import { Administracion } from '@modules/administracion/components/Administracion';
import { guardarCatalogo } from '../js/storage.js';
import { olvidarPerfil } from '../js/permisos.js';

beforeEach(() => {
    localStorage.clear();
    leidas.length = 0;
    guardadas.length = 0;
    respuesta = { status: 'ok' };
    olvidarPerfil();
    guardarCatalogo({
        tipos_actividad: [{ nombre: 'Capacitación' }],
        origenes: ['BI'], areas: ['Área'], unidades: ['Pieza'], tipos_evidencia: ['Foto'],
        sectores: [], sectores_ocultos: [], educadores: [], admins: []
    });
});

afterEach(cleanup);

const pintar = (props = {}) => render(<Administracion confirmar={() => true} {...props} />);
const irAFlujos = () => fireEvent.click(screen.getByText('Flujos'));
const nombreDeFlujo = (nombre: string) => screen.getByText(nombre, { selector: '.tipo-nombre' });

describe('el área Flujos', () => {
    test('no pide la red hasta que se entra', () => {
        pintar();
        assert.equal(leidas.length, 0);
    });

    test('entrar a Flujos carga los flujos existentes', async () => {
        pintar();
        await act(async () => { irAFlujos(); });

        await waitFor(() => assert.equal(leidas.length, 1));
        assert.ok(nombreDeFlujo('Evidencias'));
        assert.ok(nombreDeFlujo('Calidad de la visita'));
    });
});

describe('editar un flujo', () => {
    test('un flujo con revisiones no deja cambiar su clave ni borrarlo', async () => {
        pintar();
        await act(async () => { irAFlujos(); });
        await waitFor(() => assert.ok(nombreDeFlujo('Evidencias')));

        await act(async () => { fireEvent.click(nombreDeFlujo('Evidencias')); });
        const ficha = within(nombreDeFlujo('Evidencias').closest('details') as HTMLElement);

        const clave = ficha.getByDisplayValue('evidencia') as HTMLInputElement;
        assert.equal(clave.disabled, true);

        const borrar = ficha.getByLabelText('Borrar Evidencias') as HTMLButtonElement;
        assert.equal(borrar.disabled, true);
    });

    test('activar veredictos propios en un flujo sin ellos arranca con uno en blanco', async () => {
        pintar();
        await act(async () => { irAFlujos(); });
        await waitFor(() => assert.ok(nombreDeFlujo('Evidencias')));

        await act(async () => { fireEvent.click(nombreDeFlujo('Evidencias')); });
        const ficha = within(nombreDeFlujo('Evidencias').closest('details') as HTMLElement);

        await act(async () => { fireEvent.click(ficha.getByText('Los 3 de siempre')); });

        assert.ok(ficha.getByPlaceholderText('valor'), 'debe aparecer una fila de veredicto editable');
    });

    test('guardar envía la forma esperada, incluidos los veredictos ya configurados', async () => {
        pintar();
        await act(async () => { irAFlujos(); });
        await waitFor(() => assert.ok(nombreDeFlujo('Calidad de la visita')));

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(guardadas.length, 1);
        const enviado = guardadas[0] as { flujos: Array<{ clave: string; resultados: unknown }>; eliminar: string[] };
        const calidad = enviado.flujos.find(f => f.clave === 'calidad_visita');
        assert.ok(Array.isArray(calidad?.resultados));
        assert.deepEqual(enviado.eliminar, []);
    });

    test('un error del servidor al guardar se muestra, no se traga', async () => {
        respuesta = { status: 'error', message: 'El permiso "x.y" no existe en el catálogo de capacidades.' };
        const avisos: string[] = [];
        pintar({ avisar: (t: string) => avisos.push(t) });
        await act(async () => { irAFlujos(); });
        await waitFor(() => assert.ok(nombreDeFlujo('Evidencias')));

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.ok(avisos.some(a => a.includes('catálogo de capacidades')));
    });
});
