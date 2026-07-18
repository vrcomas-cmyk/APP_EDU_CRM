/**
 * @vitest-environment happy-dom
 *
 * La ventana de actividad, renderizada.
 *
 * Incluye el flujo REAL a través del seam, no solo el componente aislado. Es la lección del
 * bug de los sectores: aquel fallo vivía justo en la costura entre React y el DOM que la
 * rodea, y las pruebas que montaban el componente con todo simulado no podían verlo.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent } from '@testing-library/react';
import { act } from 'react';

import { abrirActividad } from '@modules/actividades/montarActividad';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Visita } from '@core/tipos';

import { guardarVisitas, guardarCatalogo } from '../js/storage.js';

const avisos: string[] = [];

const visitaBase = (): Visita => ({
    id: 'v-1',
    educador: 'Ana López',
    educador_correo: 'ana@x.com',
    cliente: 'Cliente Uno',
    hospital: 'Hospital General',
    dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '11:00',
    estado: 'en-proceso',
    check_in: { momento: '2026-07-15T09:05:00.000Z' },
    sectores: [{
        id: 's-1', nombre: 'GASAS',
        guardado: { momento: '2026-07-15T09:00:00.000Z' },
        actividades: []
    }],
    sincronizado: false
});

/** Anfitrión con la misma forma que el real: un nodo interno de `.drawer-raiz`. */
function anfitrion(): HTMLElement {
    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    const interno = document.createElement('div');
    interno.className = 'ventanas-host';
    raiz.appendChild(interno);
    document.body.appendChild(raiz);
    return interno;
}

function abrir(actividadId: string | null = null) {
    const host = anfitrion();
    act(() => {
        abrirActividad({
            host, visitaId: 'v-1', sectorId: 's-1', actividadId,
            alCambiar: () => {}, alToast: (m: string) => avisos.push(m)
        });
    });
    return host;
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];

function boton(texto: string | RegExp): HTMLButtonElement | undefined {
    const casa = (t: string) => typeof texto === 'string' ? t.includes(texto) : texto.test(t);
    return $$('button').find(b => casa(b.textContent || '')) as HTMLButtonElement | undefined;
}

/** La actividad bajo prueba. Falla con un mensaje claro si no existe, en vez de con `undefined`. */
function actividadDe() {
    const a = repo.obtenerVisita('v-1')?.sectores?.[0]?.actividades?.[0];
    assert.ok(a, 'no hay actividad en el sector');
    return a;
}

beforeEach(() => {
    localStorage.clear();
    avisos.length = 0;
    document.body.innerHTML = '';

    guardarVisitas([visitaBase()]);
    guardarCatalogo({
        tipos_actividad: [
            { nombre: 'Capacitación', campos: { area_visitada: 'obligatorio', contacto_nombre: 'obligatorio', materiales: 'oculto', evidencia: 'obligatorio' } },
            // Los TRES campos de contacto se ocultan: dejar uno en su valor por defecto
            // mantendría el bloque en pie, que es lo correcto y no lo que esta prueba mide.
            { nombre: 'Entrega de muestras', campos: {
                area_visitada: 'oculto',
                contacto_nombre: 'oculto', contacto_cargo: 'oculto', contacto_servicio: 'oculto',
                materiales: 'obligatorio', evidencia: 'obligatorio'
            } }
        ],
        areas: ['Área Usuaria', 'Otra'],
        materiales: [{ material: 'GASA SIMPLE 10X10', sector: 'GASAS' }]
    });
    localStorage.setItem('sesion', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x'
    }));
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('la ventana se abre donde debe', () => {
    test('cuelga DENTRO de .drawer-raiz', () => {
        // Misma regresión que la ventana de sector: fuera de ese contexto de apilado la
        // ventana queda por debajo del drawer y los clics se los come el scrim.
        abrir();

        const raiz = $('.drawer-raiz');
        const ventana = $('.modal');

        assert.ok(raiz && ventana);
        assert.ok(raiz.contains(ventana));
    });

    test('crear sin id deja un borrador persistido de inmediato', () => {
        abrir();

        const act = actividadDe();
        assert.ok(act, 'perder lo escrito por un bloqueo de pantalla es el peor error posible');
        assert.equal(act.guardada, undefined, 'pero todavía es borrador');
        assert.equal(act.evidencia?.estado, 'pendiente');
    });
});

describe('borrador — el formulario sale de la configuración', () => {
    test('sin tipo elegido, la barra invita a elegirlo', () => {
        abrir();
        assert.match($('.regla')!.textContent!, /ELIGE UN TIPO/);
    });

    test('al elegir un tipo, la barra DECLARA lo que va a pedir', () => {
        abrir();

        const select = $<HTMLSelectElement>('.modal select')!;
        act(() => { fireEvent.change(select, { target: { value: 'Capacitación' } }); });

        const regla = $('.regla')!.textContent!;
        assert.match(regla, /ESTE TIPO PIDE/);
        assert.match(regla, /ÁREA VISITADA/);
        // Se declara ANTES de que los campos aparezcan: el formulario no cambia por magia.
    });

    test('los campos que aparecen dependen del TIPO, no de un if', () => {
        abrir();
        const select = $<HTMLSelectElement>('.modal select')!;

        act(() => { fireEvent.change(select, { target: { value: 'Capacitación' } }); });
        assert.match(document.body.textContent!, /Contacto responsable/);
        assert.ok(!/Materiales/.test(document.body.textContent!));

        act(() => { fireEvent.change(select, { target: { value: 'Entrega de muestras' } }); });
        assert.match(document.body.textContent!, /Materiales/);
        assert.ok(!/Contacto responsable/.test(document.body.textContent!),
            'ese tipo esconde los tres campos de contacto: el bloque entero sobra');
    });

    test('basta con que UNO de los campos de contacto sea visible para que el bloque exista', () => {
        guardarCatalogo({
            tipos_actividad: [{ nombre: 'Solo cargo', campos: {
                area_visitada: 'oculto', materiales: 'oculto', evidencia: 'oculto',
                contacto_nombre: 'oculto', contacto_cargo: 'opcional', contacto_servicio: 'oculto'
            } }],
            areas: ['Área Usuaria']
        });
        abrir();

        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Solo cargo' } });
        });

        assert.match(document.body.textContent!, /Contacto responsable/);
        assert.match(document.body.textContent!, /Cargo/);
    });

    test('lo que la app ya sabe no se pregunta', () => {
        abrir();

        const ctx = $('.ctx-auto')!;
        assert.match(ctx.textContent!, /Ana López/);
        assert.match(ctx.textContent!, /Cliente Uno/);
        assert.match(ctx.textContent!, /GASAS/);
    });

    test('se autoguarda al escribir, sin sellar', () => {
        abrir();
        const select = $<HTMLSelectElement>('.modal select')!;
        act(() => { fireEvent.change(select, { target: { value: 'Capacitación' } }); });

        const nombre = $$('.modal input[type="text"]')[0] as HTMLInputElement;
        act(() => { fireEvent.change(nombre, { target: { value: 'Dr. Pérez' } }); });

        const act1 = actividadDe();
        assert.equal(act1.contacto?.nombre, 'Dr. Pérez');
        assert.equal(act1.guardada, undefined, 'autoguardar no es registrar');
    });
});

describe('guardar', () => {
    test('faltando datos, NO sella y marca los campos', () => {
        abrir();
        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Capacitación' } });
        });

        act(() => { boton('Guardar actividad')!.click(); });

        assert.equal(actividadDe().guardada, undefined, 'no debe sellarse');
        assert.ok($('.es-error'), 'los campos en falta deben marcarse');
        assert.ok(avisos.some(a => /Falta/.test(a)));
    });

    test('el aviso dice CUÁNTOS faltan', () => {
        abrir();
        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Capacitación' } });
        });
        act(() => { boton('Guardar actividad')!.click(); });

        assert.ok(avisos.some(a => /Faltan 2 datos/.test(a)));
    });

    test('con todo completo, sella con quién y cuándo', () => {
        abrir();
        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Capacitación' } });
        });

        const selects = $$('.modal select') as HTMLSelectElement[];
        act(() => { fireEvent.change(selects[1]!, { target: { value: 'Área Usuaria' } }); });
        act(() => {
            fireEvent.change($$('.modal input[type="text"]')[0] as HTMLInputElement,
                { target: { value: 'Dr. Pérez' } });
        });

        act(() => { boton('Guardar actividad')!.click(); });

        const guardada = actividadDe();
        assert.ok(guardada.guardada, 'debe quedar sellada');
        assert.equal(guardada.guardada!.usuario, 'Ana López');
        assert.ok(guardada.guardada!.momento);
    });

    test('una evidencia obligatoria NO impide guardar', () => {
        abrir();
        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Capacitación' } });
        });
        const selects = $$('.modal select') as HTMLSelectElement[];
        act(() => { fireEvent.change(selects[1]!, { target: { value: 'Área Usuaria' } }); });
        act(() => {
            fireEvent.change($$('.modal input[type="text"]')[0] as HTMLInputElement,
                { target: { value: 'Dr. Pérez' } });
        });

        act(() => { boton('Guardar actividad')!.click(); });

        assert.ok(actividadDe().guardada,
            'la evidencia es deuda, no requisito: se salda cuando haya señal');
        assert.notEqual(actividadDe().evidencia?.estado, 'subida');
    });
});

describe('actividad sellada — inmutable', () => {
    function conActividadSellada() {
        const v = visitaBase();
        v.sectores![0]!.actividades = [{
            id: 'a-1', tipo: 'Capacitación', area_visitada: 'Área Usuaria',
            guardada: { momento: '2026-07-15T10:00:00.000Z', usuario: 'Ana López' },
            contacto: { nombre: 'Dr. Pérez', cargo: 'Jefe' },
            materiales: [{ id: 'm-1', material: 'GASA SIMPLE 10X10', cantidad: '5', unidad: 'Pieza' }],
            evidencia: { estado: 'subida', url: 'https://x/1', nombre: 'foto.jpg' }
        }];
        guardarVisitas([v]);
        abrir('a-1');
    }

    test('no hay formulario: los datos van en frío', () => {
        conActividadSellada();

        assert.equal($('.modal select'), null,
            'un campo que se reescribe en silencio no prueba nada');
        assert.equal(boton('Guardar actividad'), undefined);
        assert.ok(boton('Listo'));
    });

    test('muestra el sello con quién y cuándo', () => {
        conActividadSellada();

        const sello = $('.sello.es-guardada')!;
        assert.match(sello.textContent!, /Guardada el/);
        assert.match(sello.textContent!, /Ana López/);
    });

    test('un sello MIGRADO no finge una firma que nunca existió', () => {
        const v = visitaBase();
        v.sectores![0]!.actividades = [{
            id: 'a-1', tipo: 'Capacitación',
            guardada: { momento: 'x', usuario: 'Ana', migrada: true }
        }];
        guardarVisitas([v]);
        abrir('a-1');

        assert.match($('.sello.es-guardada')!.textContent!, /antes de que existiera el guardado/);
    });

    test('los materiales se ven, pero ya no se quitan', () => {
        conActividadSellada();

        assert.match(document.body.textContent!, /GASA SIMPLE 10X10/);
        assert.equal($$('.mat-fila .icon-btn').length, 0,
            'sellada la actividad, el material es parte del hecho');
    });

    test('la evidencia SIGUE viva: respalda el hecho, no lo cambia', () => {
        conActividadSellada();
        assert.match(document.body.textContent!, /Evidencia/);
    });
});

describe('descartar', () => {
    test('un borrador vacío se descarta al cerrar SIN preguntar', () => {
        const confirmaciones: string[] = [];
        vi.stubGlobal('confirm', (m: string) => { confirmaciones.push(m); return true; });

        abrir();
        act(() => { $<HTMLButtonElement>('.icon-btn[aria-label="Cerrar"]')!.click(); });

        assert.deepEqual(confirmaciones, [],
            'un botón presionado por error no es una captura a medias');
        assert.equal(repo.obtenerVisita('v-1')!.sectores![0]!.actividades!.length, 0);
    });

    test('un borrador CON datos sí pregunta antes de descartar', () => {
        vi.stubGlobal('confirm', () => false);

        abrir();
        act(() => {
            fireEvent.change($<HTMLSelectElement>('.modal select')!, { target: { value: 'Capacitación' } });
        });

        act(() => { boton('Descartar')!.click(); });

        assert.equal(repo.obtenerVisita('v-1')!.sectores![0]!.actividades!.length, 1,
            'al decir que no, la captura se conserva');
    });
});
