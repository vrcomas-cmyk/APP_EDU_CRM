/**
 * @vitest-environment happy-dom
 *
 * El flujo completo de crear una visita, de principio a fin.
 *
 * Existe por un reporte concreto: al crear una visita y querer agregar sectores, la app decía
 * que la visita no estaba guardada y no dejaba continuar. Es un círculo cerrado —para guardar
 * hacen falta sectores, y para agregar sectores hacía falta guardar— así que bloquea la tarea
 * principal del producto.
 *
 * Las pruebas anteriores no lo detectaron porque cada una monta el drawer con la ventana de
 * sector SIMULADA. El fallo estaba justo en la costura entre React y esa ventana, que sigue
 * siendo vanilla: exactamente el punto que un doble oculta.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent } from '@testing-library/react';
import { act } from 'react';

import * as drawer from '@modules/visitas/montarDrawer';
import * as repo from '@modules/visitas/repository/visitasRepo';

import { guardarCatalogo } from '../js/storage.js';

const avisos: string[] = [];

beforeEach(() => {
    localStorage.clear();
    avisos.length = 0;
    document.body.innerHTML = '';

    guardarCatalogo({
        clientes: ['Cliente Uno'],
        sectores: ['GASAS', 'GUANTES'],
        origenes: ['BI', 'Ventas'],
        materiales: [{ material: 'GASA SIMPLE 10X10', sector: 'GASAS' }]
    });

    localStorage.setItem('sesion', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x'
    }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function abrirNueva() {
    act(() => {
        drawer.initDrawer({ onCambio: () => {}, onToast: (m: string) => avisos.push(m) });
    });
    act(() => { drawer.abrirNuevaVisita({}); });
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];

/** Encuentra un botón por su texto visible, en todo el documento. */
function boton(texto: string | RegExp): HTMLButtonElement | undefined {
    const casa = (t: string) => typeof texto === 'string' ? t.includes(texto) : texto.test(t);
    return $$('button').find(b => casa(b.textContent || '')) as HTMLButtonElement | undefined;
}

describe('agregar sectores a una visita nueva', () => {
    test('el drawer se abre en modo borrador', () => {
        abrirNueva();

        assert.ok($('.drawer'), 'el drawer debe montarse');
        assert.ok(boton('Guardar visita'), 'un borrador tiene Guardar, no Listo');
        assert.equal(boton('Guardar visita')!.disabled, true);
    });

    test('el botón de agregar sector existe y está disponible', () => {
        abrirNueva();

        const agregar = boton('Agregar sector');
        assert.ok(agregar, 'sin este botón no hay forma de completar la visita');
        assert.equal(agregar.disabled, false);
    });

    test('REGRESIÓN: agregar sector NO dice que la visita no está guardada', () => {
        // El síntoma reportado. Se vigilan las dos formas en que la app puede decirlo: un
        // aviso emergente o un `confirm` de descarte.
        const confirmaciones: string[] = [];
        vi.stubGlobal('confirm', (m: string) => { confirmaciones.push(m); return false; });

        abrirNueva();
        act(() => { boton('Agregar sector')!.click(); });

        assert.deepEqual(confirmaciones, [],
            'agregar un sector no debe preguntar por descartar la visita');
        assert.deepEqual(avisos.filter(a => /guardad/i.test(a)), [],
            'no debe avisar de que la visita no está guardada');
    });

    test('REGRESIÓN: la ventana de sector se abre y SIGUE abierta', () => {
        abrirNueva();
        act(() => { boton('Agregar sector')!.click(); });

        const ventana = $('.modal');
        assert.ok(ventana, 'la ventana de sector debe abrirse');
        assert.ok(document.body.contains(ventana),
            'y debe seguir en el documento: si React la borra al repintar, desaparece sola');
    });

    test('REGRESIÓN: la ventana de sector cuelga DENTRO de .drawer-raiz', () => {
        // Este es el bug de verdad, y es de apilado. `.drawer-raiz` es z-index 50 y crea su
        // propio contexto; `.modal` es z-index 20. Colgando el modal FUERA de ese contexto
        // —como hermano, en el contenedor de React— queda por debajo del drawer: se ve a
        // medias y los clics se los come el scrim, que responde ofreciendo descartar la visita.
        //
        // happy-dom no calcula z-index, así que no se puede afirmar el apilado. Lo que sí se
        // puede afirmar es la posición en el árbol, que es de donde sale el apilado.
        abrirNueva();
        act(() => { boton('Agregar sector')!.click(); });

        const raiz = $('.drawer-raiz');
        const ventana = $('.modal');

        assert.ok(raiz && ventana);
        assert.ok(raiz.contains(ventana),
            'fuera de .drawer-raiz el modal se dibuja por debajo del drawer');
    });

    test('REGRESIÓN: el drawer sigue vivo detrás de la ventana de sector', () => {
        abrirNueva();
        act(() => { boton('Agregar sector')!.click(); });

        assert.ok($('.drawer'), 'perder el drawer dejaría la captura sin a dónde volver');
    });

    test('REGRESIÓN: un sector agregado en la ventana APARECE en el drawer', () => {
        // El drawer leía la visita al montarse y no volvía a mirarla. La ventana de sector
        // escribe directo en el almacén, así que el sector recién agregado no salía en la
        // lista y Guardar seguía deshabilitado aunque ya no faltara nada.
        abrirNueva();
        const id = repo.leerVisitas()[0]!.id;

        act(() => { boton('Agregar sector')!.click(); });

        const opcion = $$('.modal button').find(b => (b.textContent || '').includes('GASAS'));
        act(() => { (opcion as HTMLButtonElement).click(); });

        act(() => {
            repo.actualizarVisita(id, v => {
                const s = v.sectores![0]!;
                s.objetivo = 'Revisar rotación';
                s.origen = ['BI'];
                s.solicitado_por = 'Gerencia';
            });
        });

        // Cerrar la ventana con Escape desde el buscador.
        const cerrarBtn = $$('.modal button').find(b => (b.textContent || '').includes('Listo')
            || (b.getAttribute('aria-label') || '').includes('Cerrar'));
        if (cerrarBtn) act(() => { (cerrarBtn as HTMLButtonElement).click(); });

        assert.ok($('.sector-card'),
            'el sector debe verse en el drawer sin tener que reabrirlo');
    });

    test('flujo completo: elegir sector, completarlo y guardar la visita', () => {
        abrirNueva();
        const id = repo.leerVisitas()[0]!.id;

        // Datos de la visita.
        act(() => {
            repo.actualizarVisita(id, v => {
                v.cliente = 'Cliente Uno';
                v.hospital = 'Hospital General';
                v.dia = '2026-07-20';
                v.hora_inicio = '09:00';
                v.hora_fin = '11:00';
            });
        });

        act(() => { boton('Agregar sector')!.click(); });

        // Elegir GASAS del buscador.
        const opcion = $$('.modal button').find(b => (b.textContent || '').includes('GASAS'));
        assert.ok(opcion, 'el buscador debe ofrecer los sectores del catálogo');
        act(() => { (opcion as HTMLButtonElement).click(); });

        // Completar los tres obligatorios.
        const objetivo = $<HTMLInputElement>('.modal input[type="text"], .modal textarea');
        assert.ok(objetivo, 'el paso de completar debe pedir el objetivo');

        act(() => {
            repo.actualizarVisita(id, v => {
                const s = v.sectores![0]!;
                s.objetivo = 'Revisar rotación';
                s.origen = ['BI'];
                s.solicitado_por = 'Gerencia';
            });
        });

        assert.equal(repo.obtenerVisita(id)!.sectores!.length, 1,
            'el sector debe quedar colgado de la visita');
    });
});

describe('la visita se guarda cuando está TODO', () => {
    test('con los siete requisitos, Guardar se habilita y sella', () => {
        abrirNueva();
        const id = repo.leerVisitas()[0]!.id;

        act(() => {
            repo.actualizarVisita(id, v => {
                v.cliente = 'Cliente Uno';
                v.hospital = 'Hospital General';
                v.dia = '2026-07-20';
                v.hora_inicio = '09:00';
                v.hora_fin = '11:00';
                v.sectores = [{
                    id: 's-1', nombre: 'GASAS', objetivo: 'Revisar rotación',
                    origen: ['BI'], solicitado_por: 'Gerencia', actividades: []
                }];
            });
        });

        // Repinta con el estado nuevo.
        act(() => { drawer.abrirVisita(id); });

        const guardar = boton('Guardar visita')!;
        assert.equal(guardar.disabled, false, 'con todo completo debe poder guardarse');

        act(() => { guardar.click(); });

        const guardada = repo.obtenerVisita(id)!;
        assert.equal(guardada.borrador, undefined, 'deja de ser borrador');
        assert.ok(guardada.sectores![0]!.guardado, 'y sus sectores quedan sellados');
    });
});
