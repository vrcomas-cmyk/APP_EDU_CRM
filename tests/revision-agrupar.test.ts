/**
 * Cómo se agrupa la cola de revisión. Puro dominio: sin montar nada.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { agruparPendientes, SIN_AGRUPAR } from '@modules/revision/services/agrupar';
import type { PendienteRevision } from '@core/tipos';

function pendiente(campos: Partial<PendienteRevision> & { dia?: string | null } = {}): PendienteRevision {
    const { dia, ...resto } = campos;
    // `null` explícito omite el día (para probar "sin fecha"); sin la clave, el default de siempre.
    const diaFinal = dia === null ? undefined : (dia ?? '2026-07-13');
    return {
        flujo: 'calidad_visita', ambito: 'visita', id_ambito: 'v-1', id_visita: 'v-1',
        educador: 'Ana López', educador_correo: 'ana@x.com',
        visita: { id: 'v-1', dia: diaFinal },
        titulo: 'Visita', detalle: '',
        ...resto
    };
}

describe('agruparPendientes', () => {
    test('sin criterios, un solo grupo sin etiqueta con todo dentro', () => {
        const items = [pendiente(), pendiente({ id_ambito: 'v-2' })];
        const grupos = agruparPendientes(items, SIN_AGRUPAR);

        assert.equal(grupos.length, 1);
        assert.equal(grupos[0]!.etiqueta, '');
        assert.equal(grupos[0]!.items.length, 2);
    });

    test('sin pendientes, ningún grupo aunque no se agrupe por nada', () => {
        assert.deepEqual(agruparPendientes([], SIN_AGRUPAR), []);
    });

    test('por educador: un grupo por persona, ordenado alfabéticamente', () => {
        const items = [
            pendiente({ educador: 'Beto Ruiz', educador_correo: 'beto@x.com' }),
            pendiente({ educador: 'Ana López', educador_correo: 'ana@x.com' })
        ];
        const grupos = agruparPendientes(items, { educador: true, semana: false });

        assert.deepEqual(grupos.map(g => g.etiqueta), ['Ana López', 'Beto Ruiz']);
        assert.equal(grupos[0]!.items.length, 1);
    });

    test('dos correos del mismo educador (typo de nombre) no se separan: el correo manda', () => {
        const items = [
            pendiente({ educador: 'Ana', educador_correo: 'ana@x.com' }),
            pendiente({ educador: 'Ana L.', educador_correo: 'ana@x.com' })
        ];
        const grupos = agruparPendientes(items, { educador: true, semana: false });
        assert.equal(grupos.length, 1, 'mismo correo, mismo grupo aunque el nombre varíe');
    });

    test('por semana: junta lo de la misma semana laboral y separa lo de otra', () => {
        const items = [
            pendiente({ dia: '2026-07-13' }),   // lunes
            pendiente({ dia: '2026-07-17' }),   // viernes de la MISMA semana
            pendiente({ dia: '2026-06-29' })    // otra semana
        ];
        const grupos = agruparPendientes(items, { educador: false, semana: true });

        assert.equal(grupos.length, 2);
        assert.equal(grupos[0]!.items.length, 2, 'lunes y viernes de la misma semana van juntos');
    });

    test('por semana, lo más reciente va primero', () => {
        const items = [pendiente({ dia: '2026-06-29' }), pendiente({ dia: '2026-07-13' })];
        const grupos = agruparPendientes(items, { educador: false, semana: true });

        assert.ok(grupos[0]!.etiqueta.includes('julio'), 'la semana de julio es más reciente');
    });

    test('educador y semana combinados: un grupo por cada combinación', () => {
        const items = [
            pendiente({ educador: 'Ana López', educador_correo: 'ana@x.com', dia: '2026-07-13' }),
            pendiente({ educador: 'Ana López', educador_correo: 'ana@x.com', dia: '2026-06-29' }),
            pendiente({ educador: 'Beto Ruiz', educador_correo: 'beto@x.com', dia: '2026-07-13' })
        ];
        const grupos = agruparPendientes(items, { educador: true, semana: true });

        assert.equal(grupos.length, 3, 'Ana tiene dos semanas distintas, Beto una');
        assert.ok(grupos.every(g => g.etiqueta.includes('·')), 'la etiqueta combina semana y educador');
    });

    test('una visita sin día no revienta: cae en un grupo "Sin fecha"', () => {
        const items = [pendiente({ dia: null })];
        const grupos = agruparPendientes(items, { educador: false, semana: true });

        assert.equal(grupos[0]!.etiqueta, 'Sin fecha');
    });
});
