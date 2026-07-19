/**
 * @vitest-environment happy-dom
 *
 * La paleta de comandos.
 *
 * Dos cosas que probar: que la búsqueda dé UN resultado por cliente —y el correcto—, y que se
 * pueda usar entera sin tocar el ratón. Una paleta que obliga a apuntar con el ratón no
 * ahorra nada respecto a mirar el calendario.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';

import { Paleta, type AccionPaleta } from '@modules/paleta/components/Paleta';
import { resultadosPorCliente, MAX_RESULTADOS } from '@modules/paleta/services/busqueda';
import { initPaleta, abrirPaleta, cerrarPaleta, hayPaletaAbierta } from '@modules/paleta/montarPaleta';

import { guardarVisitas } from '../js/storage.js';
import { visita } from './ayuda/fixtures.js';
import type { Visita } from '@core/tipos';

const AHORA = new Date(2026, 6, 15, 10, 0, 0);

// ---------- la búsqueda ----------

describe('un resultado por cliente', () => {
    test('sin consulta no se ofrece ningún cliente', () => {
        // Sin filtro serían la lista entera de visitas y taparían las acciones fijas.
        const vs = [visita({ cliente: 'Uno' }), visita({ cliente: 'Dos' })];
        assert.deepEqual(resultadosPorCliente(vs, '', AHORA), []);
        assert.deepEqual(resultadosPorCliente(vs, '   ', AHORA), []);
    });

    test('diez visitas del mismo cliente dan UNA fila', () => {
        const vs = Array.from({ length: 10 }, (_, i) =>
            visita({ cliente: 'Hospital X', dia: `2026-07-${String(i + 10).padStart(2, '0')}` }));

        assert.equal(resultadosPorCliente(vs, 'hospital', AHORA).length, 1);
    });

    test('de un cliente con pasado y futuro, gana la PRÓXIMA', () => {
        const vs = [
            visita({ id: 'pasada', cliente: 'Uno', dia: '2026-07-01' }),
            visita({ id: 'proxima', cliente: 'Uno', dia: '2026-07-20' }),
            visita({ id: 'lejana', cliente: 'Uno', dia: '2026-09-01' })
        ];

        assert.equal(resultadosPorCliente(vs, 'uno', AHORA)[0]?.id, 'proxima');
    });

    test('si todo ya pasó, gana la más RECIENTE', () => {
        const vs = [
            visita({ id: 'vieja', cliente: 'Uno', dia: '2026-01-01' }),
            visita({ id: 'reciente', cliente: 'Uno', dia: '2026-07-10' })
        ];

        assert.equal(resultadosPorCliente(vs, 'uno', AHORA)[0]?.id, 'reciente');
    });

    test('busca también por hospital, no solo por cliente', () => {
        const vs = [visita({ cliente: 'Grupo Norte', hospital: 'Hospital General' })];
        assert.equal(resultadosPorCliente(vs, 'general', AHORA).length, 1);
    });

    test('una visita sin fecha no desbanca a una que sí la tiene', () => {
        const vs = [
            visita({ id: 'confecha', cliente: 'Uno', dia: '2026-07-20' }),
            visita({ id: 'sinfecha', cliente: 'Uno', dia: '', hora_inicio: '' })
        ];

        assert.equal(resultadosPorCliente(vs, 'uno', AHORA)[0]?.id, 'confecha');
    });

    test('las que no tienen fecha van al FINAL, no al principio', () => {
        // Antes se ordenaba con `a.ini || 0`, que convierte el nulo en 1970: una visita a la
        // que le falta la hora se colaba por encima de la de mañana.
        const vs = [
            visita({ id: 'sinfecha', cliente: 'Zeta', dia: '', hora_inicio: '' }),
            visita({ id: 'manana', cliente: 'Alfa', dia: '2026-07-16' })
        ];

        const r = resultadosPorCliente(vs, '', AHORA);
        assert.deepEqual(r, []);   // sin consulta, nada

        const conQ = resultadosPorCliente(
            [visita({ id: 'sinfecha', cliente: 'Clinica Z', dia: '', hora_inicio: '' }),
             visita({ id: 'manana', cliente: 'Clinica A', dia: '2026-07-16' })],
            'clinica', AHORA);

        assert.deepEqual(conQ.map(v => v.id), ['manana', 'sinfecha']);
    });

    test('nunca se devuelven más de ocho', () => {
        const vs = Array.from({ length: 20 }, (_, i) =>
            visita({ cliente: `Cliente ${i}`, hospital: 'Comun' }));

        assert.equal(resultadosPorCliente(vs, 'comun', AHORA).length, MAX_RESULTADOS);
    });

    test('visitas sin cliente ni hospital no se agrupan todas en una', () => {
        const vs = [
            visita({ id: 'a', cliente: '', hospital: '' }),
            visita({ id: 'b', cliente: '', hospital: '' })
        ];
        // Se agrupan por id: cada una sigue siendo algo a lo que saltar. Con `''` como clave
        // común, la segunda escondería a la primera.
        assert.equal(resultadosPorCliente(vs, '', AHORA).length, 0);
        assert.equal(resultadosPorCliente(vs, ' ', AHORA).length, 0);
    });
});

// ---------- la pantalla ----------

const accion = (etiqueta: string, atajo: string, fn = () => {}): AccionPaleta =>
    ({ etiqueta, atajo, fn });

const ACCIONES = [
    accion('Nueva visita', 'N'),
    accion('Ir a hoy', 'T'),
    accion('Vista Día', 'D')
];

function pintar(props: Partial<React.ComponentProps<typeof Paleta>> = {}) {
    return render(
        <Paleta
            acciones={ACCIONES}
            visitas={[]}
            onIrAVisita={() => {}}
            onCerrar={() => {}}
            {...props}
        />
    );
}

const opciones = () => [...document.querySelectorAll('.paleta-opt')];
const activa = () => document.querySelector('.paleta-opt.is-active')?.textContent;
const campo = () => document.querySelector('.paleta-inp') as HTMLInputElement;

afterEach(cleanup);

describe('la pantalla', () => {
    test('al abrir se ven las acciones y ninguna visita', () => {
        pintar({ visitas: [visita({ cliente: 'Uno' })] });

        assert.equal(opciones().length, 3);
        assert.equal(activa(), 'Nueva visitaN', 'la primera arranca seleccionada');
    });

    test('escribir filtra las acciones por su texto', async () => {
        pintar();
        await act(async () => { fireEvent.change(campo(), { target: { value: 'vista' } }); });

        assert.deepEqual(opciones().map(o => o.querySelector('.t')?.textContent), ['Vista Día']);
    });

    test('escribir trae los clientes agendados', async () => {
        pintar({ visitas: [visita({ cliente: 'Hospital Norte', hospital: 'Torre A' })] });
        await act(async () => { fireEvent.change(campo(), { target: { value: 'norte' } }); });

        assert.ok(screen.getByText('Hospital Norte · Torre A'));
    });

    test('sin coincidencias lo dice, en vez de dejar el hueco', async () => {
        pintar();
        await act(async () => { fireEvent.change(campo(), { target: { value: 'xyzzy' } }); });

        assert.ok(screen.getByText('Sin resultados.'));
        assert.equal(opciones().length, 0);
    });
});

describe('se usa entera con el teclado', () => {
    test('las flechas mueven la selección', async () => {
        pintar();

        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });
        assert.equal(activa(), 'Ir a hoyT');

        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowUp' }); });
        assert.equal(activa(), 'Nueva visitaN');
    });

    test('da la vuelta por los dos extremos', async () => {
        pintar();

        // Subir desde la primera lleva a la última: con ocho opciones es más rápido que bajar.
        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowUp' }); });
        assert.equal(activa(), 'Vista DíaD');

        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });
        assert.equal(activa(), 'Nueva visitaN');
    });

    test('Enter ejecuta la seleccionada, no la primera', async () => {
        const hechas: string[] = [];
        pintar({
            acciones: [
                accion('Nueva visita', 'N', () => hechas.push('nueva')),
                accion('Ir a hoy', 'T', () => hechas.push('hoy'))
            ]
        });

        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });
        await act(async () => { fireEvent.keyDown(campo(), { key: 'Enter' }); });

        assert.deepEqual(hechas, ['hoy']);
    });

    test('al filtrar, la selección vuelve arriba', async () => {
        pintar();

        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });
        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });
        assert.equal(activa(), 'Vista DíaD');

        await act(async () => { fireEvent.change(campo(), { target: { value: 'i' } }); });

        // Dejarla en el índice 2 sobre una lista recién filtrada señalaría algo que nadie eligió.
        assert.equal(opciones().indexOf(document.querySelector('.paleta-opt.is-active')!), 0);
    });

    test('Enter sobre una lista vacía no revienta', async () => {
        pintar();
        await act(async () => { fireEvent.change(campo(), { target: { value: 'xyzzy' } }); });
        await act(async () => { fireEvent.keyDown(campo(), { key: 'Enter' }); });
        // Llegar aquí es la prueba.
    });

    test('Escape cierra', async () => {
        let cerrada = false;
        pintar({ onCerrar: () => { cerrada = true; } });

        await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
        assert.equal(cerrada, true);
    });

    test('el foco no sale del campo: se anuncia con aria-activedescendant', async () => {
        pintar();
        await act(async () => { fireEvent.keyDown(campo(), { key: 'ArrowDown' }); });

        const marcada = campo().getAttribute('aria-activedescendant');
        assert.equal(marcada, 'paleta-op-1');
        assert.equal(document.getElementById(marcada!)?.getAttribute('aria-selected'), 'true');
    });
});

describe('saltar a una visita', () => {
    test('lleva primero al día y luego abre la visita', async () => {
        const orden: string[] = [];
        const v = visita({ id: 'v-9', cliente: 'Hospital Norte', dia: '2026-08-03' });

        // El orden importa: abrir el drawer sobre el calendario en otra fecha deja detrás un
        // contexto que no corresponde a lo que se está mirando.
        initPaleta({
            onIrADia: () => orden.push('dia'),
            onAbrirVisita: () => orden.push('visita')
        });
        guardarVisitas([v]);
        // `abrirPaleta` pinta con React fuera de un evento: sin `act` la prueba consulta el DOM
        // antes de que exista y `campo()` sale nulo.
        await act(async () => { abrirPaleta(); });

        await act(async () => {
            fireEvent.change(campo(), { target: { value: 'norte' } });
        });
        await act(async () => { fireEvent.click(screen.getByText('Hospital Norte · Hospital General')); });

        assert.deepEqual(orden, ['dia', 'visita']);
        assert.equal(hayPaletaAbierta(), false, 'saltar cierra la paleta');
    });
});

// ---------- el montaje ----------

describe('el montaje', () => {
    beforeEach(() => {
        localStorage.clear();
        // El módulo guarda su estado fuera de React. Sin reiniciarlo, una prueba que falle
        // dejando la paleta abierta hace fallar a la siguiente, y el fallo real queda
        // enterrado bajo su propia cascada —que es como se pierde una tarde—.
        cerrarPaleta();
        document.body.innerHTML = '';
    });

    test('arranca cerrada y no pinta nada', () => {
        initPaleta({});
        assert.equal(hayPaletaAbierta(), false);
        assert.equal(document.querySelector('.paleta-raiz'), null);
    });

    test('abrir y cerrar la monta y la desmonta', async () => {
        initPaleta({});

        await act(async () => { abrirPaleta(); });
        assert.ok(document.querySelector('.paleta-raiz'));
        assert.equal(hayPaletaAbierta(), true);

        await act(async () => { cerrarPaleta(); });
        assert.equal(document.querySelector('.paleta-raiz'), null);
    });

    test('cada apertura arranca con el campo limpio', async () => {
        initPaleta({});

        await act(async () => { abrirPaleta(); });
        await act(async () => { fireEvent.change(campo(), { target: { value: 'algo' } }); });
        await act(async () => { cerrarPaleta(); });
        await act(async () => { abrirPaleta(); });

        assert.equal(campo().value, '', 'se desmonta a propósito para no tener que reiniciarlo');
    });

    test('relee las visitas en cada apertura', async () => {
        initPaleta({});
        guardarVisitas([]);

        await act(async () => { abrirPaleta(); });
        await act(async () => { fireEvent.change(campo(), { target: { value: 'nuevo' } }); });
        assert.ok(screen.getByText('Sin resultados.'));
        await act(async () => { cerrarPaleta(); });

        // Una paleta que no encuentra lo que acabas de agendar se deja de usar.
        guardarVisitas([visita({ cliente: 'Cliente Nuevo', hospital: 'H' }) as Visita]);

        await act(async () => { abrirPaleta(); });
        await act(async () => { fireEvent.change(campo(), { target: { value: 'nuevo' } }); });
        assert.ok(screen.getByText('Cliente Nuevo · H'));
    });

    test('el scroll de la página se bloquea mientras está abierta', async () => {
        initPaleta({});

        await act(async () => { abrirPaleta(); });
        assert.equal(document.body.style.overflow, 'hidden');

        await act(async () => { cerrarPaleta(); });
        assert.equal(document.body.style.overflow, '');
    });
});
