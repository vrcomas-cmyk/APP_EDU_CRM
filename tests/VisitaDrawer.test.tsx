/**
 * @vitest-environment happy-dom
 *
 * El drawer, renderizado de verdad.
 *
 * Hasta esta iteración el drawer era 1,390 líneas que construían DOM a mano, y no había forma
 * de ejercitarlo sin un navegador: cada reporte sobre él terminaba en "no pude verificarlo
 * visualmente". Estas pruebas no sustituyen mirar la pantalla —no dicen nada de si se ve
 * bien— pero sí comprueban lo que antes solo se podía afirmar: que las reglas de captura,
 * bloqueo e inmutabilidad se cumplen contra un DOM real.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { VisitaDrawer } from '@modules/visitas/components/VisitaDrawer';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Visita } from '@core/tipos';

import { guardarVisitas, guardarCatalogo } from '../js/storage.js';

const nada = () => {};

function montar(visita: Visita, props: Partial<React.ComponentProps<typeof VisitaDrawer>> = {}) {
    guardarVisitas([visita]);
    return render(
        <VisitaDrawer
            visitaId={visita.id}
            avisar={props.avisar ?? nada}
            alCambiar={props.alCambiar ?? nada}
            onCerrar={props.onCerrar ?? nada}
            abrirVentanaSector={props.abrirVentanaSector ?? nada}
            abrirVentanaActividad={props.abrirVentanaActividad ?? nada}
            abrirOtraVisita={props.abrirOtraVisita ?? nada}
        />
    );
}

const borrador = (campos: Partial<Visita> = {}): Visita => ({
    id: 'v-borrador',
    educador: 'Ana López',
    educador_correo: 'ana@x.com',
    cliente: '', hospital: '', dia: '', hora_inicio: '', hora_fin: '',
    estado: 'programada',
    reagendas: [], sectores: [],
    sincronizado: false,
    borrador: true,
    ...campos
});

const guardada = (campos: Partial<Visita> = {}): Visita => ({
    id: 'v-guardada',
    educador: 'Ana López',
    educador_correo: 'ana@x.com',
    cliente: 'Cliente Uno',
    hospital: 'Hospital General',
    dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '11:00',
    estado: 'programada',
    reagendas: [],
    sectores: [{
        id: 's-1', nombre: 'GASAS', objetivo: 'Revisar rotación',
        origen: ['BI'], solicitado_por: 'Gerencia',
        guardado: { momento: '2026-07-15T09:00:00.000Z', usuario: 'Ana López' },
        actividades: []
    }],
    sincronizado: false,
    ...campos
});

beforeEach(() => {
    localStorage.clear();
    guardarCatalogo({ clientes: ['Cliente Uno', 'Cliente Dos'], sectores: ['GASAS'] });
});

afterEach(cleanup);

describe('borrador — nada existe hasta guardar', () => {
    test('el botón Guardar nace deshabilitado', () => {
        montar(borrador());

        const boton = screen.getByRole('button', { name: 'Guardar visita' });
        assert.equal((boton as HTMLButtonElement).disabled, true);
    });

    test('dice EXACTAMENTE qué falta, en vez de quedarse gris sin explicar', () => {
        montar(borrador());

        const pista = document.querySelector('.pista');
        assert.ok(pista);
        assert.match(pista.textContent!, /Cliente/);
        assert.match(pista.textContent!, /Hospital/);
        assert.match(pista.textContent!, /Al menos un sector/);
    });

    test('fecha y horario nacen VACÍOS', () => {
        montar(borrador());

        const fecha = document.querySelector<HTMLInputElement>('input[type="date"]');
        const inicio = document.querySelector<HTMLInputElement>('input[aria-label="Hora de inicio"]');

        assert.equal(fecha?.value, '', 'un horario prellenado se acepta sin leerlo');
        assert.equal(inicio?.value, '');
    });

    test('con todo completo, Guardar se habilita', () => {
        montar(borrador({
            cliente: 'Cliente Uno', hospital: 'Hospital General',
            dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '11:00',
            sectores: [{ id: 's-1', nombre: 'GASAS' }]
        }));

        const boton = screen.getByRole('button', { name: 'Guardar visita' });
        assert.equal((boton as HTMLButtonElement).disabled, false);
        assert.match(document.querySelector('.pista')!.textContent!, /Listo para guardar/);
    });

    test('guardar quita el borrador y SELLA los sectores', () => {
        const v = borrador({
            cliente: 'Cliente Uno', hospital: 'Hospital General',
            dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '11:00',
            sectores: [{ id: 's-1', nombre: 'GASAS' }]
        });
        montar(v);

        fireEvent.click(screen.getByRole('button', { name: 'Guardar visita' }));

        const enDisco = repo.obtenerVisita(v.id)!;
        assert.equal(enDisco.borrador, undefined, 'ya es una visita real');
        assert.ok(enDisco.sectores?.[0]?.guardado,
            'sus sectores quedan registrados en el mismo acto y dejan de editarse');
    });

    test('el educador se muestra como DATO, no como campo escribible', () => {
        montar(borrador());

        const etiquetas = [...document.querySelectorAll('.campo-lbl')].map(e => e.textContent);
        assert.ok(etiquetas.includes('Educador'));

        const escribibles = [...document.querySelectorAll('input')]
            .filter(i => (i.value || '').includes('Ana López'));
        assert.equal(escribibles.length, 0,
            'dejar escribir aquí permitiría registrar una visita a nombre de otra persona');
    });

    test('escribir el cliente lo persiste sin convertirlo en visita', () => {
        const v = borrador();
        montar(v);

        const inputs = [...document.querySelectorAll<HTMLInputElement>('input.inp')];
        const cliente = inputs.find(i => i.placeholder?.includes('razón social'))!;
        fireEvent.change(cliente, { target: { value: 'Cliente Dos' } });

        const enDisco = repo.obtenerVisita(v.id)!;
        assert.equal(enDisco.cliente, 'Cliente Dos');
        assert.equal(enDisco.borrador, true,
            'el autoguardado es una red contra perder lo escrito, no un registro');
    });

    test('mover el inicio MUEVE el bloque conservando la duración', () => {
        const v = borrador({ hora_inicio: '09:00', hora_fin: '11:00' });
        montar(v);

        const inicio = document.querySelector<HTMLInputElement>('input[aria-label="Hora de inicio"]')!;
        fireEvent.change(inicio, { target: { value: '13:00' } });

        const enDisco = repo.obtenerVisita(v.id)!;
        assert.equal(enDisco.hora_inicio, '13:00');
        assert.equal(enDisco.hora_fin, '15:00', 'reagendar corre la visita, no la estira');
    });

    test('un fin anterior al inicio se rechaza y avisa, sin corregir en silencio', () => {
        const avisos: string[] = [];
        const v = borrador({ hora_inicio: '09:00', hora_fin: '11:00' });
        montar(v, { avisar: (m) => { avisos.push(m); } });

        const fin = document.querySelector<HTMLInputElement>('input[aria-label="Hora de fin"]')!;
        fireEvent.change(fin, { target: { value: '08:00' } });

        assert.ok(avisos.some(a => /posterior al inicio/.test(a)));
        assert.equal(repo.obtenerVisita(v.id)!.hora_fin, '11:00', 'no se tocó el dato');
    });

    test('cerrar un borrador vacío NO pregunta y lo descarta', () => {
        const confirmar = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmar);

        const v = borrador();
        let cerrado = false;
        montar(v, { onCerrar: () => { cerrado = true; } });

        fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

        assert.equal(confirmar.mock.calls.length, 0,
            'confirmar sobre un formulario vacío enseña a decir que sí sin leer');
        assert.equal(cerrado, true);
        assert.equal(repo.obtenerVisita(v.id), null, 'una visita a medias no colgaría de nada');

        vi.unstubAllGlobals();
    });

    test('cerrar un borrador CON captura sí pregunta, y respeta el "no"', () => {
        vi.stubGlobal('confirm', () => false);

        const v = borrador({ cliente: 'Cliente Uno' });
        let cerrado = false;
        montar(v, { onCerrar: () => { cerrado = true; } });

        fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));

        assert.equal(cerrado, false);
        assert.ok(repo.obtenerVisita(v.id), 'un clic de más no debe costar la captura');

        vi.unstubAllGlobals();
    });
});

describe('visita guardada — inmutable, con acciones', () => {
    test('no hay formulario: los datos se muestran en frío', () => {
        montar(guardada());

        assert.ok(document.querySelector('.panel-info'));
        assert.equal(document.querySelector('input[type="date"]'), null,
            'cambiarlos en silencio la convertiría en otra visita conservando su historial');
    });

    test('avisa de que esos datos no se editan', () => {
        montar(guardada());
        assert.match(document.body.textContent!, /no se editan/);
    });

    test('ofrece iniciar la visita cuando aún no hay check-in', () => {
        montar(guardada());
        assert.ok(screen.getByRole('button', { name: /Iniciar visita/ }));
    });

    test('con check-in ofrece finalizar, no volver a iniciar', () => {
        montar(guardada({
            estado: 'en-proceso',
            check_in: { momento: '2026-07-15T09:05:00.000Z', usuario: 'Ana López' }
        }));

        assert.ok(screen.getByRole('button', { name: /Finalizar visita/ }));
        assert.equal(screen.queryByRole('button', { name: /Iniciar visita/ }), null);
    });

    test('una cancelada no ofrece reagendar ni cancelar, pero sí reactivar', () => {
        montar(guardada({ estado: 'cancelada', motivo_cancelacion: 'Cliente no disponible' }));

        assert.ok(screen.getByRole('button', { name: 'Reactivar' }));
        assert.equal(screen.queryByRole('button', { name: /Reagendar/ }), null);
        assert.match(document.body.textContent!, /Cliente no disponible/);
    });

    test('con check-out ya no se puede reagendar: la visita ocurrió', () => {
        montar(guardada({
            estado: 'finalizada',
            check_in: { momento: '2026-07-15T09:05:00.000Z' },
            check_out: { momento: '2026-07-15T11:00:00.000Z' }
        }));

        assert.equal(screen.queryByRole('button', { name: /Reagendar/ }), null,
            'moverla reescribiría un hecho');
        assert.equal(screen.queryByRole('button', { name: /Cancelar/ }), null);
    });

    test('entrar a un sector muestra sus datos sellados', () => {
        montar(guardada());

        fireEvent.click(document.querySelector('.sector-card')!);

        assert.match(document.body.textContent!, /Sector registrado/);
        assert.match(document.body.textContent!, /Revisar rotación/);
        assert.match(document.body.textContent!, /no se editan/);
    });

    test('sin check-in NO se pueden registrar actividades, y se dice por qué', () => {
        montar(guardada());
        fireEvent.click(document.querySelector('.sector-card')!);

        assert.equal(screen.queryByRole('button', { name: /Registrar actividad/ }), null);
        assert.match(document.querySelector('.actividades .aviso')!.textContent!,
            /Inicia la visita/,
            'un botón muerto sin motivo se lee como que la app está rota');
    });

    test('con check-in sí aparece el botón de registrar', () => {
        montar(guardada({
            estado: 'en-proceso',
            check_in: { momento: '2026-07-15T09:05:00.000Z', usuario: 'Ana López' }
        }));
        fireEvent.click(document.querySelector('.sector-card')!);

        assert.ok(screen.getByRole('button', { name: /Registrar actividad/ }));
    });

    test('una cancelada tampoco deja registrar, aunque tenga check-in', () => {
        montar(guardada({
            estado: 'cancelada',
            check_in: { momento: '2026-07-15T09:05:00.000Z' }
        }));
        fireEvent.click(document.querySelector('.sector-card')!);

        assert.equal(screen.queryByRole('button', { name: /Registrar actividad/ }), null);
        assert.match(document.querySelector('.actividades .aviso')!.textContent!, /cancelada/);
    });

    test('desde el sector se vuelve a la visita sin cerrarla', () => {
        let cerrado = false;
        montar(guardada(), { onCerrar: () => { cerrado = true; } });

        fireEvent.click(document.querySelector('.sector-card')!);
        // Hay dos salidas al mismo sitio: la flecha de la cabecera y el botón del pie. Se
        // usa la del pie; ambas existían igual en el drawer anterior.
        fireEvent.click(document.querySelector('.drawer-foot .btn')!);

        assert.ok(document.querySelector('.panel-info'));
        assert.equal(cerrado, false);
    });

    test('en una visita guardada, tocar el sector NO abre la ventana de edición', () => {
        const abiertas: unknown[] = [];
        montar(guardada(), { abrirVentanaSector: (id) => abiertas.push(id) });

        fireEvent.click(document.querySelector('.sector-card')!);

        assert.deepEqual(abiertas, [],
            'ya guardada, entrar al sector es entrar a sus actividades: no hay nada que editar');
    });

    test('en un BORRADOR, tocar el sector sí abre su ventana para corregirlo', () => {
        const abiertas: unknown[] = [];
        montar(
            borrador({ sectores: [{ id: 's-9', nombre: 'GASAS' }] }),
            { abrirVentanaSector: (id) => abiertas.push(id) }
        );

        fireEvent.click(document.querySelector('.sector-card')!);
        assert.deepEqual(abiertas, ['s-9']);
    });

    test('duplicar copia la estructura y abre la copia como borrador', () => {
        const original = guardada({
            check_in: { momento: '2026-07-15T09:05:00.000Z' },
            estado: 'en-proceso'
        });
        let abierta: string | null = null;
        montar(original, { abrirOtraVisita: (id) => { abierta = id; } });

        fireEvent.click(screen.getByRole('button', { name: /Duplicar/ }));

        assert.ok(abierta);
        const copia = repo.obtenerVisita(abierta!)!;
        assert.equal(copia.borrador, true);
        assert.equal(copia.hospital, 'Hospital General');
        assert.equal(copia.check_in, undefined, 'lo que pasó en sitio no se copia');
        assert.equal(copia.sectores?.[0]?.guardado, undefined);
    });
});

describe('contadores del sector', () => {
    test('separa borradores, materiales y evidencias pendientes', () => {
        montar(guardada({
            sectores: [{
                id: 's-1', nombre: 'GASAS',
                guardado: { momento: 'x' },
                actividades: [
                    { id: 'a-1', tipo: 'Capacitación', guardada: { momento: 'x' },
                      evidencia: { estado: 'subida', url: 'u' },
                      materiales: [{ id: 'm', material: 'GASA' }] },
                    { id: 'a-2', tipo: 'Capacitación', guardada: { momento: 'x' },
                      evidencia: { estado: 'local' } },
                    { id: 'a-3', tipo: 'Capacitación' }
                ]
            }]
        }));

        const meta = document.querySelector('.sector-card-meta')!.textContent!;
        assert.match(meta, /3 actividades/);
        assert.match(meta, /1 material/);
        assert.match(meta, /1 sin guardar/);
        assert.match(meta, /1 evid\./,
            'solo a-2 debe deber evidencia: a-1 ya la subió y a-3 es un borrador');
    });

    test('un BORRADOR no genera deuda de evidencia', () => {
        // Corrige una contradicción del drawer anterior: la tarjeta contaba los borradores
        // como deuda y el contador global de la barra no, así que los dos números no
        // coincidían. Manda la regla del global: no se puede pedir la foto de algo que
        // todavía se está escribiendo.
        montar(guardada({
            sectores: [{
                id: 's-1', nombre: 'GASAS',
                guardado: { momento: 'x' },
                actividades: [{ id: 'a-1', tipo: 'Capacitación' }]
            }]
        }));

        const meta = document.querySelector('.sector-card-meta')!.textContent!;
        assert.match(meta, /1 sin guardar/, 'el borrador sí se señala, con su propia pastilla');
        assert.ok(!/evid\./.test(meta), 'pero no como deuda imposible de saldar');
    });
});
