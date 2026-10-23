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

/** Sector y Grupo de artículo son obligatorios: los llena para que Guardar se habilite. */
function llenarObligatorios(sector = 'GASAS', grupo = 'Gasas') {
    const modal = within(document.querySelector('.modal-body') as HTMLElement);
    fireEvent.change(modal.getByLabelText(/^Sector/), { target: { value: sector } });
    fireEvent.change(modal.getByLabelText(/^Grupo de artículo/), { target: { value: grupo } });
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

        llenarObligatorios();

        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        assert.ok(screen.getAllByText('Hospital Los Pilares').length >= 1);
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

    test('filtrar por cliente esconde lo que no coincide', async () => {
        await act(async () => montar());

        for (const nombre of ['Hospital A', 'Hospital B']) {
            fireEvent.click(screen.getByText('+ Nueva estrategia'));
            fireEvent.change(inputClienteModal(), { target: { value: nombre } });
            llenarObligatorios();
            await act(async () => { fireEvent.click(screen.getByText('Guardar')); });
        }

        fireEvent.change(inputClienteFiltro(), { target: { value: 'Hospital A' } });

        assert.ok(screen.getAllByText('Hospital A').length >= 1);
        assert.equal(screen.queryAllByText('Hospital B').length, 0);
    });

    test('elegir un sector en el formulario acota el grupo de artículo a ese sector', async () => {
        guardarCatalogo({
            clientes: ['Cliente Uno'], sectores: ['GASAS', 'SUTURAS'],
            grupos_articulo: ['Suturas', 'Gasas', 'Cuidado de Heridas'],
            materiales: [
                { material: 'GASA SIMPLE', sector: 'GASAS', grupo_articulo: 'Gasas' },
                { material: 'GASA DOBLADA', sector: 'GASAS', grupo_articulo: 'Cuidado de Heridas' },
                { material: 'SUTURA 3-0', sector: 'SUTURAS', grupo_articulo: 'Suturas' }
            ]
        });

        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        const modal = within(document.querySelector('.modal-body') as HTMLElement);

        fireEvent.change(modal.getByLabelText(/^Sector/), { target: { value: 'GASAS' } });

        assert.ok(modal.getByText('Cuidado de Heridas'));
        assert.ok(modal.getByText('Gasas'));
        assert.equal(modal.queryByText('Suturas'), null,
            'Suturas no se trabaja en el sector GASAS de este catálogo');
    });

    test('Productos: autocompleta materiales del sector y permite varios', async () => {
        guardarCatalogo({
            clientes: ['Cliente Uno'], sectores: ['GASAS'], grupos_articulo: ['Gasas'],
            materiales: [
                { material: 'GASA SIMPLE 10X10', sector: 'GASAS', grupo_articulo: 'Gasas' },
                { material: 'GASA DOBLADA 5X5', sector: 'GASAS', grupo_articulo: 'Gasas' }
            ]
        });

        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        const modal = within(document.querySelector('.modal-body') as HTMLElement);

        fireEvent.change(inputClienteModal(), { target: { value: 'Cliente Uno' } });
        fireEvent.change(modal.getByLabelText(/^Sector/), { target: { value: 'GASAS' } });
        fireEvent.change(modal.getByLabelText(/^Grupo de artículo/), { target: { value: 'Gasas' } });

        const campoProductos = modal.getByLabelText('Productos') as HTMLInputElement;
        fireEvent.change(campoProductos, { target: { value: 'gasa' } });
        fireEvent.mouseDown(modal.getByRole('option', { name: 'GASA SIMPLE 10X10' }));

        assert.ok(modal.getByText('GASA SIMPLE 10X10'), 'queda como chip elegido');

        // El campo se limpia y deja agregar un segundo producto.
        fireEvent.change(modal.getByLabelText('Productos'), { target: { value: 'gasa doblada' } });
        fireEvent.mouseDown(modal.getByRole('option', { name: 'GASA DOBLADA 5X5' }));

        assert.ok(modal.getByText('GASA SIMPLE 10X10'));
        assert.ok(modal.getByText('GASA DOBLADA 5X5'));

        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        const guardada = leerEstrategias()[0] as { productos?: string[] };
        assert.deepEqual(guardada.productos, ['GASA SIMPLE 10X10', 'GASA DOBLADA 5X5']);
    });

    test('Sector y Grupo de artículo son obligatorios para guardar', async () => {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        fireEvent.change(inputClienteModal(), { target: { value: 'Cliente Uno' } });

        assert.equal((screen.getByText('Guardar') as HTMLButtonElement).disabled, true);
        llenarObligatorios();
        assert.equal((screen.getByText('Guardar') as HTMLButtonElement).disabled, false);
    });

    test('con grupo elegido, Productos solo ofrece materiales de ese grupo', async () => {
        guardarCatalogo({
            clientes: ['Cliente Uno'], sectores: ['GASAS'], grupos_articulo: ['Gasas', 'Cuidado de Heridas'],
            materiales: [
                { material: 'GASA SIMPLE', sector: 'GASAS', grupo_articulo: 'Gasas' },
                { material: 'GASA APOSITO', sector: 'GASAS', grupo_articulo: 'Cuidado de Heridas' }
            ]
        });
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        const modal = within(document.querySelector('.modal-body') as HTMLElement);
        llenarObligatorios('GASAS', 'Gasas');

        fireEvent.change(modal.getByLabelText('Productos'), { target: { value: 'gasa' } });
        assert.ok(modal.getByRole('option', { name: 'GASA SIMPLE' }));
        assert.equal(modal.queryByRole('option', { name: 'GASA APOSITO' }), null);
    });

    /** Crea una estrategia por la UI y abre la tarjeta del cliente y luego la estrategia. */
    async function crearYAbrir(cliente = 'Cliente Uno') {
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        fireEvent.change(inputClienteModal(), { target: { value: cliente } });
        llenarObligatorios();
        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });
        fireEvent.click(screen.getByLabelText(`Ver el detalle de ${cliente}`));
        fireEvent.click(screen.getByText('Gasas', { selector: 'td' }));
    }

    test('no existe forma de eliminar una estrategia', async () => {
        await crearYAbrir();
        assert.equal(screen.queryByText('Eliminar'), null);
        assert.equal(leerEstrategias().length, 1);
    });

    test('una estrategia guardada es de solo lectura: solo se mueven etapa y estatus', async () => {
        await crearYAbrir();
        const detalle = within(screen.getByRole('dialog', { name: 'Detalle de la estrategia' }));

        // Sin campos de captura editables (proyecto, sector, grupo…), solo el panel de avance.
        assert.equal(detalle.queryByPlaceholderText('¿Qué se busca conseguir con este cliente aquí?'), null);
        assert.equal((detalle.getByText('Registrar avance', { selector: 'button' }) as HTMLButtonElement).disabled, true);

        fireEvent.change(detalle.getByLabelText('Etapa'), { target: { value: 'Presentación' } });
        fireEvent.change(detalle.getByLabelText('Estatus'), { target: { value: 'En curso' } });
        fireEvent.change(detalle.getByPlaceholderText('Nota del avance (opcional)'), { target: { value: 'Visita con jefe de compras' } });
        await act(async () => { fireEvent.click(detalle.getByText('Registrar avance', { selector: 'button' })); });

        const e = leerEstrategias()[0] as { etapa?: string; estatus?: string; sector?: string; etapas?: unknown[] };
        assert.equal(e.etapa, 'Presentación');
        assert.equal(e.estatus, 'En curso');
        assert.equal(e.sector, 'GASAS', 'lo demás no cambia');
        assert.equal(e.etapas?.length, 2, 'creación + avance en la línea de tiempo');
        assert.ok(detalle.getByText('Visita con jefe de compras'));
    });

    test('Finalizar exige comentario, archiva la estrategia y "Mostrar archivadas" la devuelve', async () => {
        await crearYAbrir();
        const detalle = within(screen.getByRole('dialog', { name: 'Detalle de la estrategia' }));

        fireEvent.click(detalle.getByText('Finalizar', { exact: false }));
        const modalFin = within(screen.getByRole('dialog', { name: 'Finalizar estrategia' }));
        const confirmar = modalFin.getByText('Finalizar', { selector: 'button.btn-principal' }) as HTMLButtonElement;
        assert.equal(confirmar.disabled, true, 'sin comentario no se puede finalizar');

        fireEvent.change(modalFin.getByLabelText(/¿Cómo se logró\?/), { target: { value: 'Compraron el catálogo completo' } });
        await act(async () => { fireEvent.click(confirmar); });

        const e = leerEstrategias()[0] as {
            archivada?: boolean; desenlace?: string; desenlace_comentario?: string; etapas?: { nota?: string }[];
        };
        assert.equal(e.archivada, true);
        assert.equal(e.desenlace, 'finalizado');
        assert.equal(e.desenlace_comentario, 'Compraron el catálogo completo');
        assert.match(e.etapas?.at(-1)?.nota ?? '', /^Finalizada: Compraron/, 'queda en la bitácora');
        assert.equal(leerEstrategias().length, 1, 'finalizar nunca borra');

        // Cierra los modales: la tarjeta ya no aparece en la lista por defecto.
        fireEvent.click(screen.getAllByLabelText('Cerrar')[1]!);
        fireEvent.click(screen.getAllByLabelText('Cerrar')[0]!);
        assert.equal(screen.queryByLabelText('Ver el detalle de Cliente Uno'), null);

        fireEvent.click(screen.getByLabelText('Mostrar archivadas'));
        assert.ok(screen.getByLabelText('Ver el detalle de Cliente Uno'));
    });

    test('un producto se archiva dentro de la estrategia sin archivar la estrategia', async () => {
        guardarCatalogo({
            clientes: ['Cliente Uno'], sectores: ['GASAS'], grupos_articulo: ['Gasas'],
            materiales: [{ material: 'GASA SIMPLE', sector: 'GASAS', grupo_articulo: 'Gasas' }]
        });
        await act(async () => montar());
        fireEvent.click(screen.getByText('+ Nueva estrategia'));
        const modal = within(document.querySelector('.modal-body') as HTMLElement);
        fireEvent.change(inputClienteModal(), { target: { value: 'Cliente Uno' } });
        llenarObligatorios();
        fireEvent.change(modal.getByLabelText('Productos'), { target: { value: 'gasa' } });
        fireEvent.mouseDown(modal.getByRole('option', { name: 'GASA SIMPLE' }));
        await act(async () => { fireEvent.click(screen.getByText('Guardar')); });

        fireEvent.click(screen.getByLabelText('Ver el detalle de Cliente Uno'));
        fireEvent.click(screen.getByText('Gasas', { selector: 'td' }));
        fireEvent.click(screen.getByLabelText('Archivar GASA SIMPLE'));

        const e = leerEstrategias()[0] as { archivada?: boolean; productos_archivados?: string[] };
        assert.deepEqual(e.productos_archivados, ['GASA SIMPLE']);
        assert.notEqual(e.archivada, true);
    });
});
