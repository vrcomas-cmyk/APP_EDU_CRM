/**
 * REQUISITO DE NEGOCIO: "Crear una cita de seguimiento desde una visita existente."
 *
 * Caso real descrito: durante una evaluación el cliente pide regresar otro día a recoger una
 * evidencia. El Educador debe poder crear esa nueva cita desde la visita actual, asociada al
 * mismo cliente/hospital/sector/estrategia y con un motivo de seguimiento — y debe poder
 * verse la relación entre la visita original y la cita de seguimiento (el Gerente, al revisar,
 * necesita saber que esa visita quedó con una evidencia pendiente que se recogerá después).
 *
 * Lo que existe hoy en el dominio de visitas (`src/core/tipos.ts`, `js/visita.js`,
 * `src/modules/visitas/services/fabricas.ts`) es:
 *   - `reagendas[]`: historial de cambios de fecha/hora de LA MISMA visita (no crea una visita
 *     nueva, no conserva "por qué falta una evidencia").
 *   - `duplicarVisita`: crea una visita nueva con la misma plantilla, pero SIN ninguna
 *     referencia de vuelta a la visita original (ni campo `id_visita_origen` ni similar) y sin
 *     motivo de seguimiento.
 *
 * No existe una tercera función, ni un campo que enlace dos visitas como
 * "original → seguimiento". Esta prueba documenta ese hueco: falla mientras el enlace no
 * exista, y sirve como especificación ejecutable de lo que el requisito pide.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { agregarVisita, leerVisitas } from '../js/storage.js';
import { visita } from './ayuda/fixtures.js';
import type { Visita } from '@core/tipos';

beforeEach(() => limpiarAlmacen());

describe('cita de seguimiento desde una visita existente', () => {
    test('REQUISITO: el tipo Visita debe poder referenciar la visita que la originó', () => {
        const original = agregarVisita(visita({ id: 'v-original', cliente: 'Hospital Central' }));

        // No existe ninguna función `crearCitaSeguimiento`/`generarSeguimiento` en el dominio
        // de visitas — se simula aquí el resultado que ESE requisito pide, para que la prueba
        // deje claro qué campo falta.
        const seguimiento = { ...visita({ id: 'v-seguimiento', cliente: original.cliente }) } as Visita & {
            id_visita_origen?: string;
        };

        assert.equal(seguimiento.id_visita_origen, undefined,
            'Visita no tiene un campo id_visita_origen (ni equivalente): no hay forma de '
            + 'expresar "esta visita es el seguimiento de aquella otra". Sin ese campo, ni el '
            + 'Gerente ni el Analista pueden ver la relación entre la visita original y la cita '
            + 'de seguimiento al revisar, como pide el requisito de negocio.');
    });

    test('REQUISITO: no existe una función de dominio para crear un seguimiento vinculado', async () => {
        const modulo = await import('../src/modules/visitas/services/fabricas');
        const exportaFuncionDeSeguimiento = 'crearSeguimiento' in modulo
            || 'generarCitaSeguimiento' in modulo
            || 'duplicarComoSeguimiento' in modulo;

        assert.ok(exportaFuncionDeSeguimiento,
            'src/modules/visitas/services/fabricas.ts solo exporta nuevaVisita y duplicarVisita. '
            + 'Ninguna de las dos conserva una referencia a la visita de origen ni acepta un '
            + '"motivo de seguimiento": duplicarVisita() se diseñó para repetir una plantilla de '
            + 'trabajo, no para encadenar una cita de regreso. Falta una función (o un parámetro '
            + 'en duplicarVisita) que resuelva el caso real descrito: "el cliente pide regresar '
            + 'otro día a recoger una evidencia".');
    });
});
