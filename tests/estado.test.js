/**
 * Salud del registro y cálculos de tiempo.
 *
 * Lo que más se cuida aquí es la distinción entre ESTADO (un dato) y SALUD (un cálculo), y
 * que un borrador no cuente como trabajo registrado: pintar una visita de verde por una
 * actividad a medio escribir afirmaría algo que todavía no ocurrió.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    SALUD, ESTADOS, saludDe, detalleEstado, estadoDe,
    actividadesGuardadasDe, evidenciasPendientesDe, deudaGlobal,
    permanenciaMinutos, duracionHoras, seSolapan, repartirEnColumnas,
    estadoSector, SECTOR
} from '../js/estado.js';

import { visita, sector, actividad, borrador, checkIn, checkOut, visitaCompleta } from './ayuda/fixtures.js';

beforeEach(() => limpiarAlmacen());

describe('saludDe — el color se gana con el check-in', () => {
    test('sin check-in es neutra, aunque la hora ya haya pasado', () => {
        const v = visita({ dia: '2020-01-01' });
        assert.equal(saludDe(v), SALUD.NEUTRA);
    });

    test('con check-in y sin actividades es "sin registrar"', () => {
        const v = visita({ estado: ESTADOS.EN_PROCESO, check_in: checkIn() });
        assert.equal(saludDe(v), SALUD.SIN_REGISTRAR);
    });

    test('un BORRADOR no da color verde: no es trabajo registrado', () => {
        const v = visita({
            estado: ESTADOS.EN_PROCESO,
            check_in: checkIn(),
            sectores: [sector({ actividades: [borrador()] })]
        });
        assert.equal(saludDe(v), SALUD.SIN_REGISTRAR);
    });

    test('actividad sellada con evidencia subida es completa', () => {
        assert.equal(saludDe(visitaCompleta()), SALUD.COMPLETA);
    });

    test('falta la evidencia de un tipo que la exige → azul', () => {
        const v = visitaCompleta({
            sectores: [sector({
                actividades: [actividad({ evidencia: { estado: 'local' } })]
            })]
        });
        assert.equal(saludDe(v), SALUD.FALTAN_EVIDENCIAS);
    });

    test('cancelada no gasta color, aunque tenga check-in y actividades', () => {
        const v = visitaCompleta({ estado: ESTADOS.CANCELADA });
        assert.equal(saludDe(v), SALUD.CANCELADA);
    });
});

describe('detalleEstado — el color nunca va solo', () => {
    test('distingue "sin actividades" de "N sin guardar"', () => {
        const vacia = visita({ estado: ESTADOS.EN_PROCESO, check_in: checkIn() });
        assert.match(detalleEstado(vacia), /sin actividades/);

        const conBorrador = visita({
            estado: ESTADOS.EN_PROCESO,
            check_in: checkIn(),
            sectores: [sector({ actividades: [borrador(), borrador()] })]
        });
        assert.match(detalleEstado(conBorrador), /2 sin guardar/);
    });

    test('la cancelación muestra su motivo cuando lo hay', () => {
        const v = visita({ estado: ESTADOS.CANCELADA, motivo_cancelacion: 'Cliente no disponible' });
        assert.equal(detalleEstado(v), 'Cancelada · Cliente no disponible');
    });

    test('singular y plural, porque se lee en pantalla', () => {
        const una = visitaCompleta({
            sectores: [sector({ actividades: [actividad({ evidencia: { estado: 'local' } })] })]
        });
        assert.match(detalleEstado(una), /falta 1 evidencia\b/);

        const dos = visitaCompleta({
            sectores: [sector({
                actividades: [
                    actividad({ evidencia: { estado: 'local' } }),
                    actividad({ evidencia: { estado: 'local' } })
                ]
            })]
        });
        assert.match(detalleEstado(dos), /faltan 2 evidencias/);
    });
});

describe('deuda de evidencias', () => {
    test('un tipo que no exige evidencia nunca genera deuda', () => {
        const v = visitaCompleta({
            sectores: [sector({
                actividades: [actividad({ tipo: 'Revisión de anaquel', evidencia: { estado: 'local' } })]
            })]
        });
        assert.equal(evidenciasPendientesDe(v).length, 0,
            'pedir evidencia de un tipo que no la exige es deuda imposible de saldar');
    });

    test('los borradores no generan deuda', () => {
        const v = visitaCompleta({
            sectores: [sector({ actividades: [borrador({ evidencia: { estado: 'local' } })] })]
        });
        assert.equal(evidenciasPendientesDe(v).length, 0);
    });

    test('deudaGlobal ignora canceladas y visitas sin check-in', () => {
        const pendiente = (extra) => visita({
            sectores: [sector({ actividades: [actividad({ evidencia: { estado: 'local' } })] })],
            ...extra
        });

        const visitas = [
            pendiente({ check_in: checkIn(), estado: ESTADOS.EN_PROCESO }),   // cuenta
            pendiente({ check_in: checkIn(), estado: ESTADOS.CANCELADA }),    // no
            pendiente({})                                                     // no: sin check-in
        ];
        assert.equal(deudaGlobal(visitas).length, 1);
    });
});

describe('tiempo', () => {
    test('permanencia real se mide del check-in al check-out', () => {
        const v = visitaCompleta({ check_in: checkIn('09:00'), check_out: checkOut('11:06') });
        assert.equal(permanenciaMinutos(v), 126);
    });

    test('sin check-out no hay permanencia; no se inventa', () => {
        const v = visitaCompleta({ check_out: undefined });
        assert.equal(permanenciaMinutos(v), null);
    });

    test('un check-out anterior al check-in devuelve null, no un negativo', () => {
        const v = visitaCompleta({ check_in: checkIn('11:00'), check_out: checkOut('09:00') });
        assert.equal(permanenciaMinutos(v), null,
            'un negativo se propagaría a las horas efectivas del tablero');
    });

    test('la duración planeada tiene un piso, para que la tarjeta sea visible', () => {
        const v = visita({ hora_inicio: '09:00', hora_fin: '09:00' });
        assert.equal(duracionHoras(v), 0.25);
    });
});

describe('solapamientos', () => {
    const enHoras = (ini, fin) => visita({ hora_inicio: ini, hora_fin: fin });

    test('tocarse exactamente no es conflicto', () => {
        assert.equal(seSolapan(enHoras('09:00', '10:00'), enHoras('10:00', '11:00')), false,
            'agenda apretada no es doble reserva');
    });

    test('días distintos nunca se solapan', () => {
        const a = enHoras('09:00', '11:00');
        const b = visita({ dia: '2026-07-16', hora_inicio: '09:00', hora_fin: '11:00' });
        assert.equal(seSolapan(a, b), false);
    });

    test('el grupo es una CADENA: A pisa a B, B pisa a C → las tres comparten ancho', () => {
        // A y C no se tocan entre sí, así que pueden COMPARTIR columna: van a distinta altura
        // y no se estorban. Lo que la transitividad garantiza es el ANCHO: si C formara su
        // propio grupo, saldría con columnas:1 —a todo lo ancho— y taparía a B, que sí lo pisa.
        const a = enHoras('09:00', '10:30');
        const b = enHoras('10:00', '11:30');
        const c = enHoras('11:00', '12:00');

        const reparto = repartirEnColumnas([a, b, c]);
        const de = (v) => reparto.find(r => r.visita === v);

        assert.equal(reparto.length, 3);
        assert.ok(reparto.every(r => r.columnas === 2),
            'las tres pertenecen al mismo grupo, así que miden lo mismo');
        assert.notEqual(de(a).columna, de(b).columna, 'A y B se pisan: no pueden compartir columna');
        assert.notEqual(de(b).columna, de(c).columna, 'B y C se pisan: no pueden compartir columna');
        assert.equal(de(a).columna, de(c).columna,
            'A y C no se pisan: reutilizar la columna es lo correcto, no un error');
    });

    test('visitas que no se pisan comparten la columna 0', () => {
        const reparto = repartirEnColumnas([enHoras('09:00', '10:00'), enHoras('11:00', '12:00')]);
        assert.ok(reparto.every(r => r.columna === 0 && r.columnas === 1));
    });
});

describe('estado del sector — se deriva, no se marca a mano', () => {
    test('sin actividades está pendiente', () => {
        assert.equal(estadoSector(visita(), sector()), SECTOR.PENDIENTE);
    });

    test('con actividades y visita en proceso, en proceso', () => {
        const s = sector({ actividades: [actividad()] });
        assert.equal(estadoSector(visita({ estado: ESTADOS.EN_PROCESO }), s), SECTOR.EN_PROCESO);
    });

    test('con actividades y visita finalizada, finalizado', () => {
        const s = sector({ actividades: [actividad()] });
        assert.equal(estadoSector(visita({ estado: ESTADOS.FINALIZADA }), s), SECTOR.FINALIZADO);
    });
});

describe('estadoDe', () => {
    test('sin estado explícito, programada', () => {
        assert.equal(estadoDe({}), ESTADOS.PROGRAMADA);
    });

    test('un estado desconocido se respeta en vez de normalizarse', () => {
        assert.equal(estadoDe({ estado: 'pausada' }), 'pausada',
            'el estado es una cadena abierta: agregar uno no debe obligar a tocar esta lógica');
    });
});

describe('actividadesGuardadasDe', () => {
    test('separa selladas de borradores', () => {
        const v = visita({ sectores: [sector({ actividades: [actividad(), borrador(), actividad()] })] });
        assert.equal(actividadesGuardadasDe(v).length, 2);
    });

    test('atraviesa varios sectores', () => {
        const v = visita({
            sectores: [
                sector({ actividades: [actividad()] }),
                sector({ nombre: 'GUANTES', actividades: [actividad(), actividad()] })
            ]
        });
        assert.equal(actividadesGuardadasDe(v).length, 3);
    });
});
