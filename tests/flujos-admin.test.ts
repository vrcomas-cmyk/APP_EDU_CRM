/**
 * El borrador de Flujos de revisión: validación y traducción a lo que espera el servidor.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    conCampo, conNuevoResultado, conResultado, conVeredictosPropios, flujoNuevo,
    flujosParaGuardar, problemasDeFlujos, resultadoNuevo, sinResultado
} from '@modules/administracion/services/borradorFlujos';
import type { FlujoAdmin } from '@core/tipos';

const flujo = (extra: Partial<FlujoAdmin> = {}): FlujoAdmin => ({
    ...flujoNuevo(), clave: 'calidad_visita', nombre: 'Calidad de la visita', permiso: 'visitas.calificar',
    ...extra
});

describe('campos básicos', () => {
    test('conCampo cambia un solo campo sin tocar el resto', () => {
        const f = flujo();
        const con = conCampo(f, 'nombre', 'Otro nombre');
        assert.equal(con.nombre, 'Otro nombre');
        assert.equal(con.clave, f.clave, 'el resto del flujo no se toca');
    });
});

describe('veredictos', () => {
    test('conVeredictosPropios(true) arranca con un veredicto en blanco, no con una lista vacía', () => {
        const f = flujo({ resultados: null });
        const con = conVeredictosPropios(f, true);
        assert.equal(con.resultados?.length, 1, 'una lista vacía no se distingue de "sin configurar"');
    });

    test('conVeredictosPropios(false) vuelve a null, sin perder si se reactiva', () => {
        const f = flujo({ resultados: [resultadoNuevo()] });
        const con = conVeredictosPropios(f, false);
        assert.equal(con.resultados, null);
    });

    test('conVeredictosPropios(true) conserva los que ya había, en vez de reiniciar', () => {
        const existentes = [{ ...resultadoNuevo(), valor: 'efectiva', etiqueta: 'Efectiva' }];
        const f = flujo({ resultados: existentes });
        const con = conVeredictosPropios(f, true);
        assert.deepEqual(con.resultados, existentes);
    });

    test('conResultado edita un veredicto por índice, sin tocar los demás', () => {
        const f = flujo({ resultados: [resultadoNuevo(), resultadoNuevo()] });
        const con = conResultado(f, 1, 'valor', 'parcial');
        assert.equal(con.resultados?.[0]!.valor, '');
        assert.equal(con.resultados?.[1]!.valor, 'parcial');
    });

    test('conNuevoResultado agrega uno al final', () => {
        const f = flujo({ resultados: [resultadoNuevo()] });
        const con = conNuevoResultado(f);
        assert.equal(con.resultados?.length, 2);
    });

    test('sinResultado quita solo el indicado', () => {
        const a = { ...resultadoNuevo(), valor: 'a' };
        const b = { ...resultadoNuevo(), valor: 'b' };
        const f = flujo({ resultados: [a, b] });
        const con = sinResultado(f, 0);
        assert.deepEqual(con.resultados, [b]);
    });
});

describe('problemasDeFlujos', () => {
    test('detecta clave vacía, formato inválido y duplicados', () => {
        assert.ok(problemasDeFlujos([flujo({ clave: '' })]).some(p => p.includes('sin clave')));
        assert.ok(problemasDeFlujos([flujo({ clave: 'Calidad Visita' })])
            .some(p => p.includes('mayúsculas')));
        assert.ok(problemasDeFlujos([flujo({ clave: 'x' }), flujo({ clave: 'x' })])
            .some(p => p.includes('misma clave')));
        assert.deepEqual(problemasDeFlujos([flujo()]), []);
    });

    test('detecta permiso vacío', () => {
        assert.ok(problemasDeFlujos([flujo({ permiso: '' })]).some(p => p.includes('sin permiso')));
    });

    test('detecta un veredicto sin valor o sin etiqueta', () => {
        const f = flujo({ resultados: [{ ...resultadoNuevo(), etiqueta: 'Efectiva' }] }); // sin valor
        assert.ok(problemasDeFlujos([f]).some(p => p.includes('sin valor o sin etiqueta')));
    });

    test('detecta dos veredictos del mismo flujo con el mismo valor', () => {
        const f = flujo({
            resultados: [
                { ...resultadoNuevo(), valor: 'efectiva', etiqueta: 'Efectiva' },
                { ...resultadoNuevo(), valor: 'efectiva', etiqueta: 'Otra vez efectiva' }
            ]
        });
        assert.ok(problemasDeFlujos([f]).some(p => p.includes('mismo valor')));
    });

    test('un flujo sin veredictos propios (resultados null) no genera problemas de veredictos', () => {
        assert.deepEqual(problemasDeFlujos([flujo({ resultados: null })]), []);
    });
});

describe('flujosParaGuardar', () => {
    test('reenvía todos los actuales y pide borrar los que ya no están', () => {
        const original = [flujo({ clave: 'a' }), flujo({ clave: 'b' })];
        const actual = [flujo({ clave: 'a' })];

        const { flujos, eliminar } = flujosParaGuardar(original, actual);
        assert.deepEqual(flujos.map(f => f.clave), ['a']);
        assert.deepEqual(eliminar, ['b']);
    });

    test('normaliza la clave a minúsculas', () => {
        const [f] = flujosParaGuardar([], [flujo({ clave: 'Calidad_Visita' })]).flujos;
        assert.equal(f!.clave, 'calidad_visita');
    });

    test('un flujo nuevo (no estaba en el original) no se pide borrar', () => {
        const { eliminar } = flujosParaGuardar([], [flujo({ clave: 'nuevo' })]);
        assert.deepEqual(eliminar, []);
    });
});
