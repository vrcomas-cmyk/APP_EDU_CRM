/**
 * «Qué se revisa» editable: los criterios de cada flujo son datos que Administración puede
 * quitar, renombrar o ampliar.
 */

import { describe, test, expect } from 'vitest';
import {
    flujoNuevo, conCriteriosPropios, conCriterio, conNuevoCriterio, sinCriterio,
    problemasDeFlujos, flujosParaGuardar, normalizarFlujos
} from '../src/modules/administracion/services/borradorFlujos';
import { criteriosDe, criteriosPorDefecto } from '../js/revisiones.js';
import type { FlujoAdmin } from '../src/core/tipos';

const flujo = (extra: Partial<FlujoAdmin> = {}): FlujoAdmin => ({
    ...flujoNuevo(), clave: 'calidad_visita', nombre: 'Calidad', permiso: 'visitas.calificar', ...extra
});

describe('criterios por defecto', () => {
    test('calidad de la visita trae Actividad, Evidencia, Puntualidad y Objetivo', () => {
        const etiquetas = criteriosDe('calidad_visita').map((c: { etiqueta: string }) => c.etiqueta);
        expect(etiquetas).toEqual(['Actividad', 'Evidencia', 'Puntualidad', 'Objetivo del sector']);
    });

    test('un flujo desconocido no trae criterios', () => {
        expect(criteriosDe('flujo_inventado')).toEqual([]);
    });

    test('las copias por defecto no comparten referencia (editar una no altera la fuente)', () => {
        const a = criteriosPorDefecto('calidad_visita');
        a[0].etiqueta = 'cambiado';
        expect(criteriosPorDefecto('calidad_visita')[0].etiqueta).toBe('Actividad');
    });
});

describe('una lista configurada manda, aunque esté vacía', () => {
    test('criterios propios reemplazan a los de siempre', () => {
        const propios = [{ clave: 'c_1', etiqueta: 'Solo esto' }];
        expect(criteriosDe({ clave: 'calidad_visita', criterios: propios })).toEqual(propios);
    });

    test('una lista vacía significa «sin casillas», no «los de siempre»', () => {
        expect(criteriosDe({ clave: 'calidad_visita', criterios: [] })).toEqual([]);
    });

    test('null (nadie los tocó) usa los de siempre', () => {
        expect(criteriosDe({ clave: 'calidad_visita', criterios: null }).length).toBe(4);
    });
});

describe('edición en Administración', () => {
    test('un flujo nuevo arranca con los de siempre (null)', () => {
        expect(flujoNuevo().criterios).toBeNull();
    });

    test('activar «personalizados» arranca con los criterios de siempre, para quitar los que sobren', () => {
        const f = conCriteriosPropios(flujo(), true);
        expect(f.criterios?.map(c => c.etiqueta)).toEqual(['Actividad', 'Evidencia', 'Puntualidad', 'Objetivo del sector']);
    });

    test('desactivarlos vuelve a «los de siempre» (null)', () => {
        const f = conCriteriosPropios(conCriteriosPropios(flujo(), true), false);
        expect(f.criterios).toBeNull();
    });

    test('quitar un criterio no toca los demás', () => {
        const base = conCriteriosPropios(flujo(), true);
        const f = sinCriterio(base, 2);   // quita «Puntualidad»
        expect(f.criterios?.map(c => c.etiqueta)).toEqual(['Actividad', 'Evidencia', 'Objetivo del sector']);
    });

    test('se pueden quitar todos', () => {
        let f = conCriteriosPropios(flujo(), true);
        while ((f.criterios || []).length) f = sinCriterio(f, 0);
        expect(f.criterios).toEqual([]);
        expect(problemasDeFlujos([f])).toEqual([]);
    });

    test('renombrar conserva la clave (lo ya guardado sigue apuntando al mismo criterio)', () => {
        const base = conCriteriosPropios(flujo(), true);
        const f = conCriterio(base, 0, 'Actividad realizada');
        expect(f.criterios?.[0]).toEqual({ clave: base.criterios?.[0]?.clave, etiqueta: 'Actividad realizada' });
    });

    test('un criterio nuevo recibe una clave única', () => {
        let f = conCriteriosPropios(flujo({ clave: 'flujo_propio' }), true);
        f = conNuevoCriterio(conNuevoCriterio(f));
        const claves = (f.criterios || []).map(c => c.clave);
        expect(claves).toHaveLength(2);
        expect(new Set(claves).size).toBe(2);
    });

    test('un criterio sin nombre impide guardar', () => {
        const f = conNuevoCriterio(conCriteriosPropios(flujo({ clave: 'flujo_propio' }), true));
        expect(problemasDeFlujos([f]).join(' ')).toMatch(/criterio sin nombre/);
    });

    test('al guardar viajan solo clave y etiqueta, sin espacios sobrantes', () => {
        const base = conCriteriosPropios(flujo(), true);
        const f = conCriterio(base, 0, '  Actividad  ');
        const { flujos } = flujosParaGuardar([f], [f]);
        expect(flujos[0]?.criterios?.[0]).toEqual({ clave: base.criterios?.[0]?.clave, etiqueta: 'Actividad' });
    });

    test('criterios null viaja como null', () => {
        const f = flujo();
        expect(flujosParaGuardar([f], [f]).flujos[0]?.criterios).toBeNull();
    });

    test('un servidor sin la migración (sin el campo) se normaliza a null', () => {
        const sinCampo = { ...flujo() } as Partial<FlujoAdmin>;
        delete sinCampo.criterios;
        expect(normalizarFlujos([sinCampo as FlujoAdmin])[0]?.criterios).toBeNull();
    });
});
