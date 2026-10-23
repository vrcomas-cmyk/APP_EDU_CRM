/**
 * Que lo que Administración configura de verdad llegue a las validaciones.
 *
 * `catalogos.test.js` prueba la resolución de modos; aquí se prueba el otro extremo: que
 * visita, sector, estrategia y actividad dejen de tener reglas escritas a mano.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import { faltaEnSector, sectorCompleto } from '../src/modules/sectores/validators/requisitos';
import { faltaParaGuardar } from '../src/modules/visitas/validators/requisitos';
import { faltaEnEstrategia } from '../src/modules/estrategias/validators/requisitos';
import { faltantesDe } from '../src/modules/actividades/validators/requisitos';
import { olvidarPerfil } from '../js/permisos.js';

const ponerCatalogo = (datos: unknown) => localStorage.setItem('datosPWA', JSON.stringify(datos));

beforeEach(() => {
    limpiarAlmacen();
    olvidarPerfil();
});

describe('sector', () => {
    test('por defecto exige los tres', () => {
        assert.deepEqual(faltaEnSector({}), ['Objetivo', 'Origen de la actividad', 'Solicitado por']);
    });

    test('lo que Administración vuelve opcional u oculto deja de exigirse', () => {
        ponerCatalogo({ formularios: { sector: { objetivo: 'opcional', solicitado_por: 'oculto' } } });
        assert.deepEqual(faltaEnSector({}), ['Origen de la actividad']);
        assert.equal(sectorCompleto({ origen: ['BI'] }), true);
    });
});

describe('visita', () => {
    const visita = {
        id: 'v', educador: 'Ana', cliente: 'Prospecto', es_prospecto: true,
        dia: '2026-10-06', hora_inicio: '09:00', hora_fin: '10:00'
    };

    test('hospital y sectores se exigen por defecto', () => {
        assert.deepEqual(faltaParaGuardar(visita), ['Hospital', 'Al menos un sector']);
    });

    test('se pueden volver opcionales', () => {
        ponerCatalogo({ formularios: { visita: { hospital: 'opcional', sectores: 'opcional' } } });
        assert.deepEqual(faltaParaGuardar(visita), []);
    });

    test('educador, cliente, fecha y horario no se pueden relajar', () => {
        ponerCatalogo({ formularios: { visita: { educador: 'opcional', fecha: 'oculto', horario: 'oculto' } } });
        assert.ok(faltaParaGuardar({ id: 'v' }).includes('Educador'));
        assert.ok(faltaParaGuardar({ id: 'v' }).includes('Fecha'));
    });
});

describe('estrategia', () => {
    const base = {
        cliente: 'Hospital X', sector: 'GASAS', grupo: 'Gasas', tipo: '', etapa: '',
        proyecto: '', productos: [] as string[], observaciones: ''
    };

    test('por defecto son obligatorios cliente, sector y grupo de artículo', () => {
        assert.deepEqual(faltaEnEstrategia(base), []);
        assert.deepEqual(faltaEnEstrategia({ ...base, cliente: ' ' }), ['Cliente']);
        assert.deepEqual(
            faltaEnEstrategia({ ...base, sector: '', grupo: '' }),
            ['Sector', 'Grupo de artículo']
        );
    });

    test('Administración puede exigir etapa y productos', () => {
        ponerCatalogo({ formularios: { estrategia: { etapa: 'obligatorio', productos: 'obligatorio' } } });
        assert.deepEqual(faltaEnEstrategia(base), ['Etapa', 'Productos']);
        assert.deepEqual(faltaEnEstrategia({ ...base, etapa: 'Venta', productos: ['GASA'] }), []);
    });
});

describe('actividad: "obligatorio después" no bloquea, "obligatorio" sí', () => {
    const actividad = { id: 'a', tipo: 'Seguimiento', area_visitada: 'Área Usuaria', contacto: { nombre: 'Dr. X' } };

    test('resultado_seguimiento obligatorio después no bloquea el guardado', () => {
        ponerCatalogo({ formularios: {}, tipos_actividad: [{
            nombre: 'Seguimiento', campos: { resultado_seguimiento: 'obligatorio-despues' }
        }] });
        assert.deepEqual(faltantesDe(actividad), []);
    });

    test('resultado_seguimiento obligatorio bloquea hasta que se captura', () => {
        ponerCatalogo({ formularios: {}, tipos_actividad: [{
            nombre: 'Seguimiento', campos: { resultado_seguimiento: 'obligatorio' }
        }] });
        assert.deepEqual(faltantesDe(actividad).map(f => f.campoId), ['resultado_seguimiento']);
        assert.deepEqual(faltantesDe({ ...actividad, resultado_seguimiento: 'Aceptó' }), []);
    });

    test('los campos del material nunca bloquean la actividad', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: { material_origen: 'obligatorio' } }] });
        assert.deepEqual(faltantesDe({ ...actividad, tipo: 'T' }), []);
    });
});

describe('reagendar y cancelar: el motivo se configura', () => {
    // Imports dinámicos más abajo para no alterar el orden de los de arriba.
    test('por defecto el motivo de cancelar es obligatorio', async () => {
        const { agregarVisita } = await import('../js/storage.js');
        const { cancelarVisita } = await import('../js/visita.js');
        const { visita } = await import('./ayuda/fixtures.js');

        const v = agregarVisita(visita({ estado: 'programada' }));
        assert.equal((cancelarVisita(v.id, '') as { ok: boolean }).ok, false);
    });

    test('Administración puede volverlo opcional', async () => {
        const { agregarVisita } = await import('../js/storage.js');
        const { cancelarVisita } = await import('../js/visita.js');
        const { visita } = await import('./ayuda/fixtures.js');

        ponerCatalogo({ formularios: { cancelar: { motivo: 'opcional' } } });
        const v = agregarVisita(visita({ estado: 'programada' }));
        assert.equal((cancelarVisita(v.id, '') as { ok: boolean }).ok, true);
    });

    test('el motivo de reagendar opcional deja reagendar sin escribir nada', async () => {
        const { agregarVisita } = await import('../js/storage.js');
        const { reagendarVisita } = await import('../js/visita.js');
        const { visita } = await import('./ayuda/fixtures.js');

        const v = agregarVisita(visita({ estado: 'programada', dia: '2026-10-06', hora_inicio: '09:00', hora_fin: '10:00' }));
        assert.equal((reagendarVisita(v.id, { dia: '2026-10-07', hora_inicio: '09:00', hora_fin: '10:00', motivo: '' }) as { ok: boolean }).ok, false);

        ponerCatalogo({ formularios: { reagendar: { motivo: 'opcional' } } });
        assert.equal((reagendarVisita(v.id, { dia: '2026-10-07', hora_inicio: '09:00', hora_fin: '10:00', motivo: '' }) as { ok: boolean }).ok, true);
    });

    test('el motivo no se puede ocultar: es el único lugar donde se captura', async () => {
        const { modoEnFormulario } = await import('../js/catalogos.js');
        ponerCatalogo({ formularios: { cancelar: { motivo: 'oculto' }, reagendar: { motivo: 'oculto' } } });
        assert.equal(modoEnFormulario('cancelar', 'motivo'), 'obligatorio');
        assert.equal(modoEnFormulario('reagendar', 'motivo'), 'obligatorio');
    });
});
