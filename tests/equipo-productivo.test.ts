/**
 * Prueba de aceptación multiusuario.
 *
 * Este archivo representa una jornada real con tres identidades distintas. No usa el modo
 * "ver como": cambiar de usuario vuelve a sembrar sesión + perfil, igual que tres dispositivos
 * en producción. El objetivo es detectar huecos entre lo que el equipo necesita hacer y las
 * capacidades sembradas para cada rol.
 */

import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';

import { limpiarAlmacen } from './entorno.js';
import { olvidarPerfil, puede, perfilActual } from '../js/permisos.js';
import { nuevaVisita, sellarVisita } from '@modules/visitas/services/fabricas';
import {
    agregarVisita, guardarVisitas, leerVisitas, actualizarVisita,
    leerEstrategias, upsertEstrategia
} from '../js/storage.js';
import { iniciarVisita, finalizarVisita, cancelarVisita, reagendarVisita } from '../js/visita.js';
import { comentar, comentariosDeVisita } from '../js/comentarios.js';
import {
    FLUJOS_POR_DEFECTO, RESULTADOS, ponerRevisiones, revisar,
    pendientesDe, conteoPendientes, revisionVigente
} from '../js/revisiones.js';
import { calcularIndicadores, indicadoresPorEducador } from '../js/datos.js';

const EDU = 'educador.prod@degasa.com';
const ANA = 'analista.prod@degasa.com';
const GTE = 'gerente.prod@degasa.com';

const PERMISOS = {
    educador: [
        'visitas.crear', 'visitas.consultar', 'actividades.crear', 'actividades.consultar',
        'materiales.crear', 'materiales.consultar', 'evidencias.subir', 'evidencias.consultar',
        'comentarios.crear', 'comentarios.leer', 'comentarios.responder', 'dashboards.personal',
        'mi_dia.ver', 'estrategias.ver'
    ],
    analista: [
        'visitas.consultar', 'visitas.exportar', 'actividades.consultar', 'materiales.consultar',
        'evidencias.consultar', 'comentarios.leer', 'dashboards.personal', 'dashboards.equipo',
        'dashboards.general', 'mi_dia.ver', 'indicadores.ver', 'revision.ver'
    ],
    gerente: [
        'visitas.crear', 'visitas.consultar', 'visitas.revisar', 'visitas.calificar',
        'visitas.exportar', 'actividades.consultar', 'actividades.revisar', 'actividades.calificar',
        'materiales.consultar', 'materiales.revisar', 'evidencias.consultar', 'evidencias.aprobar',
        'evidencias.rechazar', 'evidencias.solicitar_correccion', 'comentarios.crear',
        'comentarios.leer', 'comentarios.responder', 'dashboards.personal', 'dashboards.equipo',
        'mi_dia.ver', 'estrategias.ver', 'indicadores.ver', 'revision.ver'
    ]
} as const;

function entrar(correo: string, nombre: string, rol: keyof typeof PERMISOS, alcance: string[]) {
    localStorage.setItem('sesion', JSON.stringify({ correo, nombre, id_token: `token-${rol}` }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo, nombre, rol, es_admin: false, permisos: [...PERMISOS[rol]], alcance,
        zonas: ['001'], invitado: true, invitacion_estado: 'aceptada', origen: 'prueba'
    }));
    olvidarPerfil();
    // olvidarPerfil limpia la caché para evitar que un actor se filtre al siguiente; se vuelve a
    // inicializar explícitamente desde el perfil recién instalado.
    localStorage.setItem('sesion', JSON.stringify({ correo, nombre, id_token: `token-${rol}` }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo, nombre, rol, es_admin: false, permisos: [...PERMISOS[rol]], alcance,
        zonas: ['001'], invitado: true, invitacion_estado: 'aceptada', origen: 'prueba'
    }));
    assert.equal(perfilActual()?.correo, correo);
}

function actividad(id: string, evidencia: 'subida' | 'pendiente' = 'subida') {
    return {
        id, tipo: 'Capacitación', area_visitada: 'Urgencias',
        guardada: { momento: '2026-09-04T10:00:00.000Z', usuario: 'Diego Educador', usuario_correo: EDU },
        contacto: { nombre: 'Dra. Pérez', cargo: 'Jefa', servicio: 'Urgencias' }, materiales: [],
        evidencia: evidencia === 'subida'
            ? { estado: 'subida', nombre: 'evidencia.pdf', mime: 'application/pdf', url: 'https://drive.test/e-1' }
            : { estado: 'pendiente', nombre: '', mime: '', url: '' }
    };
}

beforeEach(() => {
    limpiarAlmacen();
    olvidarPerfil();
    ponerRevisiones([]);
});

describe('matriz de acceso del equipo productivo', () => {
    test('Educador captura; Analista consulta; Gerente consulta, revisa y aprueba', () => {
        entrar(EDU, 'Diego Educador', 'educador', [EDU]);
        assert.equal(puede('visitas', 'crear'), true);
        assert.equal(puede('evidencias', 'subir'), true);
        assert.equal(puede('evidencias', 'aprobar'), false);
        assert.equal(puede('dashboards', 'equipo'), false);

        entrar(ANA, 'Andrea Analista', 'analista', [ANA, EDU]);
        assert.equal(puede('visitas', 'consultar'), true);
        assert.equal(puede('evidencias', 'consultar'), true);
        assert.equal(puede('dashboards', 'equipo'), true);

        entrar(GTE, 'Gabriel Gerente', 'gerente', [GTE, EDU]);
        assert.equal(puede('evidencias', 'aprobar'), true);
        assert.equal(puede('evidencias', 'rechazar'), true);
        assert.equal(puede('visitas', 'calificar'), true);
    });
});

describe('jornada del Educador: planear, ejecutar y documentar', () => {
    test('crea estrategia y visita, reagenda otra, cancela otra y completa una visita', async () => {
        entrar(EDU, 'Diego Educador', 'educador', [EDU]);

        const estrategia = upsertEstrategia({
            id: 'estr-prod-1', cliente: 'Hospital Central', sector: 'GASAS',
            grupo_articulo: 'Curación', etapa: 'Diagnóstico', proyecto: 'Aumentar rotación',
            productos: ['Gasa 10x10'], observaciones: 'Revisar consumo mensual',
            actualizado: new Date().toISOString(), actualizado_por: 'Diego Educador',
            actualizado_correo: EDU, sincronizado: false
        });
        assert.equal(leerEstrategias()[0]?.id, estrategia.id);

        const visita = nuevaVisita({
            dia: '2026-09-04', hora_inicio: '09:00', hora_fin: '11:00',
            cliente: 'Hospital Central', zona: '001', ejecutivo: 'Ejecutivo Norte',
            id_estrategia: estrategia.id, sectorNombres: ['GASAS']
        }, { correo: EDU, nombre: 'Diego Educador', id_token: 'x' }, (p) => `${p}-prod-1`);
        sellarVisita(visita, { momento: '2026-09-04T08:00:00.000Z', usuario: 'Diego Educador' });
        agregarVisita(visita);
        assert.equal(leerVisitas().find((v: any) => v.id === visita.id)?.borrador, undefined);
        assert.equal(leerVisitas()[0]?.id_estrategia, estrategia.id);

        const reagendada = reagendarVisita(visita.id, {
            dia: '2026-09-05', hora_inicio: '10:00', hora_fin: '12:00', motivo: 'Cliente solicitó cambio'
        }) as any;
        assert.equal(reagendada.ok, true);
        assert.equal(reagendada.visita?.reagendas?.length, 1);

        const checkIn = await iniciarVisita(visita.id) as any;
        assert.equal(checkIn.ok, true);
        assert.equal(checkIn.visita?.check_in?.usuario_correo, EDU);
        assert.equal(checkIn.visita?.estado, 'en-proceso');

        const comentario = comentar({
            ambito: 'visita', idAmbito: visita.id,
            texto: 'La jefa de Urgencias pidió seguimiento en dos semanas.', visita: checkIn.visita
        });
        assert.equal(comentario.ok, true);
        assert.equal(comentariosDeVisita(visita.id).length, 1);

        const a = actividad('a-prod-1', 'subida');
        actualizarVisita(visita.id, (v: any) => { v.sectores![0]!.actividades = [a]; });
        const checkOut = await finalizarVisita(visita.id) as any;
        assert.equal(checkOut.ok, true);
        assert.equal(checkOut.visita?.estado, 'finalizada');
        assert.ok(checkOut.visita?.check_out);

        const cancelable = nuevaVisita({
            dia: '2026-09-06', hora_inicio: '09:00', hora_fin: '10:00',
            cliente: 'Hospital Central', sectorNombres: ['GASAS']
        }, { correo: EDU, nombre: 'Diego Educador', id_token: 'x' }, (p) => `${p}-prod-2`);
        sellarVisita(cancelable, { momento: '2026-09-04T08:00:00.000Z', usuario: 'Diego Educador' });
        agregarVisita(cancelable);
        const cancelada = cancelarVisita(cancelable.id, 'El cliente canceló la reunión.') as any;
        assert.equal(cancelada.ok, true);
        assert.equal(cancelada.visita?.estado, 'cancelada');
        assert.equal(cancelada.visita?.motivo_cancelacion, 'El cliente canceló la reunión.');
    });
});

describe('Analista y Gerente: seguimiento, revisión y control', () => {
    test('Analista ve equipo, evidencias y plan de trabajo', () => {
        const equipo = [
            { id: 'v-a', educador: 'Diego Educador', educador_correo: EDU, cliente: 'Hospital Central', estado: 'finalizada', dia: '2026-09-04', sectores: [{ id: 's-a', nombre: 'GASAS', actividades: [actividad('a-a')] }] },
            { id: 'v-b', educador: 'Beatriz Educadora', educador_correo: 'beatriz.prod@degasa.com', cliente: 'Hospital Sur', estado: 'programada', dia: '2026-09-04', sectores: [] }
        ];
        guardarVisitas(equipo);
        entrar(ANA, 'Andrea Analista', 'analista', [ANA, EDU, 'beatriz.prod@degasa.com']);

        assert.deepEqual(perfilActual()?.alcance, [ANA, EDU, 'beatriz.prod@degasa.com']);
        assert.equal(equipo.filter(v => perfilActual()?.alcance.includes(v.educador_correo!)).length, 2);
        assert.equal(calcularIndicadores(equipo).evidencias_subidas, 1);
        assert.equal(indicadoresPorEducador(equipo).length, 2);
    });

    test('Gerente revisa evidencia, pide corrección y luego aprueba; también califica visita', () => {
        const v = {
            id: 'v-revision-prod', educador: 'Diego Educador', educador_correo: EDU,
            cliente: 'Hospital Central', hospital: 'Hospital Central', estado: 'finalizada',
            dia: '2026-09-04', hora_inicio: '09:00', hora_fin: '10:00',
            check_in: { momento: '2026-09-04T09:02:00.000Z' }, check_out: { momento: '2026-09-04T10:00:00.000Z' },
            sectores: [{ id: 's-r', nombre: 'GASAS', actividades: [actividad('a-revision')] }]
        };
        guardarVisitas([v]);
        entrar(GTE, 'Gabriel Gerente', 'gerente', [GTE, EDU]);

        const correccion = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-revision', idVisita: v.id, resultado: RESULTADOS.CORRECCION, observaciones: 'Subir una foto donde se vea el anaquel completo.' });
        assert.equal(correccion.ok, true);
        const aprobacion = revisar({ flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-revision', idVisita: v.id, resultado: RESULTADOS.APROBADO, observaciones: '' });
        assert.equal(aprobacion.ok, true);
        assert.equal(revisionVigente('evidencia', 'a-revision')?.resultado, RESULTADOS.APROBADO);

        const calidad = revisar({ flujo: 'calidad_visita', ambito: 'visita', idAmbito: v.id, idVisita: v.id, resultado: RESULTADOS.APROBADO, observaciones: '' });
        assert.equal(calidad.ok, true);
        const pendientes = (conteoPendientes([v]) as any).porFlujo as Record<string, number>;
        assert.equal(pendientes.evidencia, 0);
        assert.equal(pendientes.calidad_visita, 0);
        assert.equal(pendientesDe(FLUJOS_POR_DEFECTO.find(f => f.clave === 'evidencia')!, [v]).length, 0);
    });

    test('REQUISITO: Analista puede confirmar evidencias', () => {
        entrar(ANA, 'Andrea Analista', 'analista', [ANA, EDU]);
        const resultado = revisar({
            flujo: 'evidencia', ambito: 'actividad', idAmbito: 'a-analista',
            idVisita: 'v-analista', resultado: RESULTADOS.APROBADO, observaciones: ''
        });
        assert.equal(resultado.ok, true,
            'El rol Analista solicitado necesita evidencias.aprobar, pero hoy solo tiene evidencias.consultar.');
    });
});
