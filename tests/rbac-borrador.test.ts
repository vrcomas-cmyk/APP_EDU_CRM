/**
 * El borrador de Accesos: duplicar roles, cerrar ciclos de herencia y de jerarquía, y traducir
 * el estado en pantalla a lo que espera el servidor.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';

import {
    candidatosDeHerencia, capacidadesPorGrupo, cerrariaCiclo, conActivoDeUsuario, conCapacidad,
    conRolesDeUsuario, conSubordinados, duplicarRol, jerarquiaParaGuardar, problemasDeRoles,
    problemasDeUsuarios, rolNuevo, rolesParaGuardar, usuarioNuevo, usuariosParaGuardar
} from '@modules/administracion/services/borradorRBAC';
import type { CapacidadAdmin, RolAdmin, UsuarioAdmin } from '@core/tipos';

const rol = (extra: Partial<RolAdmin> = {}): RolAdmin => ({
    ...rolNuevo(), clave: 'gerente', nombre: 'Gerente', ...extra
});

const usuario = (extra: Partial<UsuarioAdmin> = {}): UsuarioAdmin => ({
    ...usuarioNuevo(), correo: 'ana@x.com', nombre: 'Ana', ...extra
});

describe('roles', () => {
    test('duplicar arranca sin usuarios, sin herederos y no es de sistema', () => {
        const original = rol({ sistema: true, usuarios: 5, herederos: 2, capacidades: ['visitas.crear'] });
        const copia = duplicarRol(original, () => false);

        assert.equal(copia.clave, 'gerente_copia');
        assert.equal(copia.sistema, false);
        assert.equal(copia.usuarios, 0);
        assert.equal(copia.herederos, 0);
        assert.deepEqual(copia.capacidades, ['visitas.crear'], 'las capacidades sí se copian');
    });

    test('duplicar busca una clave libre si la primera ya existe', () => {
        const original = rol({ clave: 'gerente' });
        const ocupadas = new Set(['gerente_copia']);
        const copia = duplicarRol(original, c => ocupadas.has(c));
        assert.equal(copia.clave, 'gerente_copia_2');
    });

    test('conCapacidad agrega y quita sin duplicar', () => {
        const r = rol({ capacidades: ['visitas.crear'] });
        const conMas = conCapacidad(r, 'visitas.aprobar', true);
        assert.deepEqual(conMas.capacidades, ['visitas.crear', 'visitas.aprobar']);

        const otraVez = conCapacidad(conMas, 'visitas.crear', true);
        assert.deepEqual(otraVez.capacidades, ['visitas.crear', 'visitas.aprobar'], 'no se duplica');

        const sinUna = conCapacidad(otraVez, 'visitas.crear', false);
        assert.deepEqual(sinUna.capacidades, ['visitas.aprobar']);
    });

    test('candidatosDeHerencia excluye al propio rol y a su descendencia', () => {
        const roles = [
            rol({ clave: 'admin' }),
            rol({ clave: 'gerente', hereda_de: 'admin' }),
            rol({ clave: 'supervisor', hereda_de: 'gerente' }),
            rol({ clave: 'analista' })
        ];

        const candidatos = candidatosDeHerencia(roles, 'gerente').map(r => r.clave);

        assert.ok(!candidatos.includes('gerente'), 'no puede heredar de sí mismo');
        assert.ok(!candidatos.includes('supervisor'), 'heredar de un descendiente cerraría un ciclo');
        assert.ok(candidatos.includes('admin'));
        assert.ok(candidatos.includes('analista'));
    });

    test('problemasDeRoles detecta clave vacía, formato inválido y duplicados', () => {
        assert.ok(problemasDeRoles([rol({ clave: '' })]).some(p => p.includes('sin clave')));
        assert.ok(problemasDeRoles([rol({ clave: 'Gerente Regional' })])
            .some(p => p.includes('mayúsculas')));
        assert.ok(problemasDeRoles([rol({ clave: 'x' }), rol({ clave: 'x' })])
            .some(p => p.includes('misma clave')));
        assert.deepEqual(problemasDeRoles([rol({ clave: 'gerente' })]), []);
    });

    test('rolesParaGuardar reenvía todos y solo pide borrar los que ya no están', () => {
        const original = [rol({ clave: 'a' }), rol({ clave: 'b' }), rol({ clave: 'c', sistema: true })];
        const actual = [rol({ clave: 'a' })];

        const { roles, eliminar } = rolesParaGuardar(original, actual);
        assert.deepEqual(roles.map(r => r.clave), ['a']);
        assert.deepEqual(eliminar, ['b'], 'un rol de sistema nunca se pide borrar, aunque desaparezca de la lista');
    });
});

describe('usuarios', () => {
    test('conActivoDeUsuario y conRolesDeUsuario operan por índice, no por correo', () => {
        // Dos filas "+ Invitar" sin llenar comparten correo vacío: por correo se tocarían las dos.
        const usuarios = [usuario({ correo: '' }), usuario({ correo: '' })];

        const conUno = conActivoDeUsuario(usuarios, 0, false);
        assert.equal(conUno[0]!.activo, false);
        assert.equal(conUno[1]!.activo, true, 'la otra fila en blanco no se toca');

        const conRoles = conRolesDeUsuario(usuarios, 1, ['gerente']);
        assert.deepEqual(conRoles[0]!.roles, []);
        assert.deepEqual(conRoles[1]!.roles, ['gerente']);
    });

    test('problemasDeUsuarios detecta correo inválido y duplicado', () => {
        assert.ok(problemasDeUsuarios([usuario({ correo: 'no-es-correo' })])
            .some(p => p.includes('válido')));
        assert.ok(problemasDeUsuarios([usuario({ correo: 'a@x.com' }), usuario({ correo: 'a@x.com' })])
            .some(p => p.includes('mismo correo')));
        assert.deepEqual(problemasDeUsuarios([usuario({ correo: 'a@x.com' })]), []);
    });

    test('usuariosParaGuardar normaliza el correo a minúsculas', () => {
        const [u] = usuariosParaGuardar([usuario({ correo: ' Ana@X.com ' })]);
        assert.equal(u!.correo, 'ana@x.com');
    });
});

describe('jerarquía', () => {
    test('cerrariaCiclo detecta que alguien ya está por encima, directo o de varios saltos', () => {
        const usuarios = [
            usuario({ correo: 'jefe@x.com', subordinados: ['medio@x.com'] }),
            usuario({ correo: 'medio@x.com', subordinados: ['abajo@x.com'] }),
            usuario({ correo: 'abajo@x.com', subordinados: [] })
        ];

        // Poner a jefe@x.com bajo abajo@x.com cerraría el ciclo jefe→medio→abajo→jefe.
        assert.equal(cerrariaCiclo(usuarios, 'abajo@x.com', 'jefe@x.com'), true);
        assert.equal(cerrariaCiclo(usuarios, 'jefe@x.com', 'jefe@x.com'), true, 'nadie es su propio jefe');
        assert.equal(cerrariaCiclo(usuarios, 'jefe@x.com', 'abajo@x.com'), false, 'esto es válido: no hay ciclo');
    });

    test('conSubordinados reemplaza la lista completa de ese jefe, y de nadie más', () => {
        const usuarios = [
            usuario({ correo: 'jefe@x.com', subordinados: ['a@x.com'] }),
            usuario({ correo: 'otro@x.com', subordinados: ['b@x.com'] })
        ];
        const salida = conSubordinados(usuarios, 'jefe@x.com', ['a@x.com', 'c@x.com']);
        assert.deepEqual(salida[0]!.subordinados, ['a@x.com', 'c@x.com']);
        assert.deepEqual(salida[1]!.subordinados, ['b@x.com'], 'el otro jefe no se toca');
    });

    test('jerarquiaParaGuardar incluye a quien la tenía y ya no, para poder vaciarla', () => {
        const original = [usuario({ correo: 'jefe@x.com', subordinados: ['a@x.com'] })];
        const actual = [usuario({ correo: 'jefe@x.com', subordinados: [] })];

        const payload = jerarquiaParaGuardar(original, actual);
        assert.deepEqual(payload, [{ jefe: 'jefe@x.com', subordinados: [] }],
            'sin esta entrada, el servidor dejaría intactos los subordinados viejos');
    });

    test('jerarquiaParaGuardar no incluye a quien nunca tuvo subordinados', () => {
        const usuarios = [usuario({ correo: 'solo@x.com', subordinados: [] })];
        assert.deepEqual(jerarquiaParaGuardar(usuarios, usuarios), []);
    });
});

describe('capacidadesPorGrupo', () => {
    test('agrupa y ordena por el campo orden', () => {
        const capacidades: CapacidadAdmin[] = [
            { clave: 'b', modulo: 'visitas', accion: 'crear', nombre: 'Crear', descripcion: null, grupo: 'Visitas', orden: 2 },
            { clave: 'a', modulo: 'visitas', accion: 'ver', nombre: 'Ver', descripcion: null, grupo: 'Visitas', orden: 1 },
            { clave: 'c', modulo: 'admin', accion: 'configurar', nombre: 'Configurar', descripcion: null, grupo: 'Admin', orden: 1 }
        ];

        const grupos = capacidadesPorGrupo(capacidades);
        assert.deepEqual(grupos.map(([g]) => g), ['Visitas', 'Admin']);
        assert.deepEqual(grupos[0]![1].map(c => c.clave), ['a', 'b'], 'dentro del grupo respeta el orden');
    });
});
