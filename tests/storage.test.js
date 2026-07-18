/**
 * Migraciones del modelo local.
 *
 * Es la suite más importante del proyecto: corre sobre el teléfono de alguien, con datos que
 * no están en ninguna otra parte hasta que suben. Una migración que se equivoca no muestra un
 * error, muestra una visita mal — o la pierde.
 *
 * Dos propiedades se prueban en todas: que no se INVENTE información (un check-in que nadie
 * hizo, un dispositivo que nadie usó) y que sea IDEMPOTENTE (correrla dos veces no cambia
 * nada, porque el navegador puede recargar a media migración).
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    migrarSiHaceFalta, leerVisitas, guardarVisitas, obtenerVisita,
    actualizarVisita, agregarVisita, eliminarVisita,
    todasLasActividades, historialHospitales, nuevoId
} from '../js/storage.js';

import { visita, sector, actividad } from './ayuda/fixtures.js';

const sembrar = (datos) => localStorage.setItem('visitas', JSON.stringify(datos));
const todasLasActs = (v) => (v.sectores || []).flatMap(s => s.actividades || []);

beforeEach(() => limpiarAlmacen());

describe('migración v1 → v6 (filas planas)', () => {
    const filasV1 = [
        { educador: 'Ana', educador_correo: 'ana@x.com', cliente: 'C1', fecha: '2026-03-01T09:00',
          sector: 'GASAS', objetivo: 'Rotación', actividad: 'Capacitó al personal', sincronizado: true },
        { educador: 'Ana', educador_correo: 'ana@x.com', cliente: 'C1', fecha: '2026-03-01T09:00',
          sector: 'GASAS', actividad: 'Revisó anaquel', sincronizado: true },
        { educador: 'Ana', educador_correo: 'ana@x.com', cliente: 'C1', fecha: '2026-03-01T09:00',
          sector: 'GUANTES', actividad: 'Entregó muestras', sincronizado: true },
        { educador: 'Beto', educador_correo: 'beto@x.com', cliente: 'C2', fecha: '2026-03-02T14:00',
          sector: 'GASAS', actividad: 'Demostración', sincronizado: false }
    ];

    test('agrupa filas del mismo educador/cliente/fecha en una visita', () => {
        sembrar(filasV1);
        const informe = migrarSiHaceFalta();

        assert.equal(informe.desde, 1);
        assert.equal(informe.filasV1, 4);

        const visitas = leerVisitas();
        assert.equal(visitas.length, 2, '4 filas → 2 visitas');

        const primera = visitas.find(v => v.cliente === 'C1');
        assert.equal(primera.sectores.length, 2, 'GASAS y GUANTES son sectores distintos');
        assert.equal(todasLasActs(primera).length, 3);
    });

    test('una visita solo queda sincronizada si TODAS sus filas lo estaban', () => {
        sembrar([
            { educador: 'Ana', cliente: 'C1', fecha: '2026-03-01T09:00', sector: 'S', actividad: 'a', sincronizado: true },
            { educador: 'Ana', cliente: 'C1', fecha: '2026-03-01T09:00', sector: 'S', actividad: 'b', sincronizado: false }
        ]);
        migrarSiHaceFalta();

        assert.equal(leerVisitas()[0].sincronizado, false,
            'si se diera por subida, la fila capturada offline se perdería para siempre');
    });

    test('las actividades viejas no arrastran deuda de evidencia', () => {
        sembrar(filasV1);
        migrarSiHaceFalta();

        const actividades = leerVisitas().flatMap(todasLasActs);
        assert.ok(actividades.length > 0);
        assert.ok(actividades.every(a => a.evidencia?.estado === 'subida'),
            'el modelo viejo no conocía evidencias; marcarlas pendientes sería deuda imposible');
    });

    test('llega hasta v6: la fecha se parte y todo queda sellado', () => {
        sembrar(filasV1);
        migrarSiHaceFalta();

        const v = leerVisitas().find(x => x.cliente === 'C1');
        assert.equal(v.dia, '2026-03-01');
        assert.equal(v.hora_inicio, '09:00');
        assert.equal(v.hora_fin, '10:00', 'una hora por defecto cuando no se conoce la real');
        assert.equal(v.fecha, undefined, 'el campo viejo se elimina para que nadie lo lea por error');
        assert.ok(v.sectores.every(s => s.guardado), 'v6 sella los sectores');
        assert.ok(todasLasActs(v).every(a => a.guardada), 'v5 sella las actividades');
        assert.equal(Number(localStorage.getItem('modelo_version')), 6);
    });
});

describe('migración v3 → v4 (el estado pasa a ser un dato)', () => {
    const v3 = (campos = {}) => ({
        id: 'v-3', educador: 'Ana', cliente: 'C', hospital: 'H',
        dia: '2026-03-01', hora_inicio: '09:00', hora_fin: '10:00',
        sectores: [], ...campos
    });

    test('con actividades se da por finalizada, pero SIN inventar un check-in', () => {
        sembrar([v3({
            sectores: [{ id: 's1', nombre: 'GASAS', actividades: [{ id: 'a1', texto: 'algo' }] }]
        })]);
        migrarSiHaceFalta();

        const v = leerVisitas()[0];
        assert.equal(v.estado, 'finalizada');
        assert.equal(v.check_in, undefined,
            'inventar un check-in afirmaría que alguien estuvo en un lugar a una hora');
    });

    test('sin actividades queda programada', () => {
        sembrar([v3()]);
        migrarSiHaceFalta();
        assert.equal(leerVisitas()[0].estado, 'programada');
    });

    test('la bandera `cancelada` se traduce a estado y desaparece', () => {
        sembrar([v3({ cancelada: true })]);
        migrarSiHaceFalta();

        const v = leerVisitas()[0];
        assert.equal(v.estado, 'cancelada');
        assert.equal(v.cancelada, undefined);
    });

    test('los materiales de texto se vuelven registros', () => {
        sembrar([v3({
            sectores: [{ id: 's1', nombre: 'S', actividades: [
                { id: 'a1', materiales: ['GASA 10X10', { id: 'm2', material: 'YA ERA OBJETO' }] }
            ] }]
        })]);
        migrarSiHaceFalta();

        const mats = todasLasActs(leerVisitas()[0])[0].materiales;
        assert.equal(mats.length, 2);
        assert.equal(mats[0].material, 'GASA 10X10');
        assert.equal(mats[0].cantidad, '', 'no se inventa una cantidad que nadie capturó');
        assert.equal(mats[1].material, 'YA ERA OBJETO', 'lo que ya era registro no se toca');
    });

    test('folio y gerente se arrastran al origen del material en vez de perderse', () => {
        sembrar([v3({
            sectores: [{ id: 's1', nombre: 'S', actividades: [
                { id: 'a1', folio: 'F-99', gerente: 'Luis', materiales: ['GASA'] }
            ] }]
        })]);
        migrarSiHaceFalta();

        const act = todasLasActs(leerVisitas()[0])[0];
        assert.equal(act.materiales[0].origen, 'F-99 · Luis');
        assert.equal(act.folio, undefined);
        assert.equal(act.gerente, undefined);
    });
});

describe('migración v4 → v5 (sello de guardado)', () => {
    test('sella lo ya capturado sin inventar el dispositivo', () => {
        sembrar([{
            id: 'v-4', educador: 'Ana', educador_correo: 'ana@x.com', cliente: 'C',
            dia: '2026-03-01', hora_inicio: '09:00', hora_fin: '10:00', estado: 'finalizada',
            sectores: [{ id: 's1', nombre: 'S', guardado: { momento: 'x', usuario: 'Ana' },
                actividades: [{ id: 'a1', tipo: 'Capacitación', creada: '2026-03-01T09:30:00.000Z' }] }]
        }]);
        migrarSiHaceFalta();

        const sello = todasLasActs(leerVisitas()[0])[0].guardada;
        assert.ok(sello, 'lo que ya se registró no debe reaparecer como borrador editable');
        assert.equal(sello.momento, '2026-03-01T09:30:00.000Z', 'usa `creada` cuando existe');
        assert.equal(sello.usuario, 'Ana');
        assert.equal(sello.dispositivo, '',
            'no se sabe desde cuál se capturó; poner el de hoy sería un dato falso');
        assert.equal(sello.migrada, true, 'queda marcado como sello reconstruido, no original');
    });

    test('sin `creada`, el momento cae al día de la visita', () => {
        sembrar([{
            id: 'v-4b', educador: 'Ana', cliente: 'C', dia: '2026-03-01',
            hora_inicio: '09:00', hora_fin: '10:00', estado: 'finalizada',
            sectores: [{ id: 's1', nombre: 'S', guardado: { momento: 'x', usuario: 'Ana' },
                actividades: [{ id: 'a1', tipo: 'Capacitación' }] }]
        }]);
        migrarSiHaceFalta();

        assert.equal(todasLasActs(leerVisitas()[0])[0].guardada.momento, '2026-03-01T00:00:00.000Z');
    });
});

describe('migración v5 → v6 (la visita nace como borrador)', () => {
    const v5 = (campos = {}) => ({
        id: 'v-5', educador: 'Ana', cliente: 'C', dia: '2026-03-01',
        hora_inicio: '09:00', hora_fin: '10:00', estado: 'programada',
        sectores: [{ id: 's1', nombre: 'GASAS', actividades: [] }],
        ...campos
    });

    test('sella los sectores de una visita ya registrada', () => {
        sembrar([v5()]);
        migrarSiHaceFalta();

        const s = leerVisitas()[0].sectores[0];
        assert.ok(s.guardado, 'se crearon cuando la visita nacía ya registrada: son definitivos');
        assert.equal(s.guardado.migrado, true);
    });

    test('un BORRADOR conserva sus sectores editables', () => {
        sembrar([v5({ borrador: true })]);
        migrarSiHaceFalta();

        assert.equal(leerVisitas()[0].sectores[0].guardado, undefined,
            'en un borrador la falta de sello es el estado correcto, no una versión vieja');
    });
});

describe('propiedades que valen para todas las migraciones', () => {
    test('correrla dos veces no cambia nada', () => {
        sembrar([{
            id: 'v-x', educador: 'Ana', cliente: 'C', fecha: '2026-03-01T09:00',
            sectores: [{ id: 's1', nombre: 'S', actividades: [{ id: 'a1', texto: 'algo' }] }]
        }]);

        migrarSiHaceFalta();
        const despues = JSON.stringify(leerVisitas());

        const segunda = migrarSiHaceFalta();
        assert.equal(segunda, null, 'ya está al día: no hay nada que hacer');
        assert.equal(JSON.stringify(leerVisitas()), despues);
    });

    test('respalda lo anterior ANTES de tocar nada, con la versión de origen', () => {
        const original = [{ educador: 'Ana', cliente: 'C', fecha: '2026-03-01T09:00', sector: 'S', actividad: 'a' }];
        sembrar(original);
        migrarSiHaceFalta();

        assert.deepEqual(JSON.parse(localStorage.getItem('visitas_backup_v11')), original,
            'el respaldo de v1 se guarda bajo su propia clave');
    });

    test('unas visitas ilegibles no se destruyen: se dejan como están', () => {
        localStorage.setItem('visitas', '{ esto no es JSON');
        const informe = migrarSiHaceFalta();

        assert.equal(informe, null);
        assert.equal(localStorage.getItem('visitas'), '{ esto no es JSON',
            'sobrescribir datos ilegibles borraría la única copia que existe');
        assert.equal(localStorage.getItem('modelo_version'), null,
            'tampoco debe marcarse como migrado: el problema sigue ahí');
    });

    test('sin visitas solo se marca la versión', () => {
        assert.equal(migrarSiHaceFalta(), null);
        assert.equal(Number(localStorage.getItem('modelo_version')), 6);
    });

    test('una visita v6 NO se vuelve a procesar: su estado real se respeta', () => {
        // Esta es la regresión que más importa. `migrarV3aV4` recalcula el estado desde cero
        // ("¿tiene actividades? finalizada : programada"). Si corriera sobre una visita que ya
        // es v6, un `en-proceso` legítimo —con check-in y sin actividades todavía— se
        // degradaría a `programada`, y la visita en curso desaparecería de la pantalla.
        const enCurso = visita({
            estado: 'en-proceso',
            check_in: { momento: '2026-07-15T09:05:00.000Z', usuario: 'Ana' },
            sectores: [sector({ actividades: [] })]
        });
        sembrar([enCurso]);
        localStorage.setItem('modelo_version', '5');   // finge una versión atrasada

        migrarSiHaceFalta();

        assert.equal(leerVisitas()[0].estado, 'en-proceso');
        assert.ok(leerVisitas()[0].check_in, 'el check-in tampoco debe perderse');
    });
});

describe('lectura y escritura', () => {
    test('actualizarVisita marca el cambio como pendiente de subir', () => {
        const v = visita({ sincronizado: true });
        guardarVisitas([v]);

        actualizarVisita(v.id, (x) => { x.hospital = 'Otro'; });

        const guardada = obtenerVisita(v.id);
        assert.equal(guardada.hospital, 'Otro');
        assert.equal(guardada.sincronizado, false,
            'si el flag se olvida, el cambio nunca sube');
    });

    test('actualizar una visita inexistente devuelve null y no crea nada', () => {
        guardarVisitas([]);
        assert.equal(actualizarVisita('no-existe', () => {}), null);
        assert.equal(leerVisitas().length, 0);
    });

    test('agregar y eliminar', () => {
        const v = visita();
        agregarVisita(v);
        assert.equal(leerVisitas().length, 1);
        eliminarVisita(v.id);
        assert.equal(leerVisitas().length, 0);
    });

    test('localStorage corrupto devuelve lista vacía en vez de reventar la app', () => {
        localStorage.setItem('visitas', 'no-json');
        assert.deepEqual(leerVisitas(), []);
    });

    test('todasLasActividades aplana el árbol conservando su contexto', () => {
        const v = visita({ sectores: [sector({ actividades: [actividad(), actividad()] })] });
        const filas = todasLasActividades([v]);

        assert.equal(filas.length, 2);
        assert.equal(filas[0].visita.id, v.id);
        assert.equal(filas[0].sector.nombre, 'GASAS');
    });

    test('historialHospitales ordena por uso, y alfabético al empatar', () => {
        guardarVisitas([
            visita({ hospital: 'ABC' }), visita({ hospital: 'ABC' }), visita({ hospital: 'ABC' }),
            visita({ hospital: 'Zeta' }),
            visita({ hospital: 'Beta' }),
            visita({ hospital: '  ' })
        ]);

        assert.deepEqual(historialHospitales(), ['ABC', 'Beta', 'Zeta']);
    });
});

describe('nuevoId', () => {
    test('lleva prefijo y no se repite', () => {
        const ids = new Set(Array.from({ length: 500 }, () => nuevoId('v')));
        assert.equal(ids.size, 500);
        assert.ok([...ids].every(x => x.startsWith('v-')));
    });
});
