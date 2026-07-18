/**
 * Autorización.
 *
 * Cada prueba de "no puede" vale más que su equivalente positiva: un permiso de más no falla
 * de forma visible, deja ver datos a quien no debía y nadie se entera.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import {
    can, canDo, canAll, canAny, configurarPerfil,
    alcance, enAlcance, tieneEquipo, estadoInvitacion, accesoBloqueado
} from '@modules/usuarios/permissions/can';

import type { Perfil } from '@core/tipos';

const perfil = (campos: Partial<Perfil> = {}): Perfil => ({
    correo: 'ana@x.com',
    nombre: 'Ana',
    rol: 'educador',
    es_admin: false,
    permisos: [],
    alcance: ['ana@x.com'],
    invitado: true,
    origen: 'prueba',
    ...campos
});

const como = (p: Perfil | null) => configurarPerfil(() => p);

beforeEach(() => como(null));

describe('can', () => {
    test('sin perfil no puede nada', () => {
        assert.equal(can('visitas', 'crear'), false,
            'no saber quién eres no es permiso para nada');
    });

    test('con el permiso exacto, puede', () => {
        como(perfil({ permisos: ['visitas.crear'] }));
        assert.equal(can('visitas', 'crear'), true);
    });

    test('sin el permiso, no puede — la ausencia ES la negación', () => {
        como(perfil({ permisos: ['visitas.consultar'] }));
        assert.equal(can('visitas', 'crear'), false);
        assert.equal(can('visitas', 'borrar'), false);
    });

    test('el permiso de un módulo no se filtra a otro', () => {
        como(perfil({ permisos: ['visitas.aprobar'] }));
        assert.equal(can('evidencias', 'aprobar'), false,
            'poder aprobar visitas no es poder aprobar evidencias');
    });

    test('la acción no se filtra dentro del mismo módulo', () => {
        como(perfil({ permisos: ['visitas.consultar'] }));
        assert.equal(can('visitas', 'aprobar'), false);
    });

    test('el administrador puede todo sin enumerarlo', () => {
        como(perfil({ es_admin: true, permisos: [] }));

        assert.equal(can('visitas', 'crear'), true);
        assert.equal(can('lo_que_sea', 'inventado'), true,
            'enumerarlo obligaría a recordar cada permiso nuevo en dos lugares');
    });

    test('el ROL no concede nada por sí solo', () => {
        como(perfil({ rol: 'admin', es_admin: false, permisos: [] }));

        assert.equal(can('visitas', 'crear'), false,
            'llamarse "admin" no es serlo: lo que manda es `es_admin` y la lista de permisos');
    });
});

describe('canDo / canAll / canAny', () => {
    beforeEach(() => como(perfil({ permisos: ['visitas.crear', 'evidencias.subir'] })));

    test('canDo acepta la forma modulo.accion', () => {
        assert.equal(canDo('visitas.crear'), true);
        assert.equal(canDo('visitas.borrar'), false);
    });

    test('una cadena malformada no concede nada', () => {
        assert.equal(canDo('visitas'), false, 'sin punto no es un permiso');
        assert.equal(canDo(''), false);
        assert.equal(canDo('.crear'), false, 'sin módulo tampoco');
    });

    test('una acción con puntos se parte solo en el primero', () => {
        como(perfil({ permisos: ['dashboards.equipo.detalle'] }));
        assert.equal(canDo('dashboards.equipo.detalle'), true);
    });

    test('canAll exige todas', () => {
        assert.equal(canAll('visitas.crear', 'evidencias.subir'), true);
        assert.equal(canAll('visitas.crear', 'visitas.borrar'), false);
    });

    test('canAny basta con una', () => {
        assert.equal(canAny('visitas.borrar', 'evidencias.subir'), true);
        assert.equal(canAny('visitas.borrar', 'visitas.aprobar'), false);
    });

    test('sin permisos que pedir, canAll es cierto y canAny falso', () => {
        assert.equal(canAll(), true);
        assert.equal(canAny(), false, 'ninguna condición cumplida no es "puede"');
    });
});

describe('alcance', () => {
    test('sin perfil el alcance es vacío, no universal', () => {
        assert.deepEqual(alcance(), []);
        assert.equal(enAlcance('quien@sea.com'), false);
    });

    test('compara por correo ignorando mayúsculas y espacios', () => {
        como(perfil({ alcance: ['Ana@X.com'] }));
        assert.equal(enAlcance('  ana@x.com '), true);
    });

    test('quien no está en el alcance queda fuera', () => {
        como(perfil({ alcance: ['ana@x.com'] }));
        assert.equal(enAlcance('beto@x.com'), false);
    });

    test('un correo vacío nunca está en alcance', () => {
        como(perfil({ alcance: ['ana@x.com'] }));
        assert.equal(enAlcance(''), false);
        assert.equal(enAlcance(null), false);
        assert.equal(enAlcance(undefined), false);
    });

    test('tener equipo es ver a alguien más que a uno mismo', () => {
        como(perfil({ alcance: ['ana@x.com'] }));
        assert.equal(tieneEquipo(), false);

        como(perfil({ alcance: ['ana@x.com', 'beto@x.com'] }));
        assert.equal(tieneEquipo(), true);
    });
});

describe('invitación — tres estados, no dos', () => {
    test('true deja pasar', () => {
        como(perfil({ invitado: true }));
        assert.equal(estadoInvitacion(), true);
        assert.equal(accesoBloqueado(), false);
    });

    test('false cierra la puerta', () => {
        como(perfil({ invitado: false }));
        assert.equal(accesoBloqueado(), true);
    });

    test('null es "todavía no sé", y NO bloquea', () => {
        como(perfil({ invitado: null }));

        assert.equal(estadoInvitacion(), null);
        assert.equal(accesoBloqueado(), false,
            'negar por no saber dejaría fuera a quien abre la app sin cobertura');
    });

    test('sin perfil tampoco se bloquea: es desconocimiento, no rechazo', () => {
        como(null);
        assert.equal(estadoInvitacion(), null);
        assert.equal(accesoBloqueado(), false);
    });
});
