/**
 * El borrador de Territorios: titulares de zona y coberturas temporales.
 *
 * Lógica pura, sin red ni DOM — igual que `borradorRBAC.ts`, esto es lo que traduce entre lo
 * que se edita en pantalla y lo que espera `guardarTerritorios`.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    VACIO_TERRITORIOS, conTitular, sinTitular, coberturaNueva, esCoberturaNueva,
    conCobertura, sinCobertura, problemasDeTerritorios, titularesParaGuardar, coberturasParaGuardar
} from '@modules/administracion/services/borradorTerritorios';
import type { CoberturaZona, TitularZona } from '@core/tipos';

describe('titulares', () => {
    test('asignar una zona nueva la agrega', () => {
        const t = conTitular([], '001', 'ana@x.com');
        assert.deepEqual(t, [{ zona: '001', educador_correo: 'ana@x.com' }]);
    });

    test('asignar una zona ya asignada la reemplaza, no la duplica', () => {
        const original: TitularZona[] = [{ zona: '001', educador_correo: 'ana@x.com' }];
        const t = conTitular(original, '001', 'beto@x.com');
        assert.deepEqual(t, [{ zona: '001', educador_correo: 'beto@x.com' }]);
    });

    test('quitar el titular la saca de la lista', () => {
        const original: TitularZona[] = [
            { zona: '001', educador_correo: 'ana@x.com' },
            { zona: '002', educador_correo: 'beto@x.com' }
        ];
        assert.deepEqual(sinTitular(original, '001'), [{ zona: '002', educador_correo: 'beto@x.com' }]);
    });
});

describe('coberturas', () => {
    test('una cobertura nueva lleva un id que se distingue de uno real', () => {
        const c = coberturaNueva();
        assert.ok(esCoberturaNueva(c));
        assert.ok(!esCoberturaNueva({ ...c, id: '11111111-1111-1111-1111-111111111111' }));
    });

    test('editar por id no toca las demás', () => {
        const a = coberturaNueva();
        const b = coberturaNueva();
        const cambiadas = conCobertura([a, b], a.id, { zona: '001' });

        assert.equal(cambiadas.find(c => c.id === a.id)?.zona, '001');
        assert.equal(cambiadas.find(c => c.id === b.id)?.zona, '');
    });

    test('quitar por id la saca de la lista', () => {
        const a = coberturaNueva();
        const b = coberturaNueva();
        assert.deepEqual(sinCobertura([a, b], a.id), [b]);
    });
});

describe('problemasDeTerritorios', () => {
    test('un correo de titular inválido se reporta', () => {
        const b = { ...VACIO_TERRITORIOS, titulares: [{ zona: '001', educador_correo: 'no-es-correo' }] };
        assert.ok(problemasDeTerritorios(b).some(p => p.includes('correo')));
    });

    test('dos titulares para la misma zona se reporta', () => {
        // No debería poder construirse desde la UI (conTitular hace upsert), pero si llegara
        // así desde el servidor, la validación lo debe atrapar antes de reenviarlo.
        const b = {
            ...VACIO_TERRITORIOS,
            titulares: [
                { zona: '001', educador_correo: 'ana@x.com' },
                { zona: '001', educador_correo: 'beto@x.com' }
            ]
        };
        assert.ok(problemasDeTerritorios(b).some(p => p.includes('misma zona')));
    });

    test('una cobertura que termina antes de empezar se reporta', () => {
        const b = {
            ...VACIO_TERRITORIOS,
            coberturas: [{
                id: 'nueva-1', zona: '001', educador_correo: 'ana@x.com',
                desde: '2026-08-01', hasta: '2026-07-01', motivo: null
            }]
        };
        assert.ok(problemasDeTerritorios(b).some(p => p.includes('antes de empezar')));
    });

    test('un borrador limpio no reporta nada', () => {
        const b = {
            titulares: [{ zona: '001', educador_correo: 'ana@x.com' }],
            coberturas: [{
                id: 'nueva-1', zona: '002', educador_correo: 'beto@x.com',
                desde: '2026-07-01', hasta: null, motivo: 'Vacaciones'
            }]
        };
        assert.deepEqual(problemasDeTerritorios(b), []);
    });
});

describe('titularesParaGuardar', () => {
    test('reenvía todos los actuales y lista para quitar los que ya no están', () => {
        const original: TitularZona[] = [
            { zona: '001', educador_correo: 'ana@x.com' },
            { zona: '002', educador_correo: 'beto@x.com' }
        ];
        const actual: TitularZona[] = [{ zona: '001', educador_correo: 'ana@x.com' }];

        const { asignar, quitarZona } = titularesParaGuardar(original, actual);
        assert.deepEqual(asignar, [{ zona: '001', educador_correo: 'ana@x.com' }]);
        assert.deepEqual(quitarZona, ['002']);
    });

    test('normaliza el correo a minúsculas sin espacios', () => {
        const { asignar } = titularesParaGuardar([], [{ zona: '001', educador_correo: '  ANA@X.com ' }]);
        assert.equal(asignar[0]?.educador_correo, 'ana@x.com');
    });
});

describe('coberturasParaGuardar', () => {
    test('las nuevas van a agregar; las quitadas, a quitar', () => {
        const existente: CoberturaZona = {
            id: '11111111-1111-1111-1111-111111111111', zona: '001', educador_correo: 'ana@x.com',
            desde: '2026-07-01', hasta: null, motivo: null
        };
        const nueva = coberturaNueva();
        const conDatos = { ...nueva, zona: '002', educador_correo: 'beto@x.com' };

        const original = [existente];
        const actual = [conDatos]; // la existente se quitó, la nueva se agregó

        const { agregarCobertura, quitarCobertura } = coberturasParaGuardar(original, actual);
        assert.equal(agregarCobertura.length, 1);
        assert.equal(agregarCobertura[0]?.zona, '002');
        assert.deepEqual(quitarCobertura, [existente.id]);
    });

    test('una cobertura que sigue igual no aparece en ningún lado', () => {
        const existente: CoberturaZona = {
            id: '11111111-1111-1111-1111-111111111111', zona: '001', educador_correo: 'ana@x.com',
            desde: '2026-07-01', hasta: null, motivo: null
        };
        const { agregarCobertura, quitarCobertura } = coberturasParaGuardar([existente], [existente]);
        assert.deepEqual(agregarCobertura, []);
        assert.deepEqual(quitarCobertura, []);
    });
});
