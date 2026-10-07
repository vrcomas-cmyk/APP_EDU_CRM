/**
 * Fechas de REGISTRO: cuándo se generó cada cosa, distinta del día de la visita y de la fecha del
 * documento. Son marcas del cliente que viajan hasta la base de datos y la hoja.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { nuevaVisita, duplicarVisita } from '../src/modules/visitas/services/fabricas';
import { visita as visitaDePrueba, sector as sectorDePrueba } from './ayuda/fixtures.js';

let n = 0;
const nuevoId = (p: string) => `${p}-${++n}`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('visita nueva', () => {
    test('guarda cuándo se generó el registro, aparte del día de la visita', () => {
        const antes = Date.now();
        const v = nuevaVisita({ dia: '2026-12-01', hora_inicio: '09:00', hora_fin: '10:00' }, null, nuevoId);

        assert.match(v.creada || '', ISO);
        assert.ok(Date.parse(v.creada!) >= antes - 1000, 'es de ahora');
        assert.equal(v.dia, '2026-12-01', 'el día de la visita es otro dato');
        assert.notEqual(v.creada!.slice(0, 10), v.dia);
    });

    test('los sectores precreados (agenda o estrategia) también traen su fecha de registro', () => {
        const v = nuevaVisita({ sectorNombres: ['GASAS', 'GUANTES'] }, null, nuevoId);
        assert.equal(v.sectores!.length, 2);
        for (const s of v.sectores!) assert.match(s.creado || '', ISO);
    });
});

describe('duplicar una visita', () => {
    test('es un registro NUEVO: su fecha de captura es hoy, no la de la original', () => {
        const original = visitaDePrueba({
            creada: '2020-01-01T00:00:00.000Z',
            sectores: [sectorDePrueba({ creado: '2020-01-01T00:00:00.000Z' })]
        });
        const copia = duplicarVisita(original as never, null, nuevoId);

        assert.notEqual(copia.creada, '2020-01-01T00:00:00.000Z');
        assert.match(copia.creada || '', ISO);
        assert.notEqual(copia.sectores![0]!.creado, '2020-01-01T00:00:00.000Z');
        assert.match(copia.sectores![0]!.creado || '', ISO);
    });
});
