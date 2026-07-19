/**
 * @vitest-environment happy-dom
 *
 * La bandeja de revisión.
 *
 * Se ejercita contra el módulo de dominio REAL —nada de dobles sobre `js/revisiones.js`—,
 * porque las dos veces que algo se rompió en esta migración fue justo en la costura que un
 * doble habría tapado.
 *
 * Lo que se vigila aquí es lo que distingue revisar de editar: que registrar un veredicto no
 * toque el dato revisado, que el elemento salga de la cola, y que rechazar sin explicar no
 * pase.
 */

import { test, describe, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';

import { Revision } from '@modules/revision/components/Revision';
import {
    tonoResultado, etiquetaResultado, fechaCorta, plural, exigeObservaciones, cierra
} from '@modules/revision/services/formato';
import { resultadosDe, resultadoDe } from '@core/puente';

import { guardarVisitas } from '../js/storage.js';
import {
    olvidarRevisiones, ponerRevisiones, ponerFlujos, pendientesDeSubir, revisar,
    RESULTADOS as _RESULTADOS
} from '../js/revisiones.js';
import type { ResultadoRevision } from '@core/tipos';

// `js/revisiones.js` es JavaScript: sus valores llegan como `string`. Se estrechan una sola
// vez aquí en vez de repetir un `as` en cada uso.
const RESULTADOS = _RESULTADOS as Record<'APROBADO' | 'RECHAZADO' | 'CORRECCION', ResultadoRevision>;
import { olvidarPerfil } from '../js/permisos.js';
import { visita, sector, actividad, checkIn } from './ayuda/fixtures.js';

// ---------- formato: lo que se puede probar sin montar nada ----------

describe('formato', () => {
    test('cada resultado tiene su tono de la cromía de salud', () => {
        assert.equal(tonoResultado('evidencia', RESULTADOS.APROBADO), 'completa');
        assert.equal(tonoResultado('evidencia', RESULTADOS.RECHAZADO), 'sin-registrar');
        assert.equal(tonoResultado('evidencia', RESULTADOS.CORRECCION), 'faltan-evidencias');
    });

    test('un resultado desconocido no se pinta con el color de otro', () => {
        // Sería peor que no pintarlo: un veredicto renombrado en la base saldría verde.
        assert.equal(tonoResultado('evidencia', 'inventado'), 'neutra');
        // Y se muestra tal cual se guardó, en vez de desaparecer del historial.
        assert.equal(etiquetaResultado('evidencia', 'inventado'), 'inventado');
    });

    test('una fecha ilegible se muestra como raya, no como Invalid Date', () => {
        assert.equal(fechaCorta(undefined), '—');
        assert.equal(fechaCorta('no es una fecha'), '—');
        assert.ok(fechaCorta('2026-07-15T10:00:00.000Z').length > 3);
    });

    test('el plural concuerda', () => {
        assert.equal(plural(1, 'elemento', 'elementos'), '1 elemento');
        assert.equal(plural(0, 'elemento', 'elementos'), '0 elementos');
        assert.equal(plural(2, 'vez', 'veces'), '2 veces');
    });

    test('solo aprobar puede ir sin explicación', () => {
        const de = (v: string) => resultadoDe('evidencia', v)!;
        assert.equal(exigeObservaciones(de(RESULTADOS.APROBADO)), false);
        assert.equal(exigeObservaciones(de(RESULTADOS.RECHAZADO)), true);
        assert.equal(exigeObservaciones(de(RESULTADOS.CORRECCION)), true);
    });

    test('aceptar y cerrar son ejes distintos', () => {
        const de = (v: string) => resultadoDe('evidencia', v)!;

        // Rechazado cierra la revisión SIN aceptar el trabajo; corrección ni acepta ni cierra.
        // Colapsarlos en un solo campo obligaría a volver a preguntar por el valor concreto.
        assert.deepEqual([de('aprobado').acepta, cierra(de('aprobado'))], [true, true]);
        assert.deepEqual([de('rechazado').acepta, cierra(de('rechazado'))], [false, true]);
        assert.deepEqual([de('correccion').acepta, cierra(de('correccion'))], [false, false]);
    });
});

describe('un flujo puede traer sus propios veredictos', () => {
    const CALIDAD = {
        clave: 'calidad', nombre: 'Calidad', ambito: 'visita' as const,
        permiso: 'visitas.calificar', orden: 1,
        resultados: [
            { valor: 'efectiva', etiqueta: 'Efectiva', accion: '✓ Efectiva',
              tono: 'completa', estilo: 'principal' as const, acepta: true, cierra: true },
            { valor: 'no_efectiva', etiqueta: 'No efectiva', accion: '✕ No efectiva',
              tono: 'sin-registrar', estilo: 'peligro' as const,
              exige_observaciones: true, acepta: false, cierra: true }
        ]
    };

    test('un flujo sin `resultados` cae en los tres de siempre', () => {
        // Es lo que permite desplegar el esquema sin coordinarlo con el despliegue de la app:
        // los flujos que ya existen en la base no traen la columna.
        assert.deepEqual(resultadosDe({ ...CALIDAD, resultados: undefined }).map(r => r.valor),
            ['aprobado', 'correccion', 'rechazado']);
    });

    test('una lista vacía tampoco deja la bandeja sin botones', () => {
        assert.equal(resultadosDe({ ...CALIDAD, resultados: [] }).length, 3);
    });

    test('con `resultados` propios, esos son los únicos válidos', () => {
        assert.deepEqual(resultadosDe(CALIDAD).map(r => r.valor), ['efectiva', 'no_efectiva']);
        // "aprobado" es válido en evidencias y no significa nada aquí.
        assert.equal(resultadoDe(CALIDAD, 'aprobado'), null);
        assert.equal(resultadoDe(CALIDAD, 'efectiva')?.etiqueta, 'Efectiva');
    });

    test('el tono y la etiqueta salen del flujo, no de una tabla global', () => {
        assert.equal(tonoResultado(CALIDAD, 'efectiva'), 'completa');
        assert.equal(etiquetaResultado(CALIDAD, 'no_efectiva'), 'No efectiva');
    });
});

// ---------- la vista ----------

/**
 * Instala un perfil desde la caché, sin red: es lo que hace la app al arrancar offline.
 *
 * La sesión también se siembra porque el caché SOLO se aplica si su correo coincide con el de
 * la sesión abierta.
 *
 * El alcance incluye a Ana además de a quien revisa, y no es relleno: la cola sale de
 * `consultarVisitas()`, que filtra por alcance. Un revisor cuyo alcance es solo su propio
 * correo ve una bandeja vacía por muchos permisos que tenga —se revisa al equipo, no a la
 * empresa—. La primera versión de estas pruebas lo omitió y no pintaba ni una tarjeta.
 */
function comoRevisor(permisos: string[]) {
    // `visitas.consultar` va SIEMPRE: la cola sale de `consultarVisitas()`, que devuelve una
    // lista vacía sin ese permiso. Un revisor sin él ve la bandeja vacía por muchos permisos
    // de revisión que tenga.
    const todos = [...new Set([...permisos, 'visitas.consultar'])];
    olvidarPerfil();
    localStorage.setItem('sesion', JSON.stringify({
        correo: 'rev@x.com', nombre: 'Quien Revisa', id_token: 'x', expira: Date.now() + 3600e3
    }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo: 'rev@x.com', nombre: 'Quien Revisa', rol: 'gerente',
        es_admin: false, permisos: todos, alcance: ['rev@x.com', 'ana@degasa.com'],
        invitado: true, invitacion_estado: 'aceptada', origen: 'prueba'
    }));
}

/** Una visita con una actividad sellada y su evidencia ya subida: candidata del flujo. */
function visitaConEvidencia() {
    return visita({
        id: 'v-1',
        check_in: checkIn('09:00'),
        sectores: [sector({ actividades: [actividad({ id: 'a-1', tipo: 'Capacitación' })] })]
    });
}

const pintar = (props = {}) => render(<Revision {...props} />);

beforeEach(() => {
    localStorage.clear();
    olvidarRevisiones();
    olvidarPerfil();
});

afterEach(cleanup);

describe('qué se ofrece revisar', () => {
    test('sin ningún flujo permitido lo dice, en vez de dejar la pantalla en blanco', () => {
        comoRevisor([]);
        pintar();

        assert.ok(screen.getByText('Nada que revisar'));
    });

    test('con un solo flujo no se pintan pestañas: no eligen nada', () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        assert.equal(document.querySelector('.revision-tabs'), null);
    });

    test('con varios flujos, cada pestaña lleva su contador', () => {
        comoRevisor(['evidencias.aprobar', 'visitas.calificar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        const pestanas = [...document.querySelectorAll('.revision-tabs button')];
        assert.deepEqual(pestanas.map(b => b.querySelector('span')?.textContent),
            ['Evidencias', 'Calidad de la visita']);

        // Una actividad con evidencia subida y una visita con check-in: uno en cada flujo.
        assert.equal(pestanas[0]?.querySelector('.tab-badge')?.textContent, '1');
        assert.equal(pestanas[1]?.querySelector('.tab-badge')?.textContent, '1');
    });

    test('una bandeja vacía dice que está al día', () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([]);
        pintar();

        assert.ok(screen.getByText('Al día'));
    });

    test('la tarjeta trae el contexto para juzgar sin salir de aquí', () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        const card = document.querySelector('.revision-card')!;
        const texto = card.textContent || '';

        assert.ok(texto.includes('Ana López'), 'quién lo hizo');
        assert.ok(texto.includes('Cliente Uno'), 'para quién');
        assert.ok(texto.includes('2026-07-15'), 'cuándo');
        assert.ok(texto.includes('Dr. Pérez'), 'con quién');
    });
});

describe('registrar un veredicto', () => {
    test('aprobar sin escribir nada es válido y saca el elemento de la cola', async () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        assert.equal(document.querySelectorAll('.revision-card').length, 1);

        await act(async () => { fireEvent.click(screen.getByText('✓ Aprobar')); });

        assert.equal(document.querySelectorAll('.revision-card').length, 0,
            'una bandeja que no se vacía se deja de mirar');
        assert.ok(screen.getByText('Al día'));
    });

    test('rechazar sin explicar no pasa, y dice por qué', async () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        await act(async () => { fireEvent.click(screen.getByText('✕ Rechazar')); });

        assert.ok(screen.getByRole('alert').textContent?.includes('corregir'));
        assert.equal(document.querySelectorAll('.revision-card').length, 1,
            'el elemento sigue en la cola: no se registró nada');
        assert.equal(pendientesDeSubir().length, 0);
    });

    test('rechazar con explicación sí pasa', async () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        await act(async () => {
            fireEvent.change(document.querySelector('textarea')!,
                { target: { value: 'La foto está movida.' } });
        });
        await act(async () => { fireEvent.click(screen.getByText('✕ Rechazar')); });

        const cola = pendientesDeSubir();
        assert.equal(cola.length, 1);
        assert.equal(cola[0].resultado, RESULTADOS.RECHAZADO);
        assert.equal(cola[0].observaciones, 'La foto está movida.');
    });

    test('revisar NO toca el dato revisado', async () => {
        comoRevisor(['evidencias.aprobar']);
        const v = visitaConEvidencia();
        guardarVisitas([v]);
        const antes = JSON.stringify(v);

        pintar();
        await act(async () => { fireEvent.click(screen.getByText('✓ Aprobar')); });

        const guardadas = JSON.parse(localStorage.getItem('visitas') || '[]');
        assert.equal(JSON.stringify(guardadas[0]), antes,
            'revisar es un juicio sobre el registro, no una edición del registro');
    });

    test('el veredicto se avisa al usuario', async () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);

        const avisos: Array<[string, unknown]> = [];
        pintar({ avisar: (t: string, o: unknown) => avisos.push([t, o]) });

        await act(async () => { fireEvent.click(screen.getByText('✓ Aprobar')); });

        assert.equal(avisos.length, 1);
        assert.ok(avisos[0]?.[0].includes('Capacitación'), 'debe decir QUÉ se aprobó');
    });

    test('avisa del cambio para que el contador del riel se ponga al día', async () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);

        let cambios = 0;
        pintar({ onCambio: () => { cambios++; } });

        await act(async () => { fireEvent.click(screen.getByText('✓ Aprobar')); });

        assert.ok(cambios > 0, 'sin esto la insignia seguiría marcando un pendiente que ya no está');
    });
});

describe('calificar con el vocabulario del flujo', () => {
    /** Sustituye los flujos por uno solo, con sus propios veredictos. */
    function conFlujoDeCalidad() {
        ponerFlujos([{
            clave: 'calidad_visita', nombre: 'Calidad de la visita', ambito: 'visita',
            permiso: 'visitas.calificar', orden: 1,
            descripcion: 'Si la visita fue efectiva.',
            resultados: [
                { valor: 'efectiva', etiqueta: 'Efectiva', accion: '✓ Efectiva',
                  tono: 'completa', estilo: 'principal', acepta: true, cierra: true },
                { valor: 'parcial', etiqueta: 'Parcialmente efectiva', accion: '~ Parcial',
                  tono: 'faltan-evidencias', estilo: 'txt',
                  exige_observaciones: true, acepta: true, cierra: true },
                { valor: 'por_explicar', etiqueta: 'Pendiente de explicar',
                  accion: '↺ Pedir explicación', tono: 'faltan-evidencias', estilo: 'txt',
                  exige_observaciones: true, acepta: false, cierra: false }
            ]
        }]);
    }

    test('los botones son los del flujo, no aprobar/rechazar', () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        const botones = [...document.querySelectorAll('.revision-botones button')]
            .map(b => b.textContent);

        assert.deepEqual(botones, ['✓ Efectiva', '~ Parcial', '↺ Pedir explicación']);
    });

    test('el aviso usa el nombre y el color del veredicto elegido', async () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);

        const avisos: Array<[string, { estado?: string }]> = [];
        pintar({ avisar: (t: string, o: { estado?: string }) => avisos.push([t, o]) });

        await act(async () => { fireEvent.click(screen.getByText('✓ Efectiva')); });

        assert.ok(avisos[0]?.[0].startsWith('Efectiva'), 'no "Aprobado"');
        assert.equal(avisos[0]?.[1].estado, 'completa');
    });

    test('el veredicto que se guarda es el del flujo', async () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        await act(async () => { fireEvent.click(screen.getByText('✓ Efectiva')); });

        assert.equal(pendientesDeSubir()[0]?.resultado, 'efectiva');
    });

    test('un veredicto que exige explicación la sigue exigiendo', async () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        await act(async () => { fireEvent.click(screen.getByText('~ Parcial')); });

        assert.ok(screen.getByRole('alert'));
        assert.equal(pendientesDeSubir().length, 0);
    });

    test('«acepta» no implica «cierra»: parcial acepta y cierra igual', async () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        await act(async () => {
            fireEvent.change(document.querySelector('textarea')!,
                { target: { value: 'Faltó cubrir dos sectores.' } });
        });
        await act(async () => { fireEvent.click(screen.getByText('~ Parcial')); });

        assert.ok(screen.getByText('Al día'), 'cierra: sale de la cola');
    });

    test('un veredicto que NO cierra devuelve el elemento a la cola', () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);

        ponerRevisiones([{
            id: 'rv-1', flujo: 'calidad_visita', ambito: 'visita',
            id_ambito: 'v-1', id_visita: 'v-1', resultado: 'por_explicar',
            observaciones: '¿Por qué solo dos sectores?', revisor: 'Jefa',
            momento: '2026-07-16T10:00:00.000Z', seq: 1
        }]);

        pintar();

        assert.equal(document.querySelectorAll('.revision-card').length, 1,
            'lo decide `cierra`, no una comparación contra "correccion"');
    });

    test('un veredicto de OTRO flujo se rechaza', async () => {
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);
        pintar();

        // «aprobado» vale en evidencias y no significa nada aquí. Lo comprueba el dominio,
        // no la pantalla: un cliente manipulado no debe poder inventarse un veredicto.
        const r = revisar({
            flujo: 'calidad_visita', ambito: 'visita', idAmbito: 'v-1', idVisita: 'v-1',
            resultado: 'aprobado', observaciones: 'x'
        });

        assert.equal(r.ok, false);
        assert.ok(r.error?.includes('no aplica'));
    });

    test('un resultado que el flujo ya no reconoce cuenta como PENDIENTE', () => {
        // Se renombró en la base y en local quedó el viejo. Revisar dos veces molesta; dar
        // por bueno lo que nadie aprobó, no.
        comoRevisor(['visitas.calificar']);
        conFlujoDeCalidad();
        guardarVisitas([visitaConEvidencia()]);

        ponerRevisiones([{
            id: 'rv-1', flujo: 'calidad_visita', ambito: 'visita',
            id_ambito: 'v-1', id_visita: 'v-1', resultado: 'valor_que_ya_no_existe',
            observaciones: '', revisor: 'Jefa', momento: '2026-07-16T10:00:00.000Z', seq: 1
        }]);

        pintar();

        assert.equal(document.querySelectorAll('.revision-card').length, 1);
    });
});

describe('lo ya dicho', () => {
    test('lo pedido a corregir vuelve a la cola, con su historial a la vista', () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);

        ponerRevisiones([{
            id: 'rv-1', flujo: 'evidencia', ambito: 'actividad',
            id_ambito: 'a-1', id_visita: 'v-1',
            resultado: RESULTADOS.CORRECCION,
            observaciones: 'No se lee el nombre del área.',
            revisor: 'Jefa', revisor_correo: 'jefa@x.com',
            momento: '2026-07-16T10:00:00.000Z', seq: 1
        }]);

        pintar();

        assert.equal(document.querySelectorAll('.revision-card').length, 1,
            'pedir corrección no cierra el caso: sigue pendiente');

        const historial = document.querySelector('.historial')!;
        assert.ok(historial.querySelector('summary')?.textContent?.includes('1 vez'));
        assert.ok(historial.textContent?.includes('No se lee el nombre del área.'));
    });

    test('lo aprobado desaparece de la cola', () => {
        comoRevisor(['evidencias.aprobar']);
        guardarVisitas([visitaConEvidencia()]);

        ponerRevisiones([{
            id: 'rv-1', flujo: 'evidencia', ambito: 'actividad',
            id_ambito: 'a-1', id_visita: 'v-1', resultado: RESULTADOS.APROBADO,
            observaciones: '', revisor: 'Jefa', momento: '2026-07-16T10:00:00.000Z', seq: 1
        }]);

        pintar();

        assert.ok(screen.getByText('Al día'),
            'ver lo que ya pasó por tus manos es exactamente lo que hace que la bandeja se abandone');
    });
});
