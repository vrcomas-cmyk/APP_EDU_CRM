/**
 * @vitest-environment happy-dom
 *
 * Si localStorage está lleno, una escritura importante (p. ej. el valor mensual de una estrategia)
 * no se pierde: se libera lo prescindible, de lo más barato a lo más caro, y se reintenta.
 */
import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { guardarConCuotaSegura } from '../js/storage.js';
import { clave } from '../js/entorno.js';

const K = {
    respaldo: clave('visitas_backup_v1') + '1',
    catalogo: clave('datosPWA'),
    eventos: clave('eventos'),
    estrategias: clave('pdt_estrategias')
};

/** localStorage con un tope de caracteres, como el del navegador (pero chico). */
function conTope(tope: number) {
    const original = localStorage.setItem.bind(localStorage);
    const leer = localStorage.getItem.bind(localStorage);
    vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
        let usado = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)!;
            if (key !== k) usado += key.length + (leer(key) || '').length;
        }
        if (usado + k.length + v.length > tope) throw new DOMException('lleno', 'QuotaExceededError');
        original(k, v);
    });
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('guardarConCuotaSegura', () => {
    test('libera primero los respaldos de migración y conserva el catálogo', () => {
        localStorage.setItem(K.respaldo, 'x'.repeat(500));
        localStorage.setItem(K.catalogo, 'c'.repeat(300));
        conTope(1000);
        guardarConCuotaSegura(K.estrategias, 'e'.repeat(200));
        assert.equal(localStorage.getItem(K.respaldo), null);
        assert.ok(localStorage.getItem(K.catalogo), 'el catálogo no se toca si ya cupo');
        assert.equal(localStorage.getItem(K.estrategias)?.length, 200);
    });

    test('poda la bitácora ya subida pero nunca los pendientes', () => {
        const subidos = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, sincronizado: true }));
        const pendientes = [{ id: 'p1', sincronizado: false }];
        localStorage.setItem(K.eventos, JSON.stringify([...subidos, ...pendientes]));
        const tamano = (localStorage.getItem(K.eventos) || '').length;
        conTope(tamano - 500);
        guardarConCuotaSegura(K.estrategias, 'e'.repeat(100));
        const quedan = JSON.parse(localStorage.getItem(K.eventos) || '[]');
        assert.ok(quedan.some((x: { id: string }) => x.id === 'p1'), 'el pendiente sigue');
        assert.ok(quedan.length <= 201);
        assert.equal(localStorage.getItem(K.estrategias)?.length, 100);
    });

    test('el catálogo es lo último que se sacrifica', () => {
        localStorage.setItem(K.catalogo, 'c'.repeat(800));
        conTope(1000);
        guardarConCuotaSegura(K.estrategias, 'e'.repeat(300));
        assert.equal(localStorage.getItem(K.catalogo), null);
        assert.equal(localStorage.getItem(K.estrategias)?.length, 300);
    });
});
