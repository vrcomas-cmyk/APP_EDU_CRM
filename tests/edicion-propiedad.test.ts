/**
 * Quién puede ESCRIBIR sobre una visita.
 *
 * Es el tercero de los tres verbos —ver, calificar, modificar— y hasta ahora era el único sin
 * defender. No se podía editar lo ajeno, pero solo porque el drawer lee de `localStorage` y
 * ahí no llegan las visitas del equipo: la regla la sostenía la forma del almacenamiento, no
 * una regla. Estas pruebas la convierten en regla, para que sobreviva a la migración a
 * Supabase que va a cambiar esa forma.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';

import { puedeEditarVisita, motivoDeBloqueo } from '@modules/visitas/permissions/edicion';
import * as repo from '@modules/visitas/repository/visitasRepo';
import { guardarVisitas, leerVisitas } from '../js/storage.js';
import { visita } from './ayuda/fixtures.js';
import type { Visita } from '@core/tipos';

const YO = 'ana@degasa.com';
const OTRO = 'beto@degasa.com';

function comoSesion(correo: string | null) {
    if (!correo) { localStorage.removeItem('sesion'); return; }
    localStorage.setItem('sesion', JSON.stringify({
        correo, nombre: 'Quien Sea', id_token: 'x', expira: Date.now() + 3600e3
    }));
}

beforeEach(() => { localStorage.clear(); });

describe('de quién es una visita', () => {
    test('la mía sí', () => {
        comoSesion(YO);
        assert.equal(puedeEditarVisita(visita({ educador_correo: YO }) as Visita), true);
    });

    test('la de otro NO', () => {
        comoSesion(YO);
        assert.equal(puedeEditarVisita(visita({ educador_correo: OTRO }) as Visita), false);
    });

    test('compara sin distinguir mayúsculas ni espacios', () => {
        // El correo se escribe a mano en Administración y llega de Google en otra caja.
        comoSesion(YO);
        assert.equal(puedeEditarVisita(visita({ educador_correo: '  ANA@DEGASA.COM ' }) as Visita), true);
    });

    test('una visita SIN correo se deja editar: es local', () => {
        // Capturada antes de que existiera la sesión, o mientras Google aún no respondía.
        // Bloquearla dejaría un borrador imposible de guardar y sin salida.
        comoSesion(YO);
        assert.equal(puedeEditarVisita(visita({ educador_correo: '' }) as Visita), true);
    });

    test('sin sesión resuelta NO se bloquea la captura', () => {
        // La identidad de Google llega de forma asíncrona. Negar durante esa ventana dejaría
        // al educador sin poder guardar lo que acaba de hacer, que es lo único que esta app
        // tiene que poder hacer siempre.
        comoSesion(null);
        assert.equal(puedeEditarVisita(visita({ educador_correo: OTRO }) as Visita), true);
    });

    test('un nulo no revienta y no autoriza', () => {
        comoSesion(YO);
        assert.equal(puedeEditarVisita(null), false);
        assert.equal(puedeEditarVisita(undefined), false);
    });

    test('el administrador TAMPOCO pasa', () => {
        // No es una excepción olvidada. `guardarVisitas` reescribe el correo con la identidad
        // verificada y la fila se indexa por id: editar lo ajeno no lo deja «editado por el
        // jefe», lo pasa A NOMBRE del jefe y lo borra del historial de quien lo hizo.
        comoSesion(YO);
        localStorage.setItem('pdt_perfil_cache', JSON.stringify({
            correo: YO, nombre: 'Ana', rol: 'administrador', es_admin: true,
            permisos: [], alcance: [YO, OTRO], invitado: true, origen: 'prueba'
        }));

        assert.equal(puedeEditarVisita(visita({ educador_correo: OTRO }) as Visita), false);
    });

    test('el motivo dice de quién es y qué SÍ se puede hacer', () => {
        const m = motivoDeBloqueo(visita({ educador: 'Beto Ruiz', educador_correo: OTRO }) as Visita);
        assert.ok(m.includes('Beto Ruiz'));
        assert.ok(/revisarla|consultarla/.test(m), 'negar sin decir la alternativa es un muro');
    });
});

describe('el repositorio lo hace cumplir', () => {
    test('actualizar una visita ajena no cambia nada y lo dice devolviendo null', () => {
        comoSesion(YO);
        guardarVisitas([visita({ id: 'v-otro', educador_correo: OTRO, cliente: 'Original' })]);

        const r = repo.actualizarVisita('v-otro', v => { v.cliente = 'Pisado'; });

        assert.equal(r, null);
        assert.equal(leerVisitas()[0].cliente, 'Original',
            'la fila del servidor se indexa por id: esto la habría reatribuido');
    });

    test('actualizar la propia sí funciona', () => {
        comoSesion(YO);
        guardarVisitas([visita({ id: 'v-mia', educador_correo: YO, cliente: 'Original' })]);

        const r = repo.actualizarVisita('v-mia', v => { v.cliente = 'Nuevo'; });

        assert.ok(r);
        assert.equal(leerVisitas()[0].cliente, 'Nuevo');
    });

    test('borrar una visita ajena no la borra', () => {
        comoSesion(YO);
        guardarVisitas([visita({ id: 'v-otro', educador_correo: OTRO })]);

        repo.eliminarVisita('v-otro');

        assert.equal(leerVisitas().length, 1);
    });

    test('borrar la propia sí la borra', () => {
        comoSesion(YO);
        guardarVisitas([visita({ id: 'v-mia', educador_correo: YO })]);

        repo.eliminarVisita('v-mia');

        assert.equal(leerVisitas().length, 0);
    });

    test('una visita inexistente no autoriza por omisión', () => {
        comoSesion(YO);
        guardarVisitas([]);
        assert.equal(repo.actualizarVisita('no-existe', v => { v.cliente = 'X'; }), null);
    });
});
