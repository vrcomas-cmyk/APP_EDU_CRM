// @vitest-environment happy-dom
/**
 * El estilo (subtema de forma) es ORTOGONAL al tema de color: cambiar uno no toca al otro, y se
 * guardan por separado.
 */
import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { aplicarEstilo, estiloActual, initEstilo } from '../js/tema.js';

beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.estilo;
    delete document.documentElement.dataset.theme;
});

describe('estilo (subtema)', () => {
    test('por defecto es clásico y no pone atributo', () => {
        assert.equal(estiloActual(), 'clasico');
        assert.equal(document.documentElement.dataset.estilo, undefined);
    });

    test('apple pone data-estilo y se recuerda; clásico lo quita', () => {
        aplicarEstilo('apple');
        assert.equal(document.documentElement.dataset.estilo, 'apple');
        assert.equal(estiloActual(), 'apple');

        aplicarEstilo('clasico');
        assert.equal(document.documentElement.dataset.estilo, undefined);
        assert.equal(estiloActual(), 'clasico');
    });

    test('no toca el tema de color', () => {
        document.documentElement.dataset.theme = 'degasa';
        aplicarEstilo('apple');
        assert.equal(document.documentElement.dataset.theme, 'degasa');
        assert.equal(localStorage.getItem('pdt_tema'), null);
    });

    test('el selector pinta las dos opciones y marca la activa', () => {
        const host = document.createElement('div');
        aplicarEstilo('apple');
        initEstilo(host);

        const botones = [...host.querySelectorAll('button')];
        assert.deepEqual(botones.map(b => b.dataset.estilo), ['clasico', 'apple']);
        assert.equal(botones.find(b => b.dataset.estilo === 'apple').getAttribute('aria-pressed'), 'true');

        botones[0].click();
        assert.equal(document.documentElement.dataset.estilo, undefined);
        assert.equal(botones[0].getAttribute('aria-pressed'), 'true');
    });
});
