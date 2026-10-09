/**
 * @vitest-environment happy-dom
 *
 * Origen del material: si son solo números, al menos N dígitos (por defecto 6); si lleva letras,
 * al menos M caracteres (por defecto 3). Ajustable desde Administración, y válido aunque el campo
 * sea opcional.
 */

import { test, describe, beforeEach, vi } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { problemaDeOrigen, reglasCaptura, REGLAS_POR_DEFECTO } from '../js/catalogos.js';
import { abrirModalMaterial } from '../js/materiales.js';
import { borradorDesdeCatalogo, conReglaCaptura, problemasDe } from '../src/modules/administracion/services/borrador';

const ponerCatalogo = (datos: unknown) => localStorage.setItem('datosPWA', JSON.stringify(datos));

beforeEach(() => { limpiarAlmacen(); document.body.replaceChildren(); });

describe('problemaDeOrigen', () => {
    test('vacío no es un problema (eso lo decide el modo obligatorio/opcional)', () => {
        assert.equal(problemaDeOrigen(''), '');
        assert.equal(problemaDeOrigen('   '), '');
    });

    test('solo números: al menos 6 dígitos por defecto', () => {
        assert.match(problemaDeOrigen('12345'), /al menos 6 dígitos/);
        assert.equal(problemaDeOrigen('210066'), '');
        assert.equal(problemaDeOrigen('12345678'), '');
    });

    test('con letras: al menos 3 caracteres por defecto', () => {
        assert.match(problemaDeOrigen('NA'), /al menos 3 caracteres/);
        assert.equal(problemaDeOrigen('Juan'), '');
        assert.equal(problemaDeOrigen('Sin folio'), '');
    });

    test('los espacios no cuentan como caracteres', () => {
        assert.match(problemaDeOrigen('a b'.replace(/./g, (c) => (c === 'b' ? ' ' : c))), /al menos 3 caracteres/);
        assert.match(problemaDeOrigen('A  '), /al menos 3 caracteres/);
    });

    test('con símbolos y sin letras ("4500-123") rige la regla de texto, no la del folio', () => {
        assert.equal(problemaDeOrigen('4500-123'), '');
        assert.match(problemaDeOrigen('1-'), /al menos 3 caracteres/);
    });

    test('las reglas son configurables', () => {
        ponerCatalogo({ reglas_captura: { origen_min_digitos: 8, origen_min_caracteres: 5 } });
        assert.deepEqual(reglasCaptura(), { origen_min_digitos: 8, origen_min_caracteres: 5 });
        assert.match(problemaDeOrigen('210066'), /al menos 8 dígitos/);
        assert.match(problemaDeOrigen('Juan'), /al menos 5 caracteres/);
        assert.equal(problemaDeOrigen('21006612'), '');
    });

    test('un valor absurdo en la hoja cae al default en vez de dejar pasar todo', () => {
        ponerCatalogo({ reglas_captura: { origen_min_digitos: 0, origen_min_caracteres: 'abc' } });
        assert.deepEqual(reglasCaptura(), REGLAS_POR_DEFECTO);
    });
});

describe('ventana "Agregar material"', () => {
    function abrir(campos: Record<string, string> = {}) {
        ponerCatalogo({
            tipos_actividad: [{ nombre: 'Entrega', campos: { material_cantidad: 'opcional', material_unidad: 'opcional', ...campos } }],
            materiales: [{ material: 'GASA SIMPLE', sector: 'GASAS' }]
        });
        const host = document.createElement('div');
        document.body.appendChild(host);
        const agregados: unknown[] = [];
        abrirModalMaterial({ host, sector: 'GASAS', tipo: 'Entrega', onAgregar: (m: unknown) => agregados.push(m), alToast: vi.fn() } as never);
        return { host, agregados };
    }

    function capturar(host: HTMLElement, origen: string) {
        (host.querySelector('.mat-opt') as HTMLButtonElement).click();
        const inputs = [...host.querySelectorAll('.mat-detalle input')] as HTMLInputElement[];
        const campoOrigen = inputs[inputs.length - 1]!;
        campoOrigen.value = origen;
        (host.querySelector('.mat-detalle .btn-principal') as HTMLButtonElement).click();
    }

    test('un origen opcional vacío se acepta', () => {
        const { host, agregados } = abrir();
        capturar(host, '');
        assert.equal(agregados.length, 1);
    });

    test('un origen escrito pero demasiado corto se rechaza, aunque sea opcional', () => {
        const { host, agregados } = abrir();
        capturar(host, '123');
        assert.equal(agregados.length, 0);
        assert.match(host.textContent || '', /al menos 6 dígitos/);
    });

    test('"NA" se rechaza y un folio de 6 dígitos se acepta', () => {
        const a = abrir();
        capturar(a.host, 'NA');
        assert.equal(a.agregados.length, 0);

        document.body.replaceChildren();
        const b = abrir();
        capturar(b.host, '210066');
        assert.equal(b.agregados.length, 1);
        assert.equal((b.agregados[0] as { origen: string }).origen, '210066');
    });

    test('obligatorio y vacío se rechaza con su propio mensaje', () => {
        const { host, agregados } = abrir({ material_origen: 'obligatorio' });
        capturar(host, '');
        assert.equal(agregados.length, 0);
        assert.match(host.textContent || '', /Indica el origen/);
    });

    test('la ayuda del campo dice las reglas vigentes', () => {
        ponerCatalogo({ reglas_captura: { origen_min_digitos: 7, origen_min_caracteres: 4 } });
        const host = document.createElement('div');
        document.body.appendChild(host);
        abrirModalMaterial({ host, sector: 'GASAS', onAgregar: () => {}, alToast: vi.fn() } as never);
        assert.match(host.textContent || '', /al menos 7 dígitos/);
        assert.match(host.textContent || '', /al menos 4 caracteres/);
    });
});

describe('Administración', () => {
    test('el borrador trae las reglas vigentes y se pueden cambiar', () => {
        const b = borradorDesdeCatalogo();
        assert.deepEqual(b.reglas_captura, REGLAS_POR_DEFECTO);
        assert.equal(conReglaCaptura(b, 'origen_min_digitos', 8).reglas_captura.origen_min_digitos, 8);
    });

    test('no deja guardar valores fuera de 1–50', () => {
        const b = borradorDesdeCatalogo();
        const malo = conReglaCaptura(b, 'origen_min_digitos', 0);
        assert.ok(problemasDe(malo).some(p => /dígitos mínimos/.test(p)));
        assert.ok(problemasDe(conReglaCaptura(b, 'origen_min_caracteres', 99)).some(p => /caracteres mínimos/.test(p)));
    });
});
