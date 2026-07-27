/**
 * "Ver como": un administrador prueba lo que ve otro rol o usuario, sin cerrar sesión.
 *
 * El punto de mira es `perfilActual()` en `js/permisos.js`: de él dependen `puede`, `rolActual`,
 * `alcance`, etc. en toda la app, así que probarlo ahí cubre el resto sin necesidad de recorrer
 * cada componente que los usa.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';

const perfilesPorCorreo: Record<string, unknown> = {};

vi.mock('@services/supabase/rpc', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    rpcEstricto: async (_fn: string, params: { p_correo: string }) => {
        const perfil = perfilesPorCorreo[params.p_correo];
        if (!perfil) throw new Error('correo sin perfil de prueba');
        return perfil;
    }
}));

import {
    olvidarPerfil, perfilActual, perfilReal, puede, alcance,
    enSimulacion, detalleSimulacion,
    entrarSimulacionUsuario, entrarSimulacionRol, salirSimulacion
} from '../js/permisos.js';

function sesionDe(correo: string, esAdmin = true) {
    localStorage.setItem('sesion', JSON.stringify({ correo, nombre: 'Admin', id_token: 't' }));
    // El perfil "real" cacheado con el que arranca `perfilReal()`.
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo, nombre: 'Admin', rol: 'administrador', es_admin: esAdmin,
        permisos: [], alcance: [correo], zonas: [], invitado: true, origen: 'cache'
    }));
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.keys(perfilesPorCorreo).forEach(k => delete perfilesPorCorreo[k]);
    olvidarPerfil();
});

afterEach(() => { salirSimulacion(); olvidarPerfil(); });

describe('sin simulación activa', () => {
    test('perfilActual() es el mismo que perfilReal()', () => {
        sesionDe('admin@x.com');
        assert.equal(enSimulacion(), false);
        assert.deepEqual(perfilActual(), perfilReal());
    });
});

describe('entrar en simulación', () => {
    test('un no-admin no puede entrar', async () => {
        sesionDe('educador@x.com', false);
        await assert.rejects(() => entrarSimulacionUsuario('otro@x.com'), /administrador/);
        assert.equal(enSimulacion(), false);
    });

    test('por usuario: perfilActual() pasa a ser el del correo simulado', async () => {
        sesionDe('admin@x.com', true);
        perfilesPorCorreo['educador@x.com'] = {
            correo: 'educador@x.com', nombre: 'Un educador', rol: 'educador', es_admin: false,
            permisos: ['visitas.crear'], alcance: ['educador@x.com'], zonas: []
        };

        await entrarSimulacionUsuario('educador@x.com');

        assert.equal(enSimulacion(), true);
        assert.equal(puede('administracion', 'configurar'), false,
            'el admin real puede todo; simulando al educador ya no debería poder');
        assert.equal(puede('visitas', 'crear'), true);
        assert.deepEqual(alcance(), ['educador@x.com']);

        // El perfil REAL sigue siendo el del admin: la simulación no lo pisa.
        assert.equal(perfilReal()?.es_admin, true);
    });

    test('por rol: capacidades efectivas, sin alcance propio', () => {
        sesionDe('admin@x.com', true);

        entrarSimulacionRol({ clave: 'gerente', nombre: 'Gerente', efectivas: ['visitas.consultar'] });

        assert.equal(enSimulacion(), true);
        assert.equal(puede('visitas', 'consultar'), true);
        assert.equal(puede('visitas', 'crear'), false);
        assert.deepEqual(alcance(), [],
            'un rol sin persona detrás no tiene territorio propio');
    });

    test('el gate de entrada se evalúa contra el perfil REAL, no contra uno ya simulado', () => {
        sesionDe('admin@x.com', true);

        // Simular un rol SIN administracion.configurar no debe encerrar al admin real: tiene
        // que poder simular otra cosa, o salir, sin que el gate mire el perfil ya simulado.
        entrarSimulacionRol({ clave: 'educador', nombre: 'Educador', efectivas: ['visitas.crear'] });
        assert.equal(puede('administracion', 'configurar'), false);

        assert.doesNotThrow(() =>
            entrarSimulacionRol({ clave: 'gerente', nombre: 'Gerente', efectivas: [] }));
        assert.equal(detalleSimulacion()?.ref, 'gerente');
    });

    test('salirSimulacion() devuelve perfilActual() al perfil real', async () => {
        sesionDe('admin@x.com', true);
        entrarSimulacionRol({ clave: 'educador', nombre: 'Educador', efectivas: [] });
        assert.equal(enSimulacion(), true);

        salirSimulacion();

        assert.equal(enSimulacion(), false);
        assert.deepEqual(perfilActual(), perfilReal());
    });

    test('olvidarPerfil() también limpia la simulación', () => {
        sesionDe('admin@x.com', true);
        entrarSimulacionRol({ clave: 'educador', nombre: 'Educador', efectivas: [] });

        olvidarPerfil();

        assert.equal(enSimulacion(), false);
    });
});
