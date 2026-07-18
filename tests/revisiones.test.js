/**
 * Flujos de revisión.
 *
 * Lo central: el estado no vive en la visita sino en la pareja (flujo, elemento), el registro
 * es append-only, y "el vigente" tiene que ser DETERMINISTA — de eso depende lo que el
 * revisor ve en pantalla.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    RESULTADOS, FLUJOS_POR_DEFECTO,
    ponerFlujos, ponerRevisiones, olvidarRevisiones, todosLosFlujos,
    historialDe, revisionVigente, estaPendiente, revisionesDeVisita,
    minutosDeRetraso, revisar, pendientesDeSubir, marcarSincronizadas,
    flujosDisponibles, puedeRevisar, pendientesDe, conteoPendientes
} from '../js/revisiones.js';

import { olvidarPerfil } from '../js/permisos.js';
import { visita, sector, actividad, borrador, checkIn } from './ayuda/fixtures.js';

/**
 * Instala un perfil desde la caché, sin red: es lo que hace la app al arrancar offline.
 *
 * La sesión también se siembra, y no es un detalle del stub: el caché SOLO se aplica si su
 * correo coincide con el de la sesión abierta. Sin eso, el perfil cacheado de un gerente se
 * aplicaría al siguiente que entrara en el mismo teléfono.
 */
function comoUsuario({ admin = false, permisos = [], correo = 'quien@x.com' } = {}) {
    olvidarPerfil();
    localStorage.setItem('sesion', JSON.stringify({
        correo, nombre: 'Quien Revisa', id_token: 'falso', expira: Date.now() + 3600e3
    }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo, nombre: 'Quien Revisa', rol: admin ? 'admin' : 'revisor',
        es_admin: admin, permisos, alcance: [correo],
        invitado: true, invitacion_estado: 'aceptada', origen: 'prueba'
    }));
}

const rev = (campos) => ({
    id: `rv-${Math.random()}`, flujo: 'evidencia', ambito: 'actividad',
    id_ambito: 'a-1', id_visita: 'v-1', resultado: RESULTADOS.APROBADO,
    observaciones: '', revisor: 'R', revisor_correo: 'r@x.com',
    momento: '2026-07-15T10:00:00.000Z', seq: 1, ...campos
});

beforeEach(() => {
    limpiarAlmacen();
    olvidarRevisiones();
    olvidarPerfil();
});

describe('estado vigente y pendientes', () => {
    test('sin revisiones, todo está pendiente', () => {
        assert.equal(revisionVigente('evidencia', 'a-1'), null);
        assert.equal(estaPendiente('evidencia', 'a-1'), true);
    });

    test('aprobado sale de la cola', () => {
        ponerRevisiones([rev({ resultado: RESULTADOS.APROBADO })]);
        assert.equal(estaPendiente('evidencia', 'a-1'), false);
    });

    test('"requiere corrección" SÍ vuelve a la cola', () => {
        ponerRevisiones([rev({ resultado: RESULTADOS.CORRECCION })]);
        assert.equal(estaPendiente('evidencia', 'a-1'), true,
            'se pidió corregir: alguien tiene que volver a mirarlo');
    });

    test('"rechazado" NO vuelve a la cola', () => {
        ponerRevisiones([rev({ resultado: RESULTADOS.RECHAZADO })]);
        assert.equal(estaPendiente('evidencia', 'a-1'), false,
            'ya se decidió; reaparecer obligaría a rechazar lo mismo cada vez');
    });

    test('los flujos son INDEPENDIENTES entre sí', () => {
        ponerRevisiones([rev({ flujo: 'evidencia', resultado: RESULTADOS.APROBADO })]);

        assert.equal(estaPendiente('evidencia', 'a-1'), false);
        assert.equal(estaPendiente('documentacion', 'a-1'), true,
            'quien revisa la foto no es quien juzga la captura: no deben pisarse');
    });

    test('los elementos son independientes entre sí', () => {
        ponerRevisiones([rev({ id_ambito: 'a-1' })]);
        assert.equal(estaPendiente('evidencia', 'a-2'), true);
    });
});

describe('el vigente es DETERMINISTA aunque compartan momento', () => {
    test('con el mismo momento, desempata el secuencial', () => {
        // Dentro de una transacción `now()` es constante: un lote subido junto comparte
        // `momento`. Sin el desempate, "la más reciente" sale al azar y el revisor ve un
        // estado distinto en cada recarga.
        const momento = '2026-07-15T10:00:00.000Z';
        ponerRevisiones([
            rev({ momento, seq: 1, resultado: RESULTADOS.RECHAZADO }),
            rev({ momento, seq: 2, resultado: RESULTADOS.CORRECCION }),
            rev({ momento, seq: 3, resultado: RESULTADOS.APROBADO })
        ]);

        assert.equal(revisionVigente('evidencia', 'a-1').resultado, RESULTADOS.APROBADO);
    });

    test('el orden de llegada del arreglo no cambia el resultado', () => {
        const momento = '2026-07-15T10:00:00.000Z';
        const lote = [
            rev({ momento, seq: 3, resultado: RESULTADOS.APROBADO }),
            rev({ momento, seq: 1, resultado: RESULTADOS.RECHAZADO }),
            rev({ momento, seq: 2, resultado: RESULTADOS.CORRECCION })
        ];
        ponerRevisiones(lote);

        assert.equal(revisionVigente('evidencia', 'a-1').resultado, RESULTADOS.APROBADO,
            'el servidor puede devolverlas en cualquier orden');
    });

    test('el momento manda sobre el secuencial', () => {
        ponerRevisiones([
            rev({ momento: '2026-07-16T10:00:00.000Z', seq: 1, resultado: RESULTADOS.APROBADO }),
            rev({ momento: '2026-07-15T10:00:00.000Z', seq: 99, resultado: RESULTADOS.RECHAZADO })
        ]);

        assert.equal(revisionVigente('evidencia', 'a-1').resultado, RESULTADOS.APROBADO);
    });

    test('el historial se conserva completo y en orden', () => {
        ponerRevisiones([
            rev({ momento: '2026-07-15T10:00:00.000Z', seq: 1, resultado: RESULTADOS.RECHAZADO }),
            rev({ momento: '2026-07-16T10:00:00.000Z', seq: 2, resultado: RESULTADOS.CORRECCION }),
            rev({ momento: '2026-07-17T10:00:00.000Z', seq: 3, resultado: RESULTADOS.APROBADO })
        ]);

        assert.deepEqual(
            historialDe('evidencia', 'a-1').map(r => r.resultado),
            [RESULTADOS.RECHAZADO, RESULTADOS.CORRECCION, RESULTADOS.APROBADO],
            'rechazado → corregido → aprobado dice algo que "aprobado" solo, no'
        );
    });
});

describe('la cola local se mezcla con lo del servidor', () => {
    beforeEach(() => comoUsuario({ admin: true }));

    test('lo recién revisado sin señal ya cuenta como vigente', () => {
        ponerRevisiones([rev({ resultado: RESULTADOS.CORRECCION })]);

        const r = revisar({
            flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1', idVisita: 'v-1',
            resultado: RESULTADOS.APROBADO
        });

        assert.equal(r.ok, true);
        assert.equal(revisionVigente('evidencia', 'a-1').resultado, RESULTADOS.APROBADO,
            'una cola invisible haría que el revisor revisara dos veces lo mismo');
        assert.equal(estaPendiente('evidencia', 'a-1'), false);
    });

    test('se saca de la cola al confirmarse', () => {
        const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-9',
                            idVisita: 'v-1', resultado: RESULTADOS.APROBADO });

        assert.equal(pendientesDeSubir().length, 1);
        marcarSincronizadas([r.revision.id]);
        assert.equal(pendientesDeSubir().length, 0);
    });

    test('una cola ilegible no impide seguir revisando', () => {
        localStorage.setItem('revisiones_pendientes', 'no-json');
        assert.deepEqual(pendientesDeSubir(), []);
    });

    test('revisionesDeVisita junta todos los flujos de una visita', () => {
        ponerRevisiones([
            rev({ flujo: 'evidencia', id_visita: 'v-1' }),
            rev({ flujo: 'calidad_visita', ambito: 'visita', id_ambito: 'v-1', id_visita: 'v-1' }),
            rev({ flujo: 'evidencia', id_visita: 'v-2' })
        ]);

        assert.equal(revisionesDeVisita('v-1').length, 2);
    });
});

describe('revisar — validaciones', () => {
    test('sin permiso en ese flujo, se rechaza', () => {
        comoUsuario({ permisos: ['visitas.consultar'] });

        const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1',
                            idVisita: 'v-1', resultado: RESULTADOS.APROBADO });

        assert.equal(r.ok, false);
        assert.match(r.error, /permiso/i);
        assert.equal(pendientesDeSubir().length, 0, 'no debe quedar nada encolado');
    });

    test('un flujo inexistente se rechaza', () => {
        comoUsuario({ admin: true });
        const r = revisar({ flujo: 'inventado', ambito: 'visita', idAmbito: 'v-1',
                            idVisita: 'v-1', resultado: RESULTADOS.APROBADO });
        assert.equal(r.ok, false);
    });

    test('un resultado inválido se rechaza', () => {
        comoUsuario({ admin: true });
        const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1',
                            idVisita: 'v-1', resultado: 'mas_o_menos' });
        assert.equal(r.ok, false);
    });

    test('rechazar sin explicar por qué se bloquea', () => {
        comoUsuario({ admin: true });

        for (const resultado of [RESULTADOS.RECHAZADO, RESULTADOS.CORRECCION]) {
            const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1',
                                idVisita: 'v-1', resultado, observaciones: '   ' });
            assert.equal(r.ok, false, `${resultado} sin observaciones debe bloquearse`);
            assert.match(r.error, /corregir/i);
        }
    });

    test('aprobar no exige observaciones', () => {
        comoUsuario({ admin: true });
        const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1',
                            idVisita: 'v-1', resultado: RESULTADOS.APROBADO });
        assert.equal(r.ok, true);
    });

    test('la revisión guarda quién y cuándo', () => {
        comoUsuario({ admin: true });
        const r = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-1',
                            idVisita: 'v-1', resultado: RESULTADOS.APROBADO });

        assert.ok(r.revision.momento, 'sin momento no habría forma de ordenar el historial');
        assert.equal(r.revision.sincronizado, false);
    });
});

describe('flujos disponibles según permiso', () => {
    test('un educador no revisa nada', () => {
        comoUsuario({ permisos: ['visitas.crear', 'visitas.consultar'] });
        assert.deepEqual(flujosDisponibles(), []);
        assert.equal(puedeRevisar(), false);
    });

    test('un permiso concreto abre exactamente su flujo', () => {
        comoUsuario({ permisos: ['evidencias.aprobar'] });

        const flujos = flujosDisponibles();
        assert.equal(flujos.length, 1);
        assert.equal(flujos[0].clave, 'evidencia');
    });

    test('el administrador los ve todos', () => {
        comoUsuario({ admin: true });
        assert.equal(flujosDisponibles().length, FLUJOS_POR_DEFECTO.length);
    });

    test('ponerFlujos sustituye la lista, pero una vacía no la borra', () => {
        ponerFlujos([{ clave: 'x', nombre: 'X', ambito: 'visita', permiso: 'a.b', orden: 1 }]);
        assert.equal(todosLosFlujos().length, 1);

        ponerFlujos([]);
        assert.equal(todosLosFlujos().length, 1,
            'una respuesta vacía del servidor no debe dejar la app sin flujos');
    });
});

describe('minutosDeRetraso', () => {
    const conLlegada = (hora) => visita({ hora_inicio: '09:00', check_in: checkIn(hora) });

    test('dentro de la gracia devuelve 0', () => {
        assert.equal(minutosDeRetraso(conLlegada('09:15')), 0);
    });

    test('pasada la gracia devuelve los minutos reales, no los excedentes', () => {
        assert.equal(minutosDeRetraso(conLlegada('09:40')), 40);
    });

    test('sin check-in no hay retraso que juzgar', () => {
        assert.equal(minutosDeRetraso(visita()), 0);
    });

    test('un momento corrupto devuelve 0 en vez de NaN', () => {
        const v = visita({ hora_inicio: '09:00', check_in: { momento: 'no-es-fecha' } });
        assert.equal(minutosDeRetraso(v), 0);
        assert.ok(Number.isFinite(minutosDeRetraso(v)));
    });
});

describe('qué entra a cada flujo', () => {
    beforeEach(() => comoUsuario({ admin: true }));

    const flujo = (clave) => FLUJOS_POR_DEFECTO.find(f => f.clave === clave);

    test('una visita cancelada no entra a ningún flujo', () => {
        const v = visita({ estado: 'cancelada', check_in: checkIn(),
                           sectores: [sector({ actividades: [actividad()] })] });

        for (const f of FLUJOS_POR_DEFECTO) {
            assert.equal(pendientesDe(f, [v]).length, 0, `${f.clave} no debe pedir revisar lo que no ocurrió`);
        }
    });

    test('una visita sin check-in no se juzga todavía', () => {
        const v = visita({ sectores: [sector({ actividades: [actividad()] })] });
        assert.equal(pendientesDe(flujo('calidad_visita'), [v]).length, 0);
    });

    test('un borrador no es un hecho revisable', () => {
        const v = visita({ check_in: checkIn(), sectores: [sector({ actividades: [borrador()] })] });
        assert.equal(pendientesDe(flujo('documentacion'), [v]).length, 0);
    });

    test('evidencia: solo lo que ya tiene archivo Y lo exige', () => {
        const conArchivo = visita({ check_in: checkIn(), sectores: [sector({ actividades: [actividad()] })] });
        assert.equal(pendientesDe(flujo('evidencia'), [conArchivo]).length, 1);

        const sinSubir = visita({ check_in: checkIn(), sectores: [sector({
            actividades: [actividad({ evidencia: { estado: 'local' } })] })] });
        assert.equal(pendientesDe(flujo('evidencia'), [sinSubir]).length, 0,
            'que falte subirla es deuda del educador, no trabajo del revisor');

        const noLaExige = visita({ check_in: checkIn(), sectores: [sector({
            actividades: [actividad({ tipo: 'Revisión de anaquel' })] })] });
        assert.equal(pendientesDe(flujo('evidencia'), [noLaExige]).length, 0);
    });

    test('retrasos: solo aparece quien llegó tarde de verdad', () => {
        const aTiempo = visita({ hora_inicio: '09:00', check_in: checkIn('09:05') });
        const tarde = visita({ hora_inicio: '09:00', check_in: checkIn('09:45') });

        assert.equal(pendientesDe(flujo('retrasos'), [aTiempo]).length, 0);
        assert.equal(pendientesDe(flujo('retrasos'), [tarde]).length, 1);
    });

    test('cumplimiento: sin actividades guardadas no hay nada que comparar', () => {
        const vacia = visita({ check_in: checkIn(), sectores: [sector({ actividades: [] })] });
        assert.equal(pendientesDe(flujo('cumplimiento'), [vacia]).length, 0);
    });

    test('conteoPendientes suma por flujo y en total', () => {
        const v = visita({ check_in: checkIn(), hora_inicio: '09:00',
                           sectores: [sector({ actividades: [actividad()] })] });
        const { porFlujo, total } = conteoPendientes([v]);

        assert.equal(porFlujo.evidencia, 1);
        assert.equal(porFlujo.retrasos, 0, 'llegó a tiempo');
        assert.equal(total, Object.values(porFlujo).reduce((a, b) => a + b, 0));
    });

    test('lo ya aprobado desaparece de la cola', () => {
        const a = actividad();
        const v = visita({ check_in: checkIn(), sectores: [sector({ actividades: [a] })] });

        assert.equal(pendientesDe(flujo('evidencia'), [v]).length, 1);
        ponerRevisiones([rev({ flujo: 'evidencia', id_ambito: a.id, resultado: RESULTADOS.APROBADO })]);
        assert.equal(pendientesDe(flujo('evidencia'), [v]).length, 0);
    });
});
