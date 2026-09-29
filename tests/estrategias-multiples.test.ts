/**
 * Una visita puede avanzar VARIAS estrategias, y solo las que se trabajaron suman avance.
 * Ver `src/modules/estrategias/services/vinculo.ts`.
 */

import { describe, test } from 'vitest';
import assert from 'node:assert/strict';

import { nuevaVisita } from '@modules/visitas/services/fabricas';
import {
    idsEstrategiasDe, fijarEstrategias, aplicarSeleccion, estrategiasTrabajadas
} from '@modules/estrategias/services/vinculo';
import type { Estrategia, Sector, Visita } from '@core/tipos';

const nuevoId = (() => { let n = 0; return (p: string) => `${p}-${++n}`; })();
const sesion = { correo: 'edu@degasa.com', nombre: 'Edu', id_token: 'x' } as never;

const e = (id: string, sector: string, grupo?: string): Estrategia =>
    ({ id, cliente: 'Hospital Central', sector, grupo_articulo: grupo });

const sectorConActividad = (nombre: string, materiales: string[] = [], guardada = true): Sector => ({
    id: `s-${nombre}`, nombre, programado: true,
    actividades: [{
        id: `a-${nombre}`,
        ...(guardada ? { guardada: { momento: '2026-09-04T10:00:00.000Z', usuario: 'Edu' } } : {}),
        materiales: materiales.map((m, i) => ({ id: `m${i}`, material: m }))
    }]
});

describe('modelo', () => {
    test('nuevaVisita con 3 estrategias guarda todas y deja id_estrategia = la primera', () => {
        const v = nuevaVisita({ cliente: 'H', ids_estrategias: ['a', 'b', 'c'], sectorNombres: ['GASAS'] }, sesion, nuevoId);
        assert.deepEqual(v.ids_estrategias, ['a', 'b', 'c']);
        assert.equal(v.id_estrategia, 'a');
    });

    test('con solo id_estrategia (forma vieja) tambien queda en el arreglo', () => {
        const v = nuevaVisita({ cliente: 'H', id_estrategia: 'x' }, sesion, nuevoId);
        assert.deepEqual(idsEstrategiasDe(v), ['x']);
    });

    test('sin estrategias no inventa campos', () => {
        const v = nuevaVisita({ cliente: 'H' }, sesion, nuevoId);
        assert.equal(v.id_estrategia, undefined);
        assert.equal('ids_estrategias' in v, false);
    });

    test('idsEstrategiasDe entiende visita vieja, nueva y vacia', () => {
        assert.deepEqual(idsEstrategiasDe({ id_estrategia: 'a' }), ['a']);
        assert.deepEqual(idsEstrategiasDe({ id_estrategia: 'a', ids_estrategias: ['a', 'b'] }), ['a', 'b']);
        assert.deepEqual(idsEstrategiasDe({}), []);
    });

    test('fijarEstrategias sincroniza el arreglo con la primera y limpia al vaciar', () => {
        const v: Partial<Visita> = {};
        fijarEstrategias(v, ['b', 'a', 'b']);
        assert.deepEqual(v.ids_estrategias, ['b', 'a']);
        assert.equal(v.id_estrategia, 'b');
        fijarEstrategias(v, []);
        assert.equal(v.ids_estrategias, undefined);
        assert.equal(v.id_estrategia, undefined);
    });
});

describe('aplicarSeleccion (desde el calendario)', () => {
    const cliente = [e('g', 'GASAS', 'Compresas'), e('t', 'GASAS', 'Torundas'), e('s', 'SUTURAS', 'Seda')];

    test('marcar agrega el sector, sin duplicarlo si dos estrategias comparten sector', () => {
        const v: Partial<Visita> = { sectores: [] };
        aplicarSeleccion(v as never, cliente, ['g', 't', 's'], nuevoId);
        assert.deepEqual(v.sectores!.map(s => s.nombre).sort(), ['GASAS', 'SUTURAS']);
        assert.ok(v.sectores!.every(s => s.programado === true));
        assert.deepEqual(v.ids_estrategias, ['g', 't', 's']);
    });

    test('desmarcar quita el sector programado sin actividades', () => {
        const v: Partial<Visita> = { sectores: [] };
        aplicarSeleccion(v as never, cliente, ['g', 's'], nuevoId);
        aplicarSeleccion(v as never, cliente, ['g'], nuevoId);
        assert.deepEqual(v.sectores!.map(s => s.nombre), ['GASAS']);
    });

    test('desmarcar NO quita un sector con actividades ni uno agregado a mano', () => {
        const conTrabajo: Partial<Visita> = {
            sectores: [sectorConActividad('SUTURAS')], ids_estrategias: ['s'], id_estrategia: 's'
        };
        aplicarSeleccion(conTrabajo as never, cliente, [], nuevoId);
        assert.equal(conTrabajo.sectores!.length, 1);

        const manual: Partial<Visita> = {
            sectores: [{ id: 'x', nombre: 'SUTURAS', programado: false, actividades: [] }],
            ids_estrategias: ['s'], id_estrategia: 's'
        };
        aplicarSeleccion(manual as never, cliente, [], nuevoId);
        assert.equal(manual.sectores!.length, 1);
    });

    test('desmarcar una estrategia NO quita el sector si otra marcada lo usa', () => {
        const v: Partial<Visita> = { sectores: [] };
        aplicarSeleccion(v as never, cliente, ['g', 't'], nuevoId);
        aplicarSeleccion(v as never, cliente, ['t'], nuevoId);
        assert.deepEqual(v.sectores!.map(s => s.nombre), ['GASAS']);
    });
});

describe('estrategiasTrabajadas (avance)', () => {
    const todas = [e('g', 'GASAS', 'Compresas'), e('t', 'GASAS', 'Torundas'), e('s', 'SUTURAS', 'Seda'), e('u', 'UROLOGIA', 'Sondas')];

    test('marco 3 y trabajo 2: solo esas 2 avanzan', () => {
        const v = {
            ids_estrategias: ['g', 's', 'u'], id_estrategia: 'g',
            sectores: [sectorConActividad('GASAS'), sectorConActividad('SUTURAS'),
                       { id: 's-UROLOGIA', nombre: 'UROLOGIA', programado: true, actividades: [] }]
        };
        assert.deepEqual(estrategiasTrabajadas(v, todas).sort(), ['g', 's']);
    });

    test('una actividad sin sello (borrador) no cuenta como trabajada', () => {
        const v = { ids_estrategias: ['s'], id_estrategia: 's', sectores: [sectorConActividad('SUTURAS', [], false)] };
        assert.deepEqual(estrategiasTrabajadas(v, todas), []);
    });

    test('dos estrategias en el mismo sector: solo la del grupo de los materiales capturados', () => {
        const v = {
            ids_estrategias: ['g', 't'], id_estrategia: 'g',
            sectores: [sectorConActividad('GASAS', ['100 COMPRESA 4 CAPAS'])]
        };
        const grupoDe = (_s: string, m: string) => (m.includes('COMPRESA') ? 'Compresas' : 'Torundas');
        assert.deepEqual(estrategiasTrabajadas(v, todas, grupoDe), ['g']);
    });

    test('mismo sector sin materiales capturados: no se distingue, cuentan ambas', () => {
        const v = { ids_estrategias: ['g', 't'], id_estrategia: 'g', sectores: [sectorConActividad('GASAS')] };
        assert.deepEqual(estrategiasTrabajadas(v, todas).sort(), ['g', 't']);
    });

    test('una actividad multisector cubre los demas sectores que declara', () => {
        const ancla: Sector = {
            id: 's-GASAS', nombre: 'GASAS', programado: true,
            actividades: [{ id: 'a1', guardada: { momento: 'x', usuario: 'y' }, sectores_ids: ['s-GASAS', 's-SUTURAS'] }]
        };
        const v = {
            ids_estrategias: ['g', 's'], id_estrategia: 'g',
            sectores: [ancla, { id: 's-SUTURAS', nombre: 'SUTURAS', programado: true, actividades: [] }]
        };
        assert.deepEqual(estrategiasTrabajadas(v, todas).sort(), ['g', 's']);
    });

    test('visita antigua (solo id_estrategia) cuenta como siempre, aunque no se haya trabajado', () => {
        const v = { id_estrategia: 'g', sectores: [] };
        assert.deepEqual(estrategiasTrabajadas(v, todas), ['g']);
    });
});
