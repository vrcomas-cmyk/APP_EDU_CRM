/**
 * Filtros e indicadores.
 *
 * Estos números salen en el tablero gerencial y se usan para decidir sobre personas. El
 * riesgo aquí no es que la app truene, es que muestre un número creíble y equivocado — que
 * nadie detecta. Por eso hay pruebas de COTA (nada de porcentajes imposibles) además de las
 * de valor.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    FILTRO_VACIO, filtroVacio, hayFiltro, aplicarFiltro, opcionesDeFiltro,
    calcularIndicadores, indicadoresPorEducador, top, urlEvidencia
} from '../js/datos.js';

import { visita, sector, actividad, borrador, checkIn, checkOut } from './ayuda/fixtures.js';

beforeEach(() => limpiarAlmacen());

describe('hayFiltro', () => {
    test('el filtro vacío no cuenta como filtro', () => {
        assert.equal(hayFiltro(filtroVacio()), false);
        assert.equal(hayFiltro(undefined), false);
    });

    test('cualquier campo con valor sí', () => {
        assert.equal(hayFiltro({ ...FILTRO_VACIO, hospital: 'ABC' }), true);
    });
});

describe('aplicarFiltro', () => {
    const visitas = [
        visita({ educador: 'Ana López', educador_correo: 'ana@x.com', cliente: 'C1', hospital: 'ABC',
                 dia: '2026-07-10', estado: 'finalizada',
                 sectores: [sector({ nombre: 'GASAS', actividades: [actividad({ tipo: 'Capacitación' })] })] }),
        visita({ educador: 'Beto Ruiz', educador_correo: 'beto@x.com', cliente: 'C2', hospital: 'XYZ',
                 dia: '2026-07-20', estado: 'programada',
                 sectores: [sector({ nombre: 'GUANTES', actividades: [actividad({ tipo: 'Seguimiento' })] })] }),
        visita({ educador: 'Ana López', educador_correo: 'ana@x.com', cliente: 'C1', hospital: 'ABC',
                 dia: '2026-07-15', estado: 'cancelada',
                 sectores: [
                     sector({ nombre: 'GASAS', actividades: [] }),
                     sector({ nombre: 'SUTURAS', actividades: [actividad({ tipo: 'Capacitación' })] })
                 ] })
    ];

    const filtrar = (f) => aplicarFiltro(visitas, f);

    test('sin filtro devuelve todo', () => {
        assert.equal(filtrar().length, 3);
        assert.equal(filtrar(filtroVacio()).length, 3);
    });

    test('el educador empareja por correo o por nombre', () => {
        assert.equal(filtrar({ educador: 'ana@x.com' }).length, 2);
        assert.equal(filtrar({ educador: 'Ana López' }).length, 2,
            'los datos viejos traen nombre pero no correo');
    });

    test('no distingue mayúsculas ni espacios sobrantes', () => {
        assert.equal(filtrar({ hospital: '  abc ' }).length, 2);
    });

    test('el rango de fechas incluye los extremos', () => {
        assert.equal(filtrar({ desde: '2026-07-10', hasta: '2026-07-15' }).length, 2);
        assert.equal(filtrar({ desde: '2026-07-21' }).length, 0);
    });

    test('el sector mira DENTRO del árbol', () => {
        assert.equal(filtrar({ sector: 'SUTURAS' }).length, 1,
            'debe traer la visita que trabajó suturas entre otros sectores');
        assert.equal(filtrar({ sector: 'GASAS' }).length, 2);
    });

    test('el tipo de actividad también', () => {
        assert.equal(filtrar({ tipo_actividad: 'Capacitación' }).length, 2);
    });

    test('los filtros se acumulan', () => {
        assert.equal(filtrar({ educador: 'ana@x.com', estado: 'cancelada' }).length, 1);
    });

    test('un filtro sin coincidencias devuelve vacío, no todo', () => {
        assert.equal(filtrar({ hospital: 'No Existe' }).length, 0);
    });

    test('opcionesDeFiltro saca los valores reales, ordenados y sin repetir', () => {
        const op = opcionesDeFiltro(visitas);
        assert.deepEqual(op.educadores, ['Ana López', 'Beto Ruiz']);
        assert.deepEqual(op.hospitales, ['ABC', 'XYZ']);
        assert.deepEqual(op.sectores, ['GASAS', 'GUANTES', 'SUTURAS']);
    });
});

describe('calcularIndicadores', () => {
    test('cuenta los estados por separado', () => {
        const ind = calcularIndicadores([
            visita({ estado: 'programada' }),
            visita({ estado: 'en-proceso', check_in: checkIn() }),
            visita({ estado: 'finalizada', check_in: checkIn(), check_out: checkOut() }),
            visita({ estado: 'cancelada' })
        ]);

        assert.equal(ind.visitas, 4);
        assert.equal(ind.programadas, 1);
        assert.equal(ind.en_proceso, 1);
        assert.equal(ind.finalizadas, 1);
        assert.equal(ind.canceladas, 1);
    });

    test('"realizada" es haber estado ahí, no que la hora ya pasó', () => {
        const ind = calcularIndicadores([
            visita({ dia: '2020-01-01' }),                  // hora pasada, nunca llegó
            visita({ check_in: checkIn() })                 // llegó
        ]);
        assert.equal(ind.realizadas, 1);
        assert.equal(ind.pendientes, 1);
    });

    test('el cumplimiento NUNCA pasa de 100%, ni cancelando después de llegar', () => {
        // Caso real: el educador llegó, hizo check-in, y el cliente canceló en la puerta.
        // Si esa visita contara como realizada pero se excluyera del denominador —que sí
        // excluye canceladas—, el numerador incluiría algo que el denominador no.
        const ind = calcularIndicadores([
            visita({ estado: 'finalizada', check_in: checkIn() }),
            visita({ estado: 'cancelada', check_in: checkIn() }),
            visita({ estado: 'cancelada', check_in: checkIn() })
        ]);

        assert.equal(ind.realizadas, 1, 'las canceladas no cuentan aunque tengan check-in');
        assert.equal(ind.cumplimiento, 100);
        assert.ok(ind.cumplimiento <= 100,
            'un porcentaje imposible destruye la confianza en todos los demás números');
    });

    test('sin visitas exigibles el cumplimiento es 0, no NaN ni Infinity', () => {
        const ind = calcularIndicadores([visita({ estado: 'cancelada' })]);
        assert.equal(ind.cumplimiento, 0);
        assert.ok(Number.isFinite(ind.cumplimiento));
    });

    test('una lista vacía devuelve ceros, no se cae', () => {
        const ind = calcularIndicadores([]);
        assert.equal(ind.visitas, 0);
        assert.equal(ind.cumplimiento, 0);
        assert.deepEqual(ind.por_educador, {});
    });

    test('los borradores se cuentan aparte, no como actividades', () => {
        const ind = calcularIndicadores([visita({
            check_in: checkIn(),
            sectores: [sector({ actividades: [actividad(), borrador(), borrador()] })]
        })]);

        assert.equal(ind.actividades, 1);
        assert.equal(ind.actividades_borrador, 2);
    });

    test('materiales y piezas: una cantidad no numérica no contamina la suma', () => {
        const ind = calcularIndicadores([visita({
            check_in: checkIn(),
            sectores: [sector({ actividades: [actividad({ materiales: [
                { material: 'A', cantidad: '10' },
                { material: 'B', cantidad: 5 },
                { material: 'C', cantidad: 'varias' }
            ] })] })]
        })]);

        assert.equal(ind.materiales, 3);
        assert.equal(ind.piezas, 15, '"varias" no es un número: se cuenta el material, no la pieza');
        assert.ok(Number.isFinite(ind.piezas));
    });

    test('retrasos: 15 minutos de gracia porque el tráfico existe', () => {
        const conLlegada = (hora) => visita({ hora_inicio: '09:00', check_in: checkIn(hora) });

        assert.equal(calcularIndicadores([conLlegada('09:10')]).retrasos, 0);
        assert.equal(calcularIndicadores([conLlegada('09:15')]).retrasos, 0, 'el límite exacto no es retraso');
        assert.equal(calcularIndicadores([conLlegada('09:16')]).retrasos, 1);
        assert.equal(calcularIndicadores([conLlegada('08:50')]).retrasos, 0, 'llegar temprano no es retraso');
    });

    test('sectores distintos no es lo mismo que sectores', () => {
        const ind = calcularIndicadores([
            visita({ sectores: [sector({ nombre: 'GASAS' }), sector({ nombre: 'GUANTES' })] }),
            visita({ sectores: [sector({ nombre: 'GASAS' })] })
        ]);

        assert.equal(ind.sectores, 3);
        assert.equal(ind.sectores_distintos, 2);
    });

    test('las horas efectivas salen de la permanencia real', () => {
        const ind = calcularIndicadores([
            visita({ check_in: checkIn('09:00'), check_out: checkOut('11:00') }),
            visita({ check_in: checkIn('09:00'), check_out: checkOut('10:30') })
        ]);

        assert.equal(ind.minutos_efectivos, 210);
        assert.equal(ind.horas_efectivas, 3.5);
    });
});

describe('indicadoresPorEducador', () => {
    const equipo = [
        visita({ educador: 'Ana López', educador_correo: 'ana@x.com', estado: 'finalizada',
                 check_in: checkIn('09:00'), check_out: checkOut('11:00'),
                 sectores: [sector({ actividades: [actividad()] })] }),
        visita({ educador: 'Ana López', educador_correo: 'ana@x.com', estado: 'cancelada', check_in: checkIn() }),
        visita({ educador: 'Beto Ruiz', educador_correo: 'beto@x.com', estado: 'programada' }),
        visita({ educador: 'Beto Ruiz', educador_correo: 'beto@x.com', estado: 'finalizada', check_in: checkIn() })
    ];

    test('agrupa por correo y ordena por volumen', () => {
        const filas = indicadoresPorEducador(equipo);
        assert.equal(filas.length, 2);
        assert.deepEqual(filas.map(f => f.nombre), ['Ana López', 'Beto Ruiz']);
    });

    test('tampoco aquí el cumplimiento pasa de 100%', () => {
        const ana = indicadoresPorEducador(equipo).find(f => f.correo === 'ana@x.com');

        assert.equal(ana.visitas, 2);
        assert.equal(ana.canceladas, 1);
        assert.equal(ana.realizadas, 1);
        assert.equal(ana.cumplimiento, 100);
        assert.ok(indicadoresPorEducador(equipo).every(f => f.cumplimiento <= 100));
    });

    test('quien no tiene correo se agrupa por nombre, y sin ninguno cae en un cajón visible', () => {
        const filas = indicadoresPorEducador([
            visita({ educador: 'Sin Correo', educador_correo: '' }),
            visita({ educador: '', educador_correo: '' })
        ]);

        assert.ok(filas.some(f => f.nombre === 'Sin Correo'));
        assert.ok(filas.some(f => f.nombre === '(sin educador)'),
            'esconderlas las volvería invisibles en vez de señalar el dato faltante');
    });

    test('suma actividades y evidencias pendientes por persona', () => {
        const filas = indicadoresPorEducador([
            visita({ educador_correo: 'ana@x.com', check_in: checkIn(),
                     sectores: [sector({ actividades: [
                         actividad(),
                         actividad({ evidencia: { estado: 'local' } })
                     ] })] })
        ]);

        assert.equal(filas[0].actividades, 2);
        assert.equal(filas[0].evidencias_pendientes, 1);
    });

    test('sin visitas devuelve lista vacía', () => {
        assert.deepEqual(indicadoresPorEducador([]), []);
    });
});

describe('top', () => {
    test('ordena de mayor a menor y recorta', () => {
        assert.deepEqual(top({ a: 5, b: 9, c: 1 }, 2), [['b', 9], ['a', 5]]);
    });

    test('descarta la clave vacía', () => {
        assert.deepEqual(top({ '': 99, a: 1 }), [['a', 1]]);
    });

    test('un mapa vacío o nulo no revienta', () => {
        assert.deepEqual(top({}), []);
        assert.deepEqual(top(null), []);
    });
});

describe('urlEvidencia — la única que sabe dónde vive el archivo', () => {
    test('subida devuelve la url remota', () => {
        const r = urlEvidencia(actividad({ evidencia: { estado: 'subida', url: 'https://drive/x', mime: 'image/jpeg' } }));
        assert.equal(r.tipo, 'remota');
        assert.equal(r.url, 'https://drive/x');
    });

    test('local apunta a IndexedDB por el id de la actividad', () => {
        const a = actividad({ evidencia: { estado: 'local', mime: 'image/jpeg' } });
        const r = urlEvidencia(a);
        assert.equal(r.tipo, 'local');
        assert.equal(r.id, a.id);
    });

    test('sin evidencia, o subida pero sin url, devuelve null', () => {
        assert.equal(urlEvidencia(actividad({ evidencia: undefined })), null);
        assert.equal(urlEvidencia(actividad({ evidencia: { estado: 'subida', url: '' } })), null);
        assert.equal(urlEvidencia(null), null);
    });
});
