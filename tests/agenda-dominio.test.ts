/**
 * La matemática del calendario.
 *
 * Vivía dentro de manejadores de puntero, entrelazada con `getBoundingClientRect` y una
 * variable de módulo, así que no había forma de ejercitarla sin un navegador. Sacarla es lo
 * que permitió encontrar el bug del borde inferior, que llevaba ahí desde que existe la
 * rejilla y solo se manifiesta en la última media hora del día visible.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    HORA_MIN, HORA_MAX, calcularVentana, altoDeVentana, yAHora,
    horaADecimal, decimalAHora, redondearMedia, ajustarAMedia, type Ventana
} from '@modules/agenda/services/ventana';

import {
    rangoDeCreacion, rangoDeMovimiento, nuevoFinPorRedimension, esArrastre
} from '@modules/agenda/services/arrastre';

const jornada: Ventana = { desde: HORA_MIN, hasta: HORA_MAX };
const enHoras = (h: number, m = 0) => new Date(2026, 6, 15, h, m);

describe('calcularVentana', () => {
    test('sin visitas usa la jornada normal', () => {
        assert.deepEqual(calcularVentana([]), { desde: 7, hasta: 19 });
    });

    test('se estira hacia arriba para que quepa una visita temprana', () => {
        const v = calcularVentana([{ inicio: enHoras(6, 15), fin: enHoras(7, 30) }]);
        assert.equal(v.desde, 6,
            'una visita fuera del lienzo simplemente no se ve: se daría por perdida');
    });

    test('se estira hacia abajo para una visita tardía', () => {
        const v = calcularVentana([{ inicio: enHoras(20, 0), fin: enHoras(21, 30) }]);
        assert.equal(v.hasta, 22, 'se redondea hacia arriba para que la tarjeta quepa entera');
    });

    test('nunca se encoge por debajo de la jornada normal', () => {
        const v = calcularVentana([{ inicio: enHoras(10, 0), fin: enHoras(11, 0) }]);
        assert.deepEqual(v, { desde: HORA_MIN, hasta: HORA_MAX });
    });

    test('la línea de ahora también tiene que caber', () => {
        const v = calcularVentana([], enHoras(22, 0));
        assert.ok(v.hasta >= 23);
    });

    test('no se sale de las 24 horas del día', () => {
        const v = calcularVentana([{ inicio: enHoras(23, 0), fin: enHoras(23, 59) }]);
        assert.ok(v.hasta <= 24);
        assert.ok(v.desde >= 0);
    });

    test('siempre tiene al menos una hora de alto', () => {
        assert.ok(altoDeVentana(calcularVentana([])) >= 1);
    });

    test('una visita sin horas no rompe el cálculo', () => {
        assert.deepEqual(calcularVentana([{ inicio: null, fin: null }]), { desde: 7, hasta: 19 });
    });
});

describe('conversiones', () => {
    test('píxel → hora dentro de la ventana', () => {
        const rect = { top: 0, height: 1200 };   // 12 horas → 100px cada una
        assert.equal(yAHora(0, rect, jornada), 7);
        assert.equal(yAHora(600, rect, jornada), 13);
        assert.equal(yAHora(1200, rect, jornada), 19);
    });

    test('una altura de cero no produce NaN ni Infinity', () => {
        const h = yAHora(50, { top: 0, height: 0 }, jornada);
        assert.equal(h, 7);
        assert.ok(Number.isFinite(h), 'un NaN aquí se propagaría a la hora de la visita creada');
    });

    test('hora ↔ decimal, ida y vuelta', () => {
        assert.equal(horaADecimal('09:30'), 9.5);
        assert.equal(decimalAHora(9.5), '09:30');
        assert.equal(horaADecimal(undefined), 0);
    });

    test('el decimal se acota al día', () => {
        assert.equal(decimalAHora(-1), '00:00');
        assert.equal(decimalAHora(30), '24:00');
    });

    test('redondearMedia va a la media hora más cercana', () => {
        assert.equal(redondearMedia(9.2), 9);
        assert.equal(redondearMedia(9.3), 9.5);
        assert.equal(redondearMedia(9.8), 10);
    });
});

describe('ajustarAMedia — el extremo importa', () => {
    test('un INICIO no puede caer en la última media hora', () => {
        assert.equal(ajustarAMedia(19, jornada), '18:30',
            'no quedaría espacio para la visita');
    });

    test('un FIN sí puede llegar al borde de la ventana', () => {
        assert.equal(ajustarAMedia(19, jornada, { esFin: true }), '19:00');
    });

    test('ambos se acotan por abajo al inicio de la ventana', () => {
        assert.equal(ajustarAMedia(3, jornada), '07:00');
        assert.equal(ajustarAMedia(3, jornada, { esFin: true }), '07:00');
    });

    test('redondea a la media hora', () => {
        assert.equal(ajustarAMedia(9.2, jornada), '09:00');
        assert.equal(ajustarAMedia(9.4, jornada), '09:30');
    });
});

describe('rangoDeCreacion', () => {
    test('un arrastre normal da el rango arrastrado', () => {
        assert.deepEqual(rangoDeCreacion(9, 11, jornada), { inicio: '09:00', fin: '11:00' });
    });

    test('arrastrar hacia ARRIBA funciona igual', () => {
        assert.deepEqual(rangoDeCreacion(11, 9, jornada), { inicio: '09:00', fin: '11:00' },
            'nadie decide el sentido del gesto antes de empezarlo');
    });

    test('un arrastre mínimo da media hora, no cero', () => {
        const r = rangoDeCreacion(9, 9.05, jornada);
        assert.equal(r.inicio, '09:00');
        assert.equal(r.fin, '09:30');
    });

    test('REGRESIÓN: contra el borde inferior el rango NO sale invertido', () => {
        // El calendario anterior acotaba inicio y fin con el mismo tope (`hasta - 1`), así que
        // arrastrar de 18:30 a 19:00 con la rejilla hasta las 19:00 devolvía inicio 18:30 y
        // fin 18:00. La visita nacía con la hora de término ANTES que la de inicio, y nada en
        // el formulario impedía guardarla así.
        const r = rangoDeCreacion(18.5, 19, jornada);

        assert.ok(r.fin > r.inicio,
            `rango invertido: ${r.inicio}–${r.fin}`);
        assert.deepEqual(r, { inicio: '18:30', fin: '19:00' });
    });

    test('el rango nunca se invierte, en ningún punto de la rejilla', () => {
        // Barrido completo en pasos de un cuarto de hora, en los dos sentidos.
        for (let a = jornada.desde; a <= jornada.hasta; a += 0.25) {
            for (let b = jornada.desde; b <= jornada.hasta; b += 0.25) {
                const r = rangoDeCreacion(a, b, jornada);
                assert.ok(r.fin > r.inicio,
                    `arrastre ${a}→${b} produjo ${r.inicio}–${r.fin}`);
            }
        }
    });

    test('tampoco se invierte en una ventana estirada', () => {
        const ancha: Ventana = { desde: 6, hasta: 22 };
        for (let a = ancha.desde; a <= ancha.hasta; a += 0.5) {
            const r = rangoDeCreacion(a, ancha.hasta, ancha);
            assert.ok(r.fin > r.inicio, `arrastre ${a}→${ancha.hasta}: ${r.inicio}–${r.fin}`);
        }
    });
});

describe('rangoDeMovimiento — conserva la duración', () => {
    const altoHora = 46;

    test('bajar una hora corre la visita una hora', () => {
        assert.deepEqual(
            rangoDeMovimiento('09:00', 2, altoHora, altoHora),
            { inicio: '10:00', fin: '12:00' }
        );
    });

    test('subir también', () => {
        assert.deepEqual(
            rangoDeMovimiento('09:00', 2, -altoHora, altoHora),
            { inicio: '08:00', fin: '10:00' }
        );
    });

    test('sin desplazamiento no cambia nada', () => {
        assert.deepEqual(
            rangoDeMovimiento('09:00', 1.5, 0, altoHora),
            { inicio: '09:00', fin: '10:30' }
        );
    });

    test('se ajusta a la media hora más cercana', () => {
        const r = rangoDeMovimiento('09:00', 1, altoHora * 0.4, altoHora);
        assert.equal(r.inicio, '09:30');
    });

    test('mover NUNCA cambia la duración', () => {
        for (const px of [-200, -46, 0, 23, 46, 300]) {
            const r = rangoDeMovimiento('09:00', 2, px, altoHora);
            const dur = horaADecimal(r.fin) - horaADecimal(r.inicio);
            assert.equal(dur, 2, `con ${px}px la duración cambió a ${dur}`);
        }
    });
});

describe('nuevoFinPorRedimension', () => {
    const altoHora = 46;

    test('estirar hacia abajo alarga la visita', () => {
        const r = nuevoFinPorRedimension('09:00', 1, altoHora, altoHora);
        assert.equal(r.fin, '11:00');
        assert.equal(r.duracionH, 2);
    });

    test('encoger la acorta', () => {
        const r = nuevoFinPorRedimension('09:00', 2, -altoHora, altoHora);
        assert.equal(r.fin, '10:00');
    });

    test('nunca baja de media hora, por mucho que se arrastre hacia arriba', () => {
        const r = nuevoFinPorRedimension('09:00', 2, -altoHora * 10, altoHora);

        assert.equal(r.duracionH, 0.5);
        assert.equal(r.fin, '09:30',
            'una tarjeta de altura cero deja de poder agarrarse: la visita sería inalcanzable');
    });

    test('el fin siempre queda después del inicio', () => {
        for (const px of [-500, -100, -46, -1, 0, 46, 500]) {
            const r = nuevoFinPorRedimension('09:00', 1, px, altoHora);
            assert.ok(r.fin > '09:00', `con ${px}px el fin quedó en ${r.fin}`);
        }
    });
});

describe('esArrastre', () => {
    test('un temblor no es un gesto', () => {
        assert.equal(esArrastre(1, 2, 4), false);
    });

    test('el movimiento cuenta en diagonal, no solo en vertical', () => {
        assert.equal(esArrastre(3, 3, 4), true, 'hipotenusa 4.24');
    });

    test('el umbral exacto ya cuenta', () => {
        assert.equal(esArrastre(0, 4, 4), true);
    });
});
