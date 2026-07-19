/**
 * @vitest-environment happy-dom
 *
 * Accesos: la pantalla de Roles, Usuarios y Jerarquía.
 *
 * A diferencia de Catálogos, esto no tiene caché local: cada prueba dobla `leerRBAC` para no
 * depender de que haya un Apps Script contestando.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';

const leidas: unknown[] = [];
const rolesGuardados: unknown[] = [];
const usuariosGuardados: unknown[] = [];
let respuestaRoles: { status: string; message?: string } = { status: 'ok' };
let respuestaUsuarios: { status: string; message?: string } = { status: 'ok' };

vi.mock('../js/sync.js', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    leerRBAC: async () => {
        const datos = {
            roles: [
                {
                    clave: 'administrador', nombre: 'Administrador', descripcion: null, orden: 0,
                    activo: true, sistema: true, hereda_de: null,
                    capacidades: ['administracion.configurar'], efectivas: ['administracion.configurar'],
                    usuarios: 1, herederos: 0
                },
                {
                    clave: 'gerente', nombre: 'Gerente', descripcion: null, orden: 1,
                    activo: true, sistema: false, hereda_de: null,
                    capacidades: ['visitas.consultar'], efectivas: ['visitas.consultar'],
                    usuarios: 0, herederos: 0
                }
            ],
            capacidades: [
                { clave: 'administracion.configurar', modulo: 'administracion', accion: 'configurar',
                  nombre: 'Configurar', descripcion: null, grupo: 'Administración', orden: 0 },
                { clave: 'visitas.consultar', modulo: 'visitas', accion: 'consultar',
                  nombre: 'Consultar visitas', descripcion: null, grupo: 'Visitas', orden: 0 }
            ],
            usuarios: [
                { correo: 'ana@x.com', nombre: 'Ana', activo: true, roles: ['gerente'],
                  invitacion: 'aceptada', jefes: [], subordinados: ['beto@x.com'] },
                { correo: 'beto@x.com', nombre: 'Beto', activo: true, roles: [],
                  invitacion: 'aceptada', jefes: ['ana@x.com'], subordinados: [] }
            ]
        };
        leidas.push(datos);
        return { status: 'ok', ...datos };
    },
    guardarRoles: async (cambios: unknown) => { rolesGuardados.push(cambios); return respuestaRoles; },
    guardarUsuarios: async (cambios: unknown) => { usuariosGuardados.push(cambios); return respuestaUsuarios; }
}));

import { Administracion } from '@modules/administracion/components/Administracion';
import { guardarCatalogo } from '../js/storage.js';
import { olvidarPerfil } from '../js/permisos.js';

beforeEach(() => {
    localStorage.clear();
    leidas.length = 0;
    rolesGuardados.length = 0;
    usuariosGuardados.length = 0;
    respuestaRoles = { status: 'ok' };
    respuestaUsuarios = { status: 'ok' };
    olvidarPerfil();
    // Un catálogo mínimo para que el área Catálogos no reviente al montar.
    guardarCatalogo({
        tipos_actividad: [{ nombre: 'Capacitación' }],
        origenes: ['BI'], areas: ['Área'], unidades: ['Pieza'], tipos_evidencia: ['Foto'],
        sectores: [], sectores_ocultos: [], educadores: [], admins: []
    });
});

afterEach(cleanup);

const pintar = (props = {}) => render(<Administracion confirmar={() => true} {...props} />);
const irAAccesos = () => fireEvent.click(screen.getByText('Accesos'));
/** El nombre de un rol aparece también dentro de las opciones "Hereda de" de otros roles;
    `.tipo-nombre` es el único nodo que es DE VERDAD el encabezado de su propia ficha. */
const nombreDeRol = (nombre: string) => screen.getByText(nombre, { selector: '.tipo-nombre' });

describe('el conmutador de área', () => {
    test('arranca en Catálogos y no pide la red de Accesos hasta que se entra', () => {
        pintar();
        assert.ok(screen.getByText('Qué pide cada tipo de actividad'));
        assert.equal(leidas.length, 0, 'la carga de Accesos es perezosa');
    });

    test('entrar a Accesos carga roles, usuarios y jerarquía', async () => {
        pintar();
        await act(async () => { irAAccesos(); });

        await waitFor(() => assert.equal(leidas.length, 1));
        assert.ok(screen.getByRole('button', { name: 'Roles' }));
        assert.ok(nombreDeRol('Administrador'));
    });

    // El guardado de catálogos en sí no se vuelve a probar aquí: `tests/administracion.test.tsx`
    // ya lo cubre a fondo, y sigue en verde sin cambios — es la prueba de que el conmutador de
    // área no tocó ese camino.
});

describe('roles', () => {
    test('activar/desactivar un rol y guardar llama a guardarRoles con las claves esperadas', async () => {
        pintar();
        await act(async () => { irAAccesos(); });
        await waitFor(() => assert.ok(nombreDeRol('Administrador')));

        // Abre la ficha del rol "Gerente" y le agrega una capacidad, buscada DENTRO de su
        // propia ficha: "Configurar" se repite una vez por rol, y "Gerente" se repite también
        // dentro del selector "Hereda de" de Administrador.
        const gerenteResumen = nombreDeRol('Gerente');
        await act(async () => { fireEvent.click(gerenteResumen); });
        const fichaGerente = within(gerenteResumen.closest('details') as HTMLElement);
        await act(async () => { fireEvent.click(fichaGerente.getByText('Configurar')); });

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(rolesGuardados.length, 1);
        const enviado = rolesGuardados[0] as { roles: Array<{ clave: string; capacidades: string[] }>; eliminar: string[] };
        const gerente = enviado.roles.find(r => r.clave === 'gerente');
        assert.ok(gerente?.capacidades.includes('administracion.configurar'));
        assert.deepEqual(enviado.eliminar, []);
    });

    test('un rol de sistema no se puede borrar desde la pantalla', async () => {
        pintar();
        await act(async () => { irAAccesos(); });
        await waitFor(() => assert.ok(nombreDeRol('Administrador')));

        await act(async () => { fireEvent.click(nombreDeRol('Administrador')); });
        const borrar = screen.getByLabelText('Borrar Administrador') as HTMLButtonElement;
        assert.equal(borrar.disabled, true);
    });

    test('un error del servidor al guardar se muestra, no se traga', async () => {
        respuestaRoles = { status: 'error', message: 'Ese cambio dejaría la instalación sin administradores.' };
        const avisos: string[] = [];
        pintar({ avisar: (t: string) => avisos.push(t) });
        await act(async () => { irAAccesos(); });
        await waitFor(() => assert.ok(nombreDeRol('Administrador')));

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.ok(avisos.some(a => a.includes('sin administradores')));
    });
});

describe('usuarios', () => {
    test('asignar un rol a un usuario y guardar', async () => {
        pintar();
        await act(async () => { irAAccesos(); });
        await waitFor(() => assert.ok(nombreDeRol('Administrador')));

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Usuarios' })); });
        // "Beto" vive en el VALOR de un input, no como texto: `getByText` no lo vería.
        assert.ok(screen.getByDisplayValue('Beto'));

        // Cada usuario tiene un chip por rol activo; el de Beto es el segundo (Ana es la
        // primera fila, Beto la segunda). Beto no tiene roles: su chip "Gerente" está apagado.
        const chips = screen.getAllByText('Gerente');
        assert.equal(chips.length, 2, 'un chip "Gerente" por usuario');
        await act(async () => { fireEvent.click(chips[1]!); });

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        const enviado = usuariosGuardados[0] as { usuarios: Array<{ correo: string; roles: string[] }> };
        const beto = enviado.usuarios.find(u => u.correo === 'beto@x.com');
        assert.ok(beto?.roles.includes('gerente'));
    });
});

describe('jerarquía', () => {
    test('quitar al último subordinado envía la lista vacía, no la omite', async () => {
        pintar();
        await act(async () => { irAAccesos(); });
        await waitFor(() => assert.ok(nombreDeRol('Administrador')));

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Jerarquía' })); });
        // "Beto" también aparece como <option> en el selector de jefe; el chip es un botón.
        // Ana ya es el jefe seleccionado por defecto (primer usuario) y tiene a Beto marcado.
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Beto' })); });

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        const enviado = usuariosGuardados[0] as { jerarquia: Array<{ jefe: string; subordinados: string[] }> };
        assert.deepEqual(enviado.jerarquia, [{ jefe: 'ana@x.com', subordinados: [] }]);
    });
});
