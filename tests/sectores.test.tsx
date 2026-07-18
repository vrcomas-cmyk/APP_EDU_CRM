/**
 * @vitest-environment happy-dom
 *
 * Sectores: dominio y ventana.
 *
 * Se ejercita a través del seam real, igual que la actividad. Es la costura donde ya apareció
 * un bug de apilado que dejó la app inutilizable para su tarea principal.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent } from '@testing-library/react';
import { act } from 'react';

import {
    faltaEnSector, sectorCompleto, esEditable, conservables, sectoresLibres
} from '@modules/sectores/validators/requisitos';
import { filtrarSectores } from '@modules/sectores/services/busqueda';
import { abrirSector } from '@modules/sectores/montarSector';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Sector, Visita } from '@core/tipos';

import { guardarVisitas, guardarCatalogo } from '../js/storage.js';

// ---------- dominio ----------

const sector = (campos: Partial<Sector> = {}): Sector => ({
    id: 's-1', nombre: 'GASAS', actividades: [], ...campos
});

describe('faltaEnSector — los tres que dan sentido al registro', () => {
    test('un sector recién elegido debe los tres', () => {
        assert.deepEqual(faltaEnSector(sector()),
            ['Objetivo', 'Origen de la actividad', 'Solicitado por']);
    });

    test('completo no debe nada', () => {
        const s = sector({ objetivo: 'Revisar rotación', origen: ['BI'], solicitado_por: 'Gerencia' });
        assert.deepEqual(faltaEnSector(s), []);
        assert.equal(sectorCompleto(s), true);
    });

    test('un origen vacío cuenta como faltante', () => {
        assert.ok(faltaEnSector(sector({ objetivo: 'x', origen: [], solicitado_por: 'y' }))
            .includes('Origen de la actividad'));
    });

    test('los espacios en blanco no llenan nada', () => {
        const s = sector({ objetivo: '   ', origen: ['BI'], solicitado_por: '  ' });
        assert.deepEqual(faltaEnSector(s), ['Objetivo', 'Solicitado por']);
    });

    test('un nulo no revienta', () => {
        assert.equal(faltaEnSector(null).length, 3);
        assert.equal(sectorCompleto(undefined), false);
    });
});

describe('esEditable', () => {
    test('sin sello se edita', () => {
        assert.equal(esEditable(sector()), true);
    });

    test('con sello ya no', () => {
        assert.equal(esEditable(sector({ guardado: { momento: 'x' } })), false,
            'el sello lo pone Guardar visita: a partir de ahí es parte de lo que afirmó');
    });
});

describe('conservables — qué sobrevive al cerrar la ventana', () => {
    test('descarta los incompletos', () => {
        const lista = [
            sector({ id: 'a', objetivo: 'x', origen: ['BI'], solicitado_por: 'y' }),
            sector({ id: 'b' })
        ];
        assert.deepEqual(conservables(lista).map(s => s.id), ['a'],
            'un sector sin objetivo ni origen no dice nada, y obligaría a adivinar si sobra');
    });

    test('NUNCA descarta uno sellado, aunque le falten datos', () => {
        const lista = [sector({ id: 'viejo', guardado: { momento: 'x' } })];
        assert.deepEqual(conservables(lista).map(s => s.id), ['viejo'],
            'ya es parte de lo que la visita afirmó: borrarlo reescribiría la historia');
    });

    test('una lista vacía no revienta', () => {
        assert.deepEqual(conservables([]), []);
    });
});

describe('sectoresLibres', () => {
    test('quita los que la visita ya usa', () => {
        const v = { id: 'v', sectores: [sector({ nombre: 'GASAS' })] } as Visita;
        assert.deepEqual(sectoresLibres(['GASAS', 'GUANTES', 'SUTURAS'], v), ['GUANTES', 'SUTURAS']);
    });

    test('sin sectores devuelve el catálogo entero', () => {
        assert.deepEqual(sectoresLibres(['A', 'B'], { id: 'v' } as Visita), ['A', 'B']);
    });
});

describe('filtrarSectores — palabras sueltas, no subcadena', () => {
    const lista = ['GASA DE ALGODÓN SIMPLE', 'GASA DOBLADA', 'GUANTE LATEX'];

    test('empareja por palabras en cualquier orden', () => {
        assert.deepEqual(filtrarSectores(lista, 'gasa simple'), ['GASA DE ALGODÓN SIMPLE'],
            'esa cadena literal no aparece en el nombre; aun así debe encontrarse');
        assert.deepEqual(filtrarSectores(lista, 'simple gasa'), ['GASA DE ALGODÓN SIMPLE']);
    });

    test('sin consulta devuelve todo', () => {
        assert.equal(filtrarSectores(lista, '').length, 3);
        assert.equal(filtrarSectores(lista, '   ').length, 3);
    });

    test('sin coincidencias devuelve vacío, no la lista entera', () => {
        assert.deepEqual(filtrarSectores(lista, 'tornillo'), []);
    });

    test('respeta el límite', () => {
        assert.equal(filtrarSectores(lista, 'g', 1).length, 1);
    });
});

// ---------- ventana ----------

const visitaBorrador = (): Visita => ({
    id: 'v-1', educador: 'Ana López', cliente: 'Cliente Uno', hospital: 'Hospital General',
    dia: '', hora_inicio: '', hora_fin: '', estado: 'programada',
    borrador: true, sectores: [], sincronizado: false
});

function anfitrion(): HTMLElement {
    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    const interno = document.createElement('div');
    interno.className = 'ventanas-host';
    raiz.appendChild(interno);
    document.body.appendChild(raiz);
    return interno;
}

const avisos: string[] = [];

function abrir(sectorId: string | null = null) {
    const host = anfitrion();
    act(() => {
        abrirSector({
            host, visitaId: 'v-1', sectorId,
            alCambiar: () => {}, alToast: (m: string) => avisos.push(m)
        });
    });
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];
const boton = (texto: string) =>
    $$('button').find(b => (b.textContent || '').includes(texto)) as HTMLButtonElement | undefined;

const sectoresDe = () => repo.obtenerVisita('v-1')?.sectores ?? [];

beforeEach(() => {
    localStorage.clear();
    avisos.length = 0;
    document.body.innerHTML = '';
    guardarVisitas([visitaBorrador()]);
    guardarCatalogo({ sectores: ['GASAS', 'GUANTES', 'SUTURAS'], origenes: ['BI', 'Ventas'] });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('la ventana de sector', () => {
    test('cuelga DENTRO de .drawer-raiz', () => {
        abrir();
        assert.ok($('.drawer-raiz')!.contains($('.modal')!),
            'fuera de ese contexto queda por debajo del drawer y el scrim se come los clics');
    });

    test('arranca en el buscador y ofrece el catálogo', () => {
        abrir();

        const opciones = $$('.mat-opt').map(b => b.textContent);
        assert.deepEqual(opciones, ['GASAS', 'GUANTES', 'SUTURAS']);
    });

    test('elegir uno entra DIRECTO a completarlo', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        assert.match(document.body.textContent!, /Completa la información/,
            'elegirlo solo no sirve de nada');
        assert.equal(sectoresDe().length, 1);
    });

    test('el botón de guardar nace deshabilitado y dice qué falta', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        assert.equal(boton('Guardar sector')!.disabled, true);
        const pista = $('.pista')!.textContent!;
        assert.match(pista, /Objetivo/);
        assert.match(pista, /Origen/);
        assert.match(pista, /Solicitado por/);
    });

    test('con los tres completos se habilita y vuelve al buscador', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        const inputs = $$('.modal input[type="text"]') as HTMLInputElement[];
        act(() => { fireEvent.change(inputs[0]!, { target: { value: 'Revisar rotación' } }); });
        act(() => { boton('BI')!.click(); });
        act(() => {
            const i = $$('.modal input[type="text"]') as HTMLInputElement[];
            fireEvent.change(i[1]!, { target: { value: 'Gerencia' } });
        });

        assert.equal(boton('Guardar sector')!.disabled, false);
        act(() => { boton('Guardar sector')!.click(); });

        // Vuelve solo al buscador: encadenar sectores es el caso normal.
        assert.match(document.body.textContent!, /Ya agregados/);
        assert.ok(avisos.some(a => /GASAS agregado/.test(a)));
    });

    test('el origen se activa y se desactiva', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        act(() => { boton('BI')!.click(); });
        assert.deepEqual(sectoresDe()[0]!.origen, ['BI']);

        act(() => { boton('BI')!.click(); });
        assert.deepEqual(sectoresDe()[0]!.origen, []);
    });

    test('se pueden acumular varios orígenes', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        act(() => { boton('BI')!.click(); });
        act(() => { boton('Ventas')!.click(); });

        assert.deepEqual(sectoresDe()[0]!.origen, ['BI', 'Ventas']);
    });

    test('"Quitar" descarta el sector y vuelve al buscador', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });
        act(() => { boton('Quitar')!.click(); });

        assert.equal(sectoresDe().length, 0);
        assert.ok($('.mat-res'), 'debe volver al buscador');
    });

    test('un sector ya usado NO se vuelve a ofrecer', () => {
        const v = visitaBorrador();
        v.sectores = [{ id: 's-1', nombre: 'GASAS', objetivo: 'x', origen: ['BI'], solicitado_por: 'y', actividades: [] }];
        guardarVisitas([v]);
        abrir();

        assert.deepEqual($$('.mat-opt').map(b => b.textContent), ['GUANTES', 'SUTURAS']);
    });

    test('un sector SELLADO se muestra pero no se puede corregir', () => {
        const v = visitaBorrador();
        v.sectores = [{
            id: 's-1', nombre: 'GASAS', objetivo: 'x', origen: ['BI'], solicitado_por: 'y',
            guardado: { momento: '2026-07-15T09:00:00.000Z' }, actividades: []
        }];
        guardarVisitas([v]);
        abrir();

        const chip = $$('.chip').find(c => c.textContent === 'GASAS') as HTMLButtonElement;
        assert.equal(chip.disabled, true);
        assert.match(chip.title, /sellado/);
    });

    test('cerrar descarta lo que quedó a medias', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });   // queda incompleto
        act(() => { $<HTMLButtonElement>('.icon-btn[aria-label="Cerrar"]')!.click(); });

        assert.equal(sectoresDe().length, 0,
            'dejarlo colgado obligaría a adivinar si se quiso agregar o fue un clic de más');
    });

    test('cerrar CONSERVA los completos', () => {
        abrir();
        act(() => { boton('GASAS')!.click(); });

        const inputs = $$('.modal input[type="text"]') as HTMLInputElement[];
        act(() => { fireEvent.change(inputs[0]!, { target: { value: 'Revisar' } }); });
        act(() => { boton('BI')!.click(); });
        act(() => {
            const i = $$('.modal input[type="text"]') as HTMLInputElement[];
            fireEvent.change(i[1]!, { target: { value: 'Gerencia' } });
        });
        act(() => { boton('Guardar sector')!.click(); });
        act(() => { boton('Listo')!.click(); });

        assert.equal(sectoresDe().length, 1);
        assert.equal(sectoresDe()[0]!.guardado, undefined,
            'el sello lo pone Guardar visita, no esta ventana');
    });

    test('sin catálogo lo dice, en vez de mostrar un buscador vacío', () => {
        guardarCatalogo({ sectores: [], origenes: ['BI'] });
        abrir();

        assert.match(document.body.textContent!, /no ha cargado todavía/);
    });

    test('con todos los sectores usados lo dice', () => {
        const v = visitaBorrador();
        v.sectores = ['GASAS', 'GUANTES', 'SUTURAS'].map((nombre, i) => ({
            id: `s-${i}`, nombre, objetivo: 'x', origen: ['BI'], solicitado_por: 'y', actividades: []
        }));
        guardarVisitas([v]);
        abrir();

        assert.match(document.body.textContent!, /Ya agregaste todos/);
    });

    test('el buscador empareja por palabras sueltas', () => {
        guardarCatalogo({ sectores: ['GASA DE ALGODÓN SIMPLE', 'GUANTES'], origenes: ['BI'] });
        abrir();

        const busq = $<HTMLInputElement>('.modal input[type="text"]')!;
        act(() => { fireEvent.change(busq, { target: { value: 'gasa simple' } }); });

        assert.deepEqual($$('.mat-opt').map(b => b.textContent), ['GASA DE ALGODÓN SIMPLE']);
    });
});
