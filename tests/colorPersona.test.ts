import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import { colorDePersona, textoDePersona, inicialDePersona } from '@modules/agenda/services/colorPersona';

describe('colorDePersona', () => {
    test('el mismo correo da siempre el mismo color', () => {
        const a = colorDePersona('ana@degasa.com');
        const b = colorDePersona('ana@degasa.com');
        assert.equal(a, b);
    });

    test('no distingue mayúsculas ni espacios sobrantes', () => {
        assert.equal(colorDePersona('ANA@degasa.com'), colorDePersona('  ana@degasa.com  '));
    });

    test('devuelve una variable de la paleta --cat-1..8', () => {
        const color = colorDePersona('beto@degasa.com');
        assert.match(color, /^var\(--cat-[1-8]\)$/);
    });

    test('sin correo, cadena vacía', () => {
        assert.equal(colorDePersona(''), '');
        assert.equal(colorDePersona(undefined), '');
        assert.equal(colorDePersona(null), '');
    });

    test('correos distintos SUELEN dar colores distintos (no garantizado, pero no todos iguales)', () => {
        const correos = ['ana@x.com', 'beto@x.com', 'carla@x.com', 'diego@x.com', 'elena@x.com'];
        const colores = new Set(correos.map(colorDePersona));
        assert.ok(colores.size > 1, 'con 5 correos distintos, no deberían caer todos en el mismo tono');
    });
});

describe('textoDePersona', () => {
    test('el mismo correo da siempre el mismo texto', () => {
        assert.equal(textoDePersona('ana@degasa.com'), textoDePersona('ANA@degasa.com'));
    });

    test('solo devuelve uno de los dos tonos de texto conocidos', () => {
        const correos = ['ana@x.com', 'beto@x.com', 'carla@x.com', 'diego@x.com', 'elena@x.com', 'fer@x.com'];
        for (const c of correos) {
            assert.match(textoDePersona(c), /^#(101617|fdfdfd)$/);
        }
    });

    test('sin correo, no revienta — cae al oscuro', () => {
        assert.equal(textoDePersona(''), '#101617');
        assert.equal(textoDePersona(null), '#101617');
    });
});

describe('inicialDePersona', () => {
    test('toma la primera letra en mayúscula', () => {
        assert.equal(inicialDePersona('ana pérez'), 'A');
        assert.equal(inicialDePersona('  beto  '), 'B');
    });

    test('sin nombre ni correo, un placeholder en vez de una letra inventada', () => {
        assert.equal(inicialDePersona(''), '?');
        assert.equal(inicialDePersona(undefined), '?');
        assert.equal(inicialDePersona(null), '?');
    });
});
