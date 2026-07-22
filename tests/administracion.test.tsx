/**
 * @vitest-environment happy-dom
 *
 * Administración: el borrador de catálogos y su pantalla.
 *
 * Lo que se vigila aquí es que NO se pueda publicar un catálogo roto. Estos datos los usan
 * todos los educadores en el siguiente sync, así que un error no se queda en una pantalla: se
 * reparte. La validación es la única barrera.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';

// Se dobla la subida —y SOLO la subida—: es la única frontera de red del módulo, y sin esto
// las pruebas dependerían de que hubiera un Apps Script contestando.
const subidas: unknown[] = [];
vi.mock('../js/sync.js', async (original) => ({
    ...(await original<Record<string, unknown>>()),
    guardarCatalogosAdmin: async (cambios: unknown) => { subidas.push(cambios); return { ok: true }; },
    descargarCatalogo: async () => ({ ok: true })
}));

import { Administracion } from '@modules/administracion/components/Administracion';
import {
    borradorDesdeCatalogo, conCampo, conCorreoDeEducador, conAdmin, sinEducador,
    problemasDe, resumenDeTipo, tipoNuevo
} from '@modules/administracion/services/borrador';

import { guardarCatalogo } from '../js/storage.js';
import { olvidarPerfil } from '../js/permisos.js';
import { MODOS as _MODOS } from '../js/catalogos.js';

// `js/catalogos.js` es JavaScript: sus valores llegan como `string`. Se estrechan una sola vez
// aquí en vez de repetir un `as` en cada uso.
const MODOS = _MODOS as Record<'OBLIGATORIO' | 'OPCIONAL' | 'SOLO_LECTURA' | 'OCULTO', ModoCampo>;
import type { BorradorCatalogo, ModoCampo } from '@core/tipos';

/** Un catálogo completo y válido, del que cada prueba pisa solo lo suyo. */
function catalogoSano(extra: Record<string, unknown> = {}) {
    return {
        tipos_actividad: [{ nombre: 'Capacitación', evidencia: true, materiales: false }],
        origenes: ['BI'],
        areas: ['Área Usuaria'],
        unidades: ['Pieza'],
        tipos_evidencia: ['Fotografía'],
        sectores: ['GASAS', 'SUTURAS'],
        sectores_ocultos: [],
        educadores: [{ nombre: 'Ana López', correo: 'ana@degasa.com' }],
        admins: ['ana@degasa.com'],
        ...extra
    };
}

const borradorSano = (extra: Partial<BorradorCatalogo> = {}): BorradorCatalogo => ({
    tipos_actividad: [{ nombre: 'Capacitación' }],
    origenes: ['BI'], areas: ['Área Usuaria'], unidades: ['Pieza'], tipos_evidencia: ['Foto'],
    sectores_ocultos: [],
    educadores: [{ nombre: 'Ana', correo: 'ana@x.com' }],
    admins: [],
    ...extra
});

beforeEach(() => {
    localStorage.clear();
    subidas.length = 0;
    olvidarPerfil();
});

afterEach(cleanup);

// ---------- el borrador ----------

describe('materializar el borrador', () => {
    test('resuelve la configuración de campos en vez de dejarla vacía', () => {
        guardarCatalogo(catalogoSano());
        const b = borradorDesdeCatalogo();

        // Ver una tabla vacía haría creer que el tipo está «sin configurar» e invitaría a
        // rellenarlo de nuevo, cuando en realidad ya tiene reglas activas.
        assert.ok(Object.keys(b.tipos_actividad[0]!.campos!).length >= 8);
        assert.equal(b.tipos_actividad[0]!.campos!.area_visitada, MODOS.OBLIGATORIO);
    });

    test('sin catálogo no revienta: devuelve todo vacío', () => {
        const b = borradorDesdeCatalogo();
        assert.deepEqual(b.tipos_actividad, []);
        assert.deepEqual(b.admins, []);
    });

    test('un tipo nuevo arranca con los modos por defecto, no en blanco', () => {
        const t = tipoNuevo();
        assert.equal(t.campos!.area_visitada, MODOS.OBLIGATORIO);
        assert.equal(t.campos!.materiales, MODOS.OCULTO);
    });
});

describe('las banderas viejas siguen a los campos', () => {
    test('ocultar la evidencia apaga la bandera `evidencia`', () => {
        const t = conCampo({ nombre: 'X', evidencia: true }, 'evidencia', MODOS.OCULTO);
        assert.equal(t.evidencia, false);
    });

    test('pedirla obligatoria la enciende', () => {
        const t = conCampo({ nombre: 'X', evidencia: false }, 'evidencia', MODOS.OBLIGATORIO);
        assert.equal(t.evidencia, true);
    });

    test('materiales solo cuenta como bandera si es OBLIGATORIO', () => {
        assert.equal(conCampo({ nombre: 'X' }, 'materiales', MODOS.OPCIONAL).materiales, false);
        assert.equal(conCampo({ nombre: 'X' }, 'materiales', MODOS.OBLIGATORIO).materiales, true);
    });

    test('los demás campos no tocan ninguna bandera', () => {
        const t = conCampo({ nombre: 'X', evidencia: true, materiales: true },
                           'contacto_cargo', MODOS.OCULTO);
        assert.equal(t.evidencia, true);
        assert.equal(t.materiales, true);
    });

    test('el resumen cuenta obligatorios y ocultos, y concuerda en singular', () => {
        const t = { nombre: 'X', campos: { area_visitada: MODOS.OBLIGATORIO, evidencia: MODOS.OCULTO } };
        assert.equal(resumenDeTipo(t), '1 obligatorio · 1 oculto');
    });
});

describe('quién es administrador', () => {
    test('cambiar el correo ARRASTRA la condición de admin', () => {
        // Sin esto la persona pierde el acceso en silencio y solo se entera el día que no
        // puede entrar. El módulo vanilla lo tenía anotado como pendiente y nunca se hizo.
        const b = borradorSano({
            educadores: [{ nombre: 'Ana', correo: 'ana@viejo.com' }],
            admins: ['ana@viejo.com']
        });

        const salida = conCorreoDeEducador(b, 0, 'ana@nuevo.com');

        assert.deepEqual(salida.admins, ['ana@nuevo.com']);
        assert.equal(salida.educadores[0]!.correo, 'ana@nuevo.com');
    });

    test('cambiar el correo de quien NO era admin no lo convierte en uno', () => {
        const b = borradorSano({
            educadores: [{ nombre: 'Ana', correo: 'ana@viejo.com' }], admins: []
        });
        assert.deepEqual(conCorreoDeEducador(b, 0, 'ana@nuevo.com').admins, []);
    });

    test('el correo se normaliza: se compara con lo que verifica la sesión', () => {
        const b = borradorSano({ educadores: [{ nombre: 'Ana', correo: '' }] });
        assert.equal(conCorreoDeEducador(b, 0, '  ANA@X.COM ').educadores[0]!.correo, 'ana@x.com');
    });

    test('borrar a un educador le retira el acceso: si no, queda un admin fantasma', () => {
        const b = borradorSano({
            educadores: [{ nombre: 'Ana', correo: 'ana@x.com' }, { nombre: 'Beto', correo: 'b@x.com' }],
            admins: ['ana@x.com', 'b@x.com']
        });

        const salida = sinEducador(b, 0);
        assert.deepEqual(salida.admins, ['b@x.com']);
        assert.equal(salida.educadores.length, 1);
    });

    test('nombrar admin a alguien sin correo no agrega una entrada vacía', () => {
        assert.deepEqual(conAdmin(borradorSano(), '', true).admins, []);
    });
});

describe('qué impide publicar un catálogo', () => {
    test('un borrador sano no tiene problemas', () => {
        assert.deepEqual(problemasDe(borradorSano()), []);
    });

    test('un tipo sin nombre', () => {
        const p = problemasDe(borradorSano({ tipos_actividad: [{ nombre: '  ' }] }));
        assert.ok(p.some(x => x.includes('sin nombre')));
    });

    test('dos tipos con el mismo nombre, aunque cambie la caja', () => {
        const p = problemasDe(borradorSano({
            tipos_actividad: [{ nombre: 'Capacitación' }, { nombre: 'CAPACITACIÓN' }]
        }));
        assert.ok(p.some(x => x.includes('mismo nombre')));
    });

    test('un educador a medias', () => {
        const p = problemasDe(borradorSano({ educadores: [{ nombre: 'Ana', correo: '' }] }));
        assert.ok(p.some(x => x.includes('educador')));
    });

    test('una lista vacía, aunque la app tenga defaults', () => {
        // No rompe nada —`catalogos.js` cae en sus defaults— pero el administrador creería
        // haberla borrado y seguiría viendo opciones.
        const p = problemasDe(borradorSano({ origenes: [] }));
        assert.ok(p.some(x => x.includes('Orígenes')));
    });

    test('quedarse sin ningún tipo de actividad', () => {
        const p = problemasDe(borradorSano({ tipos_actividad: [] }));
        assert.ok(p.some(x => x.includes('ningún tipo')));
    });

    test('se reportan TODOS los problemas, no el primero', () => {
        const p = problemasDe(borradorSano({
            tipos_actividad: [{ nombre: '' }], origenes: [], areas: []
        }));
        // Corregir de uno en uno, con una confirmación por vuelta, es cómo se abandona.
        assert.ok(p.length >= 3, `se esperaban varios, salieron ${p.length}`);
    });
});

// ---------- la pantalla ----------

const pintar = (props = {}) => render(
    <Administracion confirmar={() => true} {...props} />
);

describe('la pantalla', () => {
    test('arranca en Tipos y cambia de sección', () => {
        guardarCatalogo(catalogoSano());
        pintar();

        assert.ok(screen.getByText('Qué pide cada tipo de actividad'));

        fireEvent.click(screen.getByText('Equipo'));
        assert.ok(screen.getByText('Educadores'));
        assert.equal(screen.queryByText('Qué pide cada tipo de actividad'), null);
    });

    test('los sectores se curan, no se escriben', () => {
        guardarCatalogo(catalogoSano());
        pintar();
        fireEvent.click(screen.getByText('Sectores'));

        assert.ok(screen.getByText('2 de 2 activos'));
        // Un campo para escribir aquí produciría sectores sin materiales detrás, cuyo buscador
        // sale siempre vacío: indiagnosticable desde un pasillo.
        assert.equal(document.querySelector('.vista-admin input[type="text"]'), null);
    });

    test('apagar un sector lo cuenta como oculto', async () => {
        guardarCatalogo(catalogoSano());
        pintar();
        fireEvent.click(screen.getByText('Sectores'));

        await act(async () => { fireEvent.click(screen.getByText('GASAS')); });

        assert.ok(screen.getByText('1 de 2 activos'));
    });

    test('un catálogo válido se sube entero', async () => {
        guardarCatalogo(catalogoSano());
        pintar();

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(subidas.length, 1);
        const enviado = subidas[0] as BorradorCatalogo;
        assert.equal(enviado.tipos_actividad[0]!.nombre, 'Capacitación');
        assert.deepEqual(enviado.admins, ['ana@degasa.com']);
    });

    test('un catálogo roto NO se sube, y se dice por qué', async () => {
        // Sin ningún tipo de actividad sí es un catálogo roto de verdad: no hay default que
        // lo tape, porque un tipo inventado no significaría nada.
        guardarCatalogo(catalogoSano({ tipos_actividad: [] }));

        const avisos: string[] = [];
        pintar({ avisar: (t: string) => avisos.push(t) });

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(subidas.length, 0, 'esto lo usan TODOS los educadores');
        assert.ok(avisos[0]?.includes('tipo de actividad'));
    });

    test('listas simples vacías (Orígenes, Áreas…) caen en sus defaults y SÍ se suben', async () => {
        // Antes del fix, `origenes: []` en el catálogo (una pestaña que Administración aún no
        // ha creado) dejaba el panel bloqueado para siempre: sin guardar una vez no se crea la
        // pestaña, y sin la pestaña la lista se ve vacía. `borradorDesdeCatalogo` ahora usa los
        // mismos defaults que ya usa el formulario de captura.
        guardarCatalogo(catalogoSano({ origenes: [] }));
        pintar();

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(subidas.length, 1);
        const enviado = subidas[0] as BorradorCatalogo;
        assert.ok(enviado.origenes.length > 0);
    });

    test('decir que no en la confirmación no sube nada', async () => {
        guardarCatalogo(catalogoSano());
        pintar({ confirmar: () => false });

        await act(async () => { fireEvent.click(screen.getByText('Guardar cambios')); });

        assert.equal(subidas.length, 0);
    });

    test('avisa de que hay cambios sin guardar, y Descartar los deshace', async () => {
        guardarCatalogo(catalogoSano());
        pintar();
        fireEvent.click(screen.getByText('Equipo'));

        assert.ok(screen.getByText('Sin cambios.'));

        const nombre = document.querySelector('.admin-fila input[type="text"]') as HTMLInputElement;
        await act(async () => { fireEvent.change(nombre, { target: { value: 'Ana Cambiada' } }); });

        assert.ok(screen.getByText('Hay cambios sin guardar.'));

        await act(async () => { fireEvent.click(screen.getByText('Descartar')); });

        assert.ok(screen.getByText('Sin cambios.'));
        assert.equal(
            (document.querySelector('.admin-fila input[type="text"]') as HTMLInputElement).value,
            'Ana López');
    });

    test('agregar a una lista con Enter, y quitar con la ✕', async () => {
        guardarCatalogo(catalogoSano());
        pintar();
        fireEvent.click(screen.getByText('Listas'));

        const campo = screen.getByLabelText('Agregar a Orígenes de la actividad');
        await act(async () => {
            fireEvent.change(campo, { target: { value: 'Ventas' } });
            fireEvent.keyDown(campo, { key: 'Enter' });
        });

        assert.ok(screen.getByText('Ventas'));

        await act(async () => { fireEvent.click(screen.getByLabelText('Quitar Ventas')); });
        assert.equal(screen.queryByText('Ventas'), null);
    });

    test('lo escrito sin pulsar Enter no se pierde al salir del campo', async () => {
        // Antes se perdía en silencio: se escribía el valor, se pulsaba «Guardar» y no estaba.
        guardarCatalogo(catalogoSano());
        pintar();
        fireEvent.click(screen.getByText('Listas'));

        const campo = screen.getByLabelText('Agregar a Orígenes de la actividad');
        await act(async () => {
            fireEvent.change(campo, { target: { value: 'I&D' } });
            fireEvent.blur(campo);
        });

        assert.ok(screen.getByText('I&D'));
    });

    test('borrar un tipo pide confirmación', async () => {
        guardarCatalogo(catalogoSano());

        let preguntado = '';
        pintar({ confirmar: (m: string) => { preguntado = m; return false; } });

        fireEvent.click(screen.getByText('Capacitación'));
        await act(async () => { fireEvent.click(screen.getByLabelText('Borrar Capacitación')); });

        assert.ok(preguntado.includes('no se tocan'),
            'debe decir que las actividades ya registradas se conservan');
        assert.ok(screen.getByText('Capacitación'), 'al decir que no, sigue ahí');
    });
});
