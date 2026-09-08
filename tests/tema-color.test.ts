import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    hexARgb, rgbAHex, mezclar, contraste, derivarTema, problemasDeTema
} from '@modules/administracion/services/color';

describe('conversión de color', () => {
    test('hexARgb / rgbAHex son inversas', () => {
        assert.deepEqual(hexARgb('#FF0000'), [255, 0, 0]);
        assert.equal(rgbAHex([255, 0, 0]), '#ff0000');
    });

    test('acepta hex corto', () => {
        assert.deepEqual(hexARgb('#F00'), [255, 0, 0]);
    });
});

describe('contraste WCAG', () => {
    test('negro sobre blanco es 21:1', () => {
        assert.ok(Math.abs(contraste('#000000', '#FFFFFF') - 21) < 0.1);
    });

    test('un color contra sí mismo es 1:1', () => {
        assert.ok(Math.abs(contraste('#336699', '#336699') - 1) < 0.01);
    });

    test('es simétrico (no importa el orden de los argumentos)', () => {
        assert.equal(contraste('#101617', '#F5F8F7'), contraste('#F5F8F7', '#101617'));
    });
});

describe('mezclar', () => {
    test('0% da el primer color, 100% da el segundo', () => {
        assert.equal(mezclar('#000000', '#FFFFFF', 0), '#000000');
        assert.equal(mezclar('#000000', '#FFFFFF', 1), '#ffffff');
    });
});

describe('derivarTema — los 3 temas base pasan sus propias reglas', () => {
    // Mismos hex que style.css. Si un tema base ya construido a mano no pasa esta validación,
    // la validación está mal calibrada, no el tema — por eso esta prueba es una red de
    // seguridad RETROACTIVA, no solo para temas nuevos.
    test('claro', () => {
        const problemas = problemasDeTema({ modo: 'claro', paper: '#F5F8F7', ink: '#101617' });
        const errores = problemas.filter(p => p.nivel === 'error');
        assert.deepEqual(errores, [], JSON.stringify(errores));
    });

    test('oscuro', () => {
        const problemas = problemasDeTema({ modo: 'oscuro', paper: '#0D1112', ink: '#E9EEEC' });
        const errores = problemas.filter(p => p.nivel === 'error');
        assert.deepEqual(errores, [], JSON.stringify(errores));
    });

    test('degasa (modo claro con marca)', () => {
        const problemas = problemasDeTema({ modo: 'claro', paper: '#F7F9F1', ink: '#17301C' });
        const errores = problemas.filter(p => p.nivel === 'error');
        assert.deepEqual(errores, [], JSON.stringify(errores));
    });
});

describe('derivarTema — no toca estado ni categorías', () => {
    test('los 4 colores de estado son los del modo, sin importar papel/tinta', () => {
        const t = derivarTema({ modo: 'claro', paper: '#EEEEEE', ink: '#222222' });
        assert.equal(t['--st-miss'], '#C81E3A');
        assert.equal(t['--st-done'], '#1F8A54');
    });

    test('la paleta categórica es igual en claro y oscuro (por diseño)', () => {
        const claro = derivarTema({ modo: 'claro', paper: '#FFFFFF', ink: '#000000' });
        const oscuro = derivarTema({ modo: 'oscuro', paper: '#000000', ink: '#FFFFFF' });
        assert.equal(claro['--cat-1'], oscuro['--cat-1']);
    });
});

describe('problemasDeTema — detecta lo que ya rompió esta app una vez', () => {
    test('REQUISITO: un texto casi invisible sobre su fondo se bloquea', () => {
        // El mismo tipo de bug que "encabezados de fin de semana" (auditoría UI/UX):
        // un color de texto casi igual al fondo.
        const problemas = problemasDeTema({ modo: 'claro', paper: '#0D1112', ink: '#141A1B' });
        const bloquea = problemas.some(p => p.nivel === 'error');
        assert.ok(bloquea, 'un tema con texto casi invisible debe bloquearse, no solo advertirse');
    });

    test('modo claro con papel oscuro se rechaza', () => {
        const problemas = problemasDeTema({ modo: 'claro', paper: '#0D1112', ink: '#FFFFFF' });
        assert.ok(problemas.some(p => p.nivel === 'error' && /modo claro/.test(p.mensaje)));
    });

    test('un tema bien construido no tiene errores', () => {
        const problemas = problemasDeTema({ modo: 'claro', paper: '#FFFFFF', ink: '#111111' });
        assert.deepEqual(problemas.filter(p => p.nivel === 'error'), []);
    });
});
