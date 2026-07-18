/**
 * Validación de una actividad.
 *
 * Lo que se prueba aquí no es una lista de reglas: es que NO haya lista. El tipo de actividad
 * declara qué exige desde Administración, y la validación se limita a recorrer esa declaración.
 * Si alguna de estas pruebas necesitara tocar código para pasar con un requisito nuevo, la
 * promesa del módulo estaría rota.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    valorDe, faltantesDe, sePuedeGuardar, estaVacia, resumenDeFaltantes, MENSAJES
} from '@modules/actividades/validators/requisitos';

import {
    nuevaActividad, selloDeActividad, textoDelSello
} from '@modules/actividades/services/fabricas';

import type { Actividad, Sesion } from '@core/tipos';

const ponerCatalogo = (datos: unknown) => localStorage.setItem('datosPWA', JSON.stringify(datos));

/**
 * Define un tipo con EXACTAMENTE los modos que la prueba necesita.
 *
 * Todo lo no mencionado se pone en `oculto` a propósito. `configuracionCampos` devuelve
 * siempre los ocho campos con sus valores por defecto —y varios son obligatorios de fábrica—
 * así que sin apagarlos cada prueba arrastraría requisitos que no está probando, y el primer
 * faltante de la lista sería casi siempre `area_visitada`.
 */
const TODOS_LOS_CAMPOS = [
    'area_visitada', 'contacto_nombre', 'contacto_cargo', 'contacto_servicio',
    'materiales', 'evidencia', 'tipo_evidencia', 'fecha_documento'
];

function tipoConCampos(campos: Record<string, string>) {
    const apagados = Object.fromEntries(TODOS_LOS_CAMPOS.map(c => [c, 'oculto']));
    ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: { ...apagados, ...campos } }] });
}

const actividad = (campos: Partial<Actividad> = {}): Actividad => ({
    id: 'a-1',
    tipo: 'T',
    contacto: {},
    materiales: [],
    ...campos
});

beforeEach(() => limpiarAlmacen());

describe('valorDe — conoce la forma del árbol', () => {
    test('lee campos planos', () => {
        assert.equal(valorDe(actividad({ area_visitada: 'Urgencias' }), 'area_visitada'), 'Urgencias');
    });

    test('lee el contacto, que está anidado', () => {
        const a = actividad({ contacto: { nombre: 'Dr. Pérez', cargo: 'Jefe' } });
        assert.equal(valorDe(a, 'contacto_nombre'), 'Dr. Pérez');
        assert.equal(valorDe(a, 'contacto_cargo'), 'Jefe');
        assert.equal(valorDe(a, 'contacto_servicio'), '');
    });

    test('los materiales cuentan, no se leen', () => {
        assert.equal(valorDe(actividad({ materiales: [] }), 'materiales'), '');
        assert.equal(
            valorDe(actividad({ materiales: [{ id: 'm', material: 'GASA' }] }), 'materiales'),
            'si'
        );
    });

    test('la evidencia SIEMPRE cuenta como presente', () => {
        assert.equal(valorDe(actividad(), 'evidencia'), 'si',
            'es deuda, no requisito: exigir la foto de pie frente al cliente haría que no se registre nada');
    });

    test('un campo desconocido devuelve vacío en vez de reventar', () => {
        assert.equal(valorDe(actividad(), 'campo_inventado'), '');
    });

    test('una actividad sin contacto no rompe la lectura', () => {
        assert.equal(valorDe(actividad({ contacto: undefined }), 'contacto_nombre'), '');
    });
});

describe('faltantesDe — recorre la configuración, no una lista fija', () => {
    test('sin tipo, lo único que falta es el tipo', () => {
        const falta = faltantesDe(actividad({ tipo: '' }));

        assert.equal(falta.length, 1);
        assert.equal(falta[0]!.campoId, 'tipo');
        // Sin tipo no hay configuración que recorrer: enumerar más campos sería inventar
        // requisitos que todavía no se sabe si aplican.
    });

    test('lo declarado obligatorio se exige', () => {
        tipoConCampos({ area_visitada: 'obligatorio', contacto_nombre: 'obligatorio' });

        const falta = faltantesDe(actividad());
        assert.deepEqual(falta.map(f => f.campoId).sort(), ['area_visitada', 'contacto_nombre']);
    });

    test('lo OPCIONAL no se exige', () => {
        tipoConCampos({ area_visitada: 'opcional', contacto_nombre: 'opcional' });
        assert.deepEqual(faltantesDe(actividad()), []);
    });

    test('lo OCULTO tampoco', () => {
        tipoConCampos({ area_visitada: 'oculto' });
        assert.equal(faltantesDe(actividad()).some(f => f.campoId === 'area_visitada'), false);
    });

    test('lo SOLO-LECTURA tampoco: no se puede capturar', () => {
        tipoConCampos({ area_visitada: 'solo-lectura' });
        assert.equal(faltantesDe(actividad()).some(f => f.campoId === 'area_visitada'), false,
            'exigir lo que no se puede escribir dejaría el formulario imposible de guardar');
    });

    test('con los obligatorios llenos, se puede guardar', () => {
        tipoConCampos({ area_visitada: 'obligatorio', contacto_nombre: 'obligatorio' });

        const a = actividad({ area_visitada: 'Urgencias', contacto: { nombre: 'Dr. Pérez' } });
        assert.deepEqual(faltantesDe(a), []);
        assert.equal(sePuedeGuardar(a), true);
    });

    test('los espacios en blanco no llenan un obligatorio', () => {
        tipoConCampos({ contacto_nombre: 'obligatorio' });
        assert.equal(sePuedeGuardar(actividad({ contacto: { nombre: '   ' } })), false);
    });

    test('un material obligatorio se satisface con al menos uno', () => {
        tipoConCampos({ materiales: 'obligatorio' });

        assert.equal(sePuedeGuardar(actividad()), false);
        assert.equal(sePuedeGuardar(actividad({ materiales: [{ id: 'm', material: 'GASA' }] })), true);
    });

    test('la evidencia OBLIGATORIA no impide guardar', () => {
        tipoConCampos({ evidencia: 'obligatorio' });

        assert.equal(sePuedeGuardar(actividad()), true,
            'se salda después, cuando haya señal; bloquear aquí detendría al educador');
    });

    test('un requisito NUEVO se respeta sin tocar código', () => {
        // La prueba de la promesa del módulo: `fecha_documento` no aparece en ningún `if`.
        tipoConCampos({ fecha_documento: 'obligatorio' });

        assert.equal(sePuedeGuardar(actividad()), false);
        assert.equal(sePuedeGuardar(actividad({ fecha_documento: '2026-07-15' })), true);
    });

    test('cada faltante trae un mensaje en el idioma del educador', () => {
        tipoConCampos({ contacto_nombre: 'obligatorio' });

        const falta = faltantesDe(actividad());
        assert.equal(falta[0]!.mensaje, MENSAJES.contacto_nombre);
        assert.ok(!/campo|campoId|null/i.test(falta[0]!.mensaje),
            'el mensaje no debe hablar del modelo de datos');
    });

    test('un campo sin mensaje definido no deja al usuario sin explicación', () => {
        tipoConCampos({ area_visitada: 'obligatorio' });
        const falta = faltantesDe(actividad());
        assert.ok(falta[0]!.mensaje.length > 0);
    });

    test('los DEFAULTS del catálogo también se respetan', () => {
        // Un tipo que no configura nada hereda los valores de fábrica, y varios son
        // obligatorios. Es el lado seguro: un tipo recién creado pide lo básico en vez de
        // aceptar una actividad sin área ni contacto.
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T' }] });

        const campos = faltantesDe(actividad()).map(f => f.campoId);
        assert.ok(campos.includes('area_visitada'));
        assert.ok(campos.includes('contacto_nombre'));
    });
});

describe('resumenDeFaltantes', () => {
    test('singular y plural, porque se lee en pantalla', () => {
        assert.match(resumenDeFaltantes([{ campoId: 'x', mensaje: 'm' }]), /Falta un dato/);
        assert.match(
            resumenDeFaltantes([{ campoId: 'x', mensaje: 'm' }, { campoId: 'y', mensaje: 'm' }]),
            /Faltan 2 datos/
        );
    });
});

describe('estaVacia — distinguir un error de clic de una captura a medias', () => {
    test('una actividad recién creada está vacía', () => {
        assert.equal(estaVacia(nuevaActividad((p) => `${p}-1`)), true);
    });

    test('cualquier dato capturado la vuelve no vacía', () => {
        assert.equal(estaVacia(actividad({ tipo: 'Capacitación' })), false);
        assert.equal(estaVacia(actividad({ tipo: '', area_visitada: 'Urgencias' })), false);
        assert.equal(estaVacia(actividad({ tipo: '', contacto: { nombre: 'Dr.' } })), false);
        assert.equal(estaVacia(actividad({ tipo: '', materiales: [{ id: 'm', material: 'G' }] })), false);
    });

    test('un nombre de contacto en blanco no cuenta como captura', () => {
        assert.equal(estaVacia(actividad({ tipo: '', contacto: { nombre: '  ' } })), true);
    });
});

describe('nuevaActividad', () => {
    test('nace sin sello: es un borrador', () => {
        const a = nuevaActividad((p) => `${p}-1`);
        assert.equal(a.guardada, undefined);
        assert.equal(a.id, 'a-1');
    });

    test('su evidencia nace PENDIENTE, no local', () => {
        assert.equal(nuevaActividad((p) => `${p}-1`).evidencia?.estado, 'pendiente',
            'local significaría que hay un archivo esperando subir, y no lo hay');
    });

    test('registra cuándo se creó', () => {
        const a = nuevaActividad((p) => `${p}-1`, new Date('2026-07-15T10:00:00.000Z'));
        assert.equal(a.creada, '2026-07-15T10:00:00.000Z');
    });
});

describe('selloDeActividad', () => {
    const sesion: Sesion = { correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x' };

    test('guarda quién, cuándo y desde dónde', () => {
        const s = selloDeActividad(sesion, 'Android · Chrome', new Date('2026-07-15T10:00:00.000Z'));

        assert.equal(s.usuario, 'Ana López');
        assert.equal(s.usuario_correo, 'ana@x.com');
        assert.equal(s.momento, '2026-07-15T10:00:00.000Z');
        assert.equal(s.dispositivo, 'Android · Chrome',
            'desde dónde se capturó es parte de lo que la actividad afirma');
    });

    test('sin sesión no inventa un usuario', () => {
        const s = selloDeActividad(null, 'Android');
        assert.equal(s.usuario, '');
        assert.equal(s.usuario_correo, '');
    });
});

describe('textoDelSello', () => {
    test('dice cuándo y quién', () => {
        const texto = textoDelSello({
            momento: '2026-07-15T16:30:00.000Z', usuario: 'Ana López'
        });
        assert.match(texto, /Guardada el/);
        assert.match(texto, /Ana López/);
    });

    test('sin usuario no deja un "por" colgando', () => {
        const texto = textoDelSello({ momento: '2026-07-15T16:30:00.000Z' });
        assert.ok(!/por\s*$/.test(texto));
    });

    test('un sello MIGRADO no finge una firma que nunca existió', () => {
        const texto = textoDelSello({ momento: 'x', usuario: 'Ana', migrada: true });

        assert.match(texto, /antes de que existiera el guardado/);
        assert.ok(!/Guardada el/.test(texto),
            'presentar una firma inventada es peor que no tener ninguna');
    });

    test('sin sello devuelve un guion, no "undefined"', () => {
        assert.equal(textoDelSello(undefined), '—');
    });
});
