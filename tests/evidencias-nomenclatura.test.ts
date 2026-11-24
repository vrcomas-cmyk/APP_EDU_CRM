/**
 * Nomenclatura de evidencias: FECHA (AAAA.MM.DD). TIPO. NÚM CLIENTE. NOMBRE CLIENTE. SECTOR.
 * Ejemplo del negocio: «2025.10.15. EVAL. 100657 FUCAM. ANTISÉPTICOS Y ALCOHOL».
 */

import { describe, test, expect } from 'vitest';
import { nomenclaturaEvidencia, abreviaturaTipo } from '../js/evidencias.js';

const ctx = (cliente: string, tipo: string, sector = 'Antisépticos y alcohol') => ({
    visita: { dia: '2025-10-15', cliente },
    sector: { nombre: sector },
    actividad: { tipo }
});

describe('nomenclatura de evidencias', () => {
    test('reproduce el ejemplo del negocio', () => {
        expect(nomenclaturaEvidencia(ctx('100657 FUCAM', 'Evaluación de producto'), 'pdf'))
            .toBe('2025.10.15. EVAL. 100657 FUCAM. ANTISÉPTICOS Y ALCOHOL.pdf');
    });

    test('abreviaturas CAP, EVAL, PRES y TLL', () => {
        expect(abreviaturaTipo('Capacitación')).toBe('CAP');
        expect(abreviaturaTipo('Evaluación de producto')).toBe('EVAL');
        expect(abreviaturaTipo('Demostración de producto')).toBe('PRES');
        expect(abreviaturaTipo('Taller')).toBe('TLL');
    });

    test('un tipo sin abreviatura usa sus primeras letras', () => {
        expect(abreviaturaTipo('Atención a queja')).toBe('ATEN');
    });

    test('separa número y nombre aunque venga con guion', () => {
        expect(nomenclaturaEvidencia(ctx('100657 - Fucam', 'Capacitación'), 'jpg'))
            .toBe('2025.10.15. CAP. 100657 FUCAM. ANTISÉPTICOS Y ALCOHOL.jpg');
    });

    test('quita caracteres que un nombre de archivo no admite', () => {
        const n = nomenclaturaEvidencia(ctx('1 A/B', 'Capacitación', 'Sector: X*'), 'jpg');
        expect(n).not.toMatch(/[\\/:*?"<>|]/);
    });
});
