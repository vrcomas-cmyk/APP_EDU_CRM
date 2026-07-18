/**
 * Lógica de dominio del módulo de visitas, extraída de drawer.js.
 *
 * Estas reglas estaban dentro de un archivo de 1,390 líneas que dibujaba DOM, así que no había
 * forma de probarlas sin un navegador. Sacarlas es la mitad del valor del port; la otra mitad
 * es que ahora fallan aquí en vez de en el teléfono de alguien.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    faltaParaGuardar, sePuedeGuardar, tieneCapturaPerdible, CAMPOS_REQUERIDOS
} from '@modules/visitas/validators/requisitos';

import {
    horaAMinutos, minutosAHora, sumarMinutos, duracionMinutos, moverInicio, cambiarFin
} from '@modules/visitas/services/horario';

import {
    nuevaVisita, duplicarVisita, selloDeGuardado, sellarVisita
} from '@modules/visitas/services/fabricas';

import type { Visita, Sesion } from '@core/tipos';

/** Ids deterministas: las pruebas comparan estructura, no aleatoriedad. */
function contadorDeIds() {
    let n = 0;
    return (prefijo: string) => `${prefijo}-${++n}`;
}

const sesion: Sesion = { correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x' };

const completa = (campos: Partial<Visita> = {}): Visita => ({
    id: 'v-1',
    educador: 'Ana López',
    cliente: 'Cliente Uno',
    hospital: 'Hospital General',
    dia: '2026-07-15',
    hora_inicio: '09:00',
    hora_fin: '11:00',
    sectores: [{ id: 's-1', nombre: 'GASAS' }],
    ...campos
});

describe('faltaParaGuardar', () => {
    test('una visita completa no debe nada', () => {
        assert.deepEqual(faltaParaGuardar(completa()), []);
        assert.equal(sePuedeGuardar(completa()), true);
    });

    test('una visita vacía enumera los siete requisitos', () => {
        assert.deepEqual(faltaParaGuardar({ id: 'v' }), [...CAMPOS_REQUERIDOS]);
    });

    test('los espacios en blanco no llenan un campo', () => {
        assert.deepEqual(faltaParaGuardar(completa({ cliente: '   ' })), ['Cliente']);
    });

    test('sin sectores no se puede guardar, aunque todo lo demás esté', () => {
        assert.deepEqual(faltaParaGuardar(completa({ sectores: [] })), ['Al menos un sector']);
        assert.deepEqual(faltaParaGuardar(completa({ sectores: undefined })), ['Al menos un sector']);
    });

    test('el orden sigue al del formulario, porque se lee tal cual en el pie', () => {
        const falta = faltaParaGuardar(completa({ cliente: '', dia: '', sectores: [] }));
        assert.deepEqual(falta, ['Cliente', 'Fecha', 'Al menos un sector'],
            'una lista que salta de arriba abajo obliga a buscar cada cosa');
    });

    test('una hora vacía cuenta como faltante', () => {
        assert.deepEqual(faltaParaGuardar(completa({ hora_fin: '' })), ['Hora de término']);
    });
});

describe('tieneCapturaPerdible', () => {
    test('un formulario recién abierto no pregunta al cerrar', () => {
        const recien = nuevaVisita({}, sesion, contadorDeIds());
        assert.equal(tieneCapturaPerdible(recien), false,
            'pedir confirmación sobre un formulario vacío enseña a decir que sí sin leer');
    });

    test('el educador solo no cuenta: viene de la sesión, no lo escribió nadie', () => {
        assert.equal(tieneCapturaPerdible({ id: 'v', educador: 'Ana López' }), false);
    });

    test('cualquier campo capturado sí cuenta', () => {
        assert.equal(tieneCapturaPerdible({ id: 'v', cliente: 'C' }), true);
        assert.equal(tieneCapturaPerdible({ id: 'v', hospital: 'H' }), true);
        assert.equal(tieneCapturaPerdible({ id: 'v', dia: '2026-07-15' }), true);
        assert.equal(tieneCapturaPerdible({ id: 'v', sectores: [{ id: 's', nombre: 'GASAS' }] }), true);
    });
});

describe('horario', () => {
    test('una hora vacía vale 0, no NaN', () => {
        assert.equal(horaAMinutos(''), 0);
        assert.equal(horaAMinutos(undefined), 0);
        assert.ok(Number.isFinite(horaAMinutos('')),
            'un NaN aquí se propagaría a comparaciones que siempre dan falso');
    });

    test('ida y vuelta', () => {
        assert.equal(horaAMinutos('09:30'), 570);
        assert.equal(minutosAHora(570), '09:30');
        assert.equal(sumarMinutos('09:00', 90), '10:30');
    });

    test('no salta de día: topa en 23:59', () => {
        assert.equal(sumarMinutos('23:00', 120), '23:59');
        assert.equal(minutosAHora(-30), '00:00');
    });

    test('duracionMinutos distingue "no sé" de "cero"', () => {
        assert.equal(duracionMinutos('09:00', '11:00'), 120);
        assert.equal(duracionMinutos('09:00', undefined), null);
        assert.equal(duracionMinutos('11:00', '09:00'), null, 'un rango invertido no tiene duración');
        assert.equal(duracionMinutos('09:00', '09:00'), null);
    });

    test('mover el inicio MUEVE el bloque, no lo estira', () => {
        assert.deepEqual(
            moverInicio({ hora_inicio: '09:00', hora_fin: '11:00' }, '11:00'),
            { hora_inicio: '11:00', hora_fin: '13:00' },
            'reagendar corre la visita conservando su duración'
        );
    });

    test('sin duración previa se usa una hora', () => {
        assert.deepEqual(
            moverInicio({}, '08:00'),
            { hora_inicio: '08:00', hora_fin: '09:00' }
        );
    });

    test('mover el inicio cerca de medianoche no invierte el rango', () => {
        const r = moverInicio({ hora_inicio: '09:00', hora_fin: '12:00' }, '23:00');
        assert.equal(r.hora_fin, '23:59');
        assert.ok(horaAMinutos(r.hora_fin) > horaAMinutos(r.hora_inicio));
    });

    test('cambiarFin rechaza en vez de corregir en silencio', () => {
        const r = cambiarFin('09:00', '08:00');
        assert.equal(r.ok, false);
        assert.ok(!r.ok && /posterior al inicio/.test(r.error),
            'mover la hora que el usuario no tocó produce un horario que nadie eligió');
    });

    test('cambiarFin rechaza el fin igual al inicio', () => {
        assert.equal(cambiarFin('09:00', '09:00').ok, false);
    });

    test('cambiarFin acepta un fin posterior', () => {
        const r = cambiarFin('09:00', '10:30');
        assert.equal(r.ok, true);
        assert.equal(r.ok && r.hora_fin, '10:30');
    });

    test('con inicio vacío, cualquier fin real se acepta', () => {
        assert.equal(cambiarFin('', '09:00').ok, true,
            'todavía se está capturando: no hay contra qué validar');
    });

    test('un fin vacío se rechaza', () => {
        assert.equal(cambiarFin('09:00', '').ok, false);
    });
});

describe('nuevaVisita', () => {
    test('nace como borrador, con fecha y horario VACÍOS', () => {
        const v = nuevaVisita({}, sesion, contadorDeIds());

        assert.equal(v.borrador, true);
        assert.equal(v.dia, '');
        assert.equal(v.hora_inicio, '');
        assert.equal(v.hora_fin, '',
            'un horario prellenado se acepta sin leerlo y ensucia el calendario');
    });

    test('toma al educador de la sesión, no de un campo', () => {
        const v = nuevaVisita({}, sesion, contadorDeIds());
        assert.equal(v.educador, 'Ana López');
        assert.equal(v.educador_correo, 'ana@x.com');
    });

    test('sin sesión no inventa un educador', () => {
        const v = nuevaVisita({}, null, contadorDeIds());
        assert.equal(v.educador, '');
        assert.equal(v.educador_correo, '');
    });

    test('lo arrastrado en el calendario SÍ llega puesto', () => {
        const v = nuevaVisita(
            { dia: '2026-07-20', hora_inicio: '10:00', hora_fin: '12:00' },
            sesion, contadorDeIds()
        );

        assert.equal(v.dia, '2026-07-20');
        assert.equal(v.hora_inicio, '10:00',
            'el gesto ya eligió: no es un valor por defecto, es lo que se acaba de señalar');
    });

    test('nace sin sincronizar y sin sectores', () => {
        const v = nuevaVisita({}, sesion, contadorDeIds());
        assert.equal(v.sincronizado, false);
        assert.deepEqual(v.sectores, []);
        assert.equal(v.estado, 'programada');
    });
});

describe('duplicarVisita', () => {
    const original: Visita = {
        id: 'v-original',
        educador: 'Beto Ruiz',
        educador_correo: 'beto@x.com',
        cliente: 'Cliente Uno',
        hospital: 'Hospital General',
        dia: '2026-07-15',
        hora_inicio: '09:00',
        hora_fin: '11:00',
        estado: 'finalizada',
        check_in: { momento: '2026-07-15T09:05:00.000Z', usuario: 'Beto' },
        check_out: { momento: '2026-07-15T11:00:00.000Z', usuario: 'Beto' },
        reagendas: [{
            momento: 'x', motivo: 'lluvia',
            antes: { dia: 'a', hora_inicio: 'a', hora_fin: 'a' },
            despues: { dia: 'b', hora_inicio: 'b', hora_fin: 'b' }
        }],
        sectores: [{
            id: 's-original',
            nombre: 'GASAS',
            objetivo: 'Revisar rotación',
            origen: ['BI'],
            solicitado_por: 'Gerencia',
            guardado: { momento: 'x', usuario: 'Beto' },
            actividades: [{ id: 'a-1', tipo: 'Capacitación', guardada: { momento: 'x' } }]
        }]
    };

    test('copia la plantilla de trabajo', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());

        assert.equal(copia.cliente, 'Cliente Uno');
        assert.equal(copia.hospital, 'Hospital General');
        assert.equal(copia.sectores?.[0]?.nombre, 'GASAS');
        assert.equal(copia.sectores?.[0]?.objetivo, 'Revisar rotación');
        assert.deepEqual(copia.sectores?.[0]?.origen, ['BI']);
        assert.equal(copia.sectores?.[0]?.solicitado_por, 'Gerencia');
    });

    test('NO copia lo que pasó en sitio', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());

        assert.equal(copia.check_in, undefined);
        assert.equal(copia.check_out, undefined);
        assert.deepEqual(copia.sectores?.[0]?.actividades, [],
            'arrastrar actividades fabricaría un hecho que no ocurrió, con evidencia y todo');
        assert.deepEqual(copia.reagendas, []);
        assert.equal(copia.estado, 'programada');
        assert.equal(copia.borrador, true);
    });

    test('el sector copiado NO conserva su sello', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());
        assert.equal(copia.sectores?.[0]?.guardado, undefined,
            'la copia es un borrador: sus sectores todavía se corrigen');
    });

    test('los ids son nuevos, en la visita y en cada sector', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());

        assert.notEqual(copia.id, original.id);
        assert.notEqual(copia.sectores?.[0]?.id, 's-original',
            'reusar el id haría que un comentario en una apareciera en la otra');
    });

    test('el educador es quien duplica, no quien hizo la original', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());
        assert.equal(copia.educador, 'Ana López');
        assert.equal(copia.educador_correo, 'ana@x.com');
    });

    test('sin sesión conserva al educador original en vez de dejarlo vacío', () => {
        const copia = duplicarVisita(original, null, contadorDeIds());
        assert.equal(copia.educador, 'Beto Ruiz');
    });

    test('el original no se modifica', () => {
        const antes = JSON.stringify(original);
        duplicarVisita(original, sesion, contadorDeIds());
        assert.equal(JSON.stringify(original), antes);
    });

    test('mutar la copia no toca al original', () => {
        const copia = duplicarVisita(original, sesion, contadorDeIds());
        copia.sectores?.[0]?.origen?.push('CONTAMINADO');

        assert.deepEqual(original.sectores?.[0]?.origen, ['BI'],
            'un origen compartido por referencia se editaría en las dos visitas');
    });
});

describe('sellarVisita', () => {
    test('quita el borrador y sella los sectores sin sello', () => {
        const v = completa({ borrador: true, sectores: [{ id: 's-1', nombre: 'GASAS' }] });
        const sello = selloDeGuardado(sesion, new Date('2026-07-15T10:00:00.000Z'));

        sellarVisita(v, sello);

        assert.equal(v.borrador, undefined);
        assert.equal(v.sectores?.[0]?.guardado?.momento, '2026-07-15T10:00:00.000Z');
        assert.equal(v.sectores?.[0]?.guardado?.usuario, 'Ana López');
    });

    test('NO reescribe el sello de un sector que ya lo tenía', () => {
        const previo = { momento: '2026-01-01T00:00:00.000Z', usuario: 'Beto Ruiz' };
        const v = completa({
            sectores: [
                { id: 's-viejo', nombre: 'GASAS', guardado: previo },
                { id: 's-nuevo', nombre: 'GUANTES' }
            ]
        });

        sellarVisita(v, selloDeGuardado(sesion, new Date('2026-07-15T10:00:00.000Z')));

        assert.deepEqual(v.sectores?.[0]?.guardado, previo,
            'reestampar reescribiría la fecha en que de verdad se registró');
        assert.equal(v.sectores?.[1]?.guardado?.momento, '2026-07-15T10:00:00.000Z');
    });

    test('una visita sin sectores no revienta', () => {
        const v = completa({ borrador: true, sectores: undefined });
        assert.doesNotThrow(() => sellarVisita(v, selloDeGuardado(sesion)));
        assert.equal(v.borrador, undefined);
    });

    test('sin sesión el sello no inventa un usuario', () => {
        assert.equal(selloDeGuardado(null).usuario, '');
    });
});
