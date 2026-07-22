/**
 * @vitest-environment happy-dom
 *
 * Estrategias: cliente × sector × grupo de artículo.
 *
 * Es una referencia PLANA y compartida —sin dueño, sin sello— así que lo que importa aquí es
 * que cualquiera pueda crearla y corregirla, que sobreviva un refresco (localStorage) y que no
 * dependa de que el Apps Script real conteste. El campo Cliente usa el mismo `Combo` que ya usa
 * la captura de visitas, así que las dos instancias (filtro y formulario) comparten
 * placeholder — las pruebas las distinguen por dónde viven en el DOM, no por el texto.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';

// Única frontera de red del módulo: sin doblarla, la prueba dependería de un Apps Script real.
vi.mock('../js/sync.js', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    descargarEstrategiasEquipo: async () => ({ estrategias: [] }),
    sincronizarEstrategias: async () => ({ enviadas: 0 })
}));

import { Estrategias } from '@modules/estrategias/components/Estrategias';
import { guardarCatalogo, leerEstrategias } from '../js/storage.js';

function montar() {
    return render(<Estrategias avisar={() => {}} />);
}

/** El combo de Cliente DENTRO del modal (el del filtro vive fuera y siempre está montado). */
function inputClienteModal(): HTMLInputElement {
    const el = document.querySelector('.modal-body input[placeholder="Busca N° o razón social…"]');
    if (!el) throw new Error('no se encontró el combo de Cliente del formulario');
    return el as HTMLInputElement;
}

function inputClienteFiltro(): HTMLInputElement {
    const el = document.querySelector('.filtros > .campo.combo input[placeholder="Busca N° o razón social…"]');
    if (!el) throw new Error('no se encontró el combo de Cliente del filtro');
    return el as HTMLInputElement;
}

beforeEach(() => {
    localStorage.clear();
    guardarCatalogo({
        clientes: ['Cliente Uno'], sectores: ['GASAS', 'SUTURAS'],
        grupos_articulo: ['Suturas', 'Gasas']
    });
});

afterEach(cleanup);

describe('Estrategias', () => {
    test('sin ninguna, invita a crear la primera', async () => {
        await act(async () => montar());
        assert.ok(screen.getByText('Nada que mostrar todavía'));
    });

    test('el filtro de cliente es un combo que se puede escribir libremente', async () => {
        await act(async () => montar());

        const filtro = inputClienteFiltro();
        fireEvent.change(filtro, { target: { value: 'Cliente Uno' } });

        assert.equal(filtro.value, 'Cliente Uno');
    });

    test('crear una estrategia la deja visible en la tabla y en localStorage', async () => {
        await act(async () => montar());

        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        fireEvent.change(inputClienteModal(), { target: { value: 'Hospital Los Pilares' } });

        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        assert.ok(screen.getByText('Hospital Los Pilares'));
        assert.equal(leerEstrategias().length, 1);
        assert.equal((leerEstrategias()[0] as { cliente: string }).cliente, 'Hospital Los Pilares');
    });

    test('el grupo de artículo sale del catálogo (Materiales), no de una lista fija', async () => {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));

        // El filtro de fuera tiene el mismo select: se acota al modal para no toparse con él.
        const modal = within(document.querySelector('.modal-body') as HTMLElement);

        assert.ok(modal.getByText('Suturas'));
        assert.ok(modal.getByText('Gasas'));
        assert.equal(modal.queryByText('Cardinal'), null,
            'no debe verse un grupo del default si el catálogo real no lo trae');
    });

    test('sin cliente, Guardar queda deshabilitado', async () => {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));

        const guardar = screen.getByText('Guardar') as HTMLButtonElement;
        assert.equal(guardar.disabled, true);
    });

    test('editar una fila existente actualiza en vez de duplicar', async () => {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        fireEvent.change(inputClienteModal(), { target: { value: 'Cliente Uno' } });
        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        fireEvent.click(screen.getByText('Editar'));
        fireEvent.change(screen.getByPlaceholderText(
            '¿Qué se busca conseguir con este cliente aquí?'
        ), { target: { value: 'Cerrar contrato de suturas' } });
        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        assert.equal(leerEstrategias().length, 1, 'editar no debe crear una segunda fila');
        assert.equal(
            (leerEstrategias()[0] as { proyecto: string }).proyecto,
            'Cerrar contrato de suturas'
        );
    });

    test('filtrar por cliente esconde lo que no coincide', async () => {
        await act(async () => montar());

        for (const nombre of ['Hospital A', 'Hospital B']) {
            fireEvent.click(screen.getByText('+ Nueva estrategia'));
            fireEvent.change(inputClienteModal(), { target: { value: nombre } });
            await act(async () => { fireEvent.click(screen.getByText('Guardar')); });
        }

        fireEvent.change(inputClienteFiltro(), { target: { value: 'Hospital A' } });

        assert.ok(screen.getByText('Hospital A'));
        assert.equal(screen.queryByText('Hospital B'), null);
    });

    test('eliminar quita la fila del almacén', async () => {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        fireEvent.change(inputClienteModal(), { target: { value: 'Cliente a borrar' } });
        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        fireEvent.click(screen.getByText('Editar'));
        fireEvent.click(screen.getByText('Eliminar'));

        assert.equal(leerEstrategias().length, 0);
    });
});
