/**
 * @vitest-environment happy-dom
 *
 * Quien revisa ve de dónde salió cada material (origen), no solo cuántos hay.
 */

import { test, describe, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { render, cleanup } from '@testing-library/react';

import { limpiarAlmacen } from './entorno.js';
import { ExpedienteVisita } from '../src/modules/revision/components/ExpedienteVisita';
import { textoMaterial } from '../src/modules/revision/services/materiales';
import { visita, sector, actividad } from './ayuda/fixtures.js';

const ponerCatalogo = (campos: Record<string, string>) => localStorage.setItem('datosPWA', JSON.stringify({
    tipos_actividad: [{ nombre: 'Capacitación', campos }]
}));

function expediente(materiales: unknown[]) {
    const a = actividad({ tipo: 'Capacitación', materiales, fecha_documento: '2026-09-30' });
    return visita({ sectores: [sector({ actividades: [a] })] });
}

beforeEach(() => limpiarAlmacen());
afterEach(cleanup);

describe('textoMaterial', () => {
    test('incluye el origen cuando se capturó', () => {
        assert.equal(
            textoMaterial({ id: 'm1', material: 'GASA', cantidad: 2, unidad: 'PI', origen: '210066' }, true),
            'GASA ×2 PI · Origen: 210066'
        );
    });

    test('si el tipo lo pide y no hay origen, lo señala', () => {
        assert.equal(textoMaterial({ id: 'm1', material: 'GASA', cantidad: 2 }, true), 'GASA ×2 · Sin origen');
    });

    test('si el tipo no captura origen, no inventa un aviso', () => {
        assert.equal(textoMaterial({ id: 'm1', material: 'GASA', cantidad: 2 }, false), 'GASA ×2');
    });
});

describe('expediente de la visita en Revisión', () => {
    test('muestra un material por línea, con su origen', () => {
        const { container } = render(
            <ExpedienteVisita visita={expediente([
                { id: 'm1', material: 'GASA SIMPLE', cantidad: 2, unidad: 'PI', origen: '210066' },
                { id: 'm2', material: 'GUANTE M', cantidad: 5, unidad: 'CJ', origen: 'Juan Pérez' }
            ]) as never} />
        );

        const lineas = [...container.querySelectorAll('.expediente-materiales li')].map(li => li.textContent);
        assert.deepEqual(lineas, [
            'GASA SIMPLE ×2 PI · Origen: 210066',
            'GUANTE M ×5 CJ · Origen: Juan Pérez'
        ]);
    });

    test('avisa "Sin origen" cuando el tipo lo captura y faltó', () => {
        const { container } = render(
            <ExpedienteVisita visita={expediente([{ id: 'm1', material: 'GASA', cantidad: 1 }]) as never} />
        );
        assert.match(container.textContent || '', /Sin origen/);
    });

    test('con el origen oculto para el tipo no señala nada', () => {
        ponerCatalogo({ material_origen: 'oculto' });
        const { container } = render(
            <ExpedienteVisita visita={expediente([{ id: 'm1', material: 'GASA', cantidad: 1 }]) as never} />
        );
        assert.doesNotMatch(container.textContent || '', /Sin origen/);
    });

    test('muestra la fecha del documento en dd/mm/aaaa', () => {
        const { container } = render(<ExpedienteVisita visita={expediente([]) as never} />);
        assert.match(container.textContent || '', /Fecha del documento: 30\/09\/2026/);
    });
});
