import { describe, test, expect } from 'vitest';
import {
    rangoDePeriodo, periodoActivo, ultimosMeses, rangoDeMesTexto, mesDelRango
} from '../src/shared/services/periodo';

// Miércoles 15 de octubre de 2025.
const REF = new Date(2025, 9, 15);

describe('periodos de filtro', () => {
    test('hoy', () => {
        expect(rangoDePeriodo('hoy', REF)).toEqual({ desde: '2025-10-15', hasta: '2025-10-15' });
    });

    test('la semana va de lunes a domingo', () => {
        expect(rangoDePeriodo('semana', REF)).toEqual({ desde: '2025-10-13', hasta: '2025-10-19' });
        // Un domingo pertenece a la semana que termina en él, no a la siguiente.
        expect(rangoDePeriodo('semana', new Date(2025, 9, 19))).toEqual({ desde: '2025-10-13', hasta: '2025-10-19' });
        expect(rangoDePeriodo('semana', new Date(2025, 9, 13))).toEqual({ desde: '2025-10-13', hasta: '2025-10-19' });
    });

    test('mes actual y anterior, incluso cruzando de año', () => {
        expect(rangoDePeriodo('mes', REF)).toEqual({ desde: '2025-10-01', hasta: '2025-10-31' });
        expect(rangoDePeriodo('mes-anterior', REF)).toEqual({ desde: '2025-09-01', hasta: '2025-09-30' });
        expect(rangoDePeriodo('mes-anterior', new Date(2026, 0, 10))).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
    });

    test('febrero bisiesto', () => {
        expect(rangoDeMesTexto('2024-02')).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' });
    });

    test('todo es sin rango', () => {
        expect(rangoDePeriodo('todo', REF)).toEqual({ desde: '', hasta: '' });
    });

    test('reconoce qué periodo está activo', () => {
        expect(periodoActivo('2025-10-01', '2025-10-31', REF)).toBe('mes');
        expect(periodoActivo('', '', REF)).toBe('todo');
        expect(periodoActivo('2025-10-02', '2025-10-31', REF)).toBeNull();
    });

    test('el selector ofrece los últimos meses con su nombre', () => {
        const m = ultimosMeses(3, REF);
        expect(m.map(x => x.etiqueta)).toEqual(['octubre 2025', 'septiembre 2025', 'agosto 2025']);
        expect(m[0]?.valor).toBe('2025-10');
        expect(mesDelRango('2025-09-01', '2025-09-30')).toBe('2025-09');
        expect(mesDelRango('2025-09-01', '2025-09-15')).toBe('');
    });
});
