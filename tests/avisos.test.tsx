/**
 * @vitest-environment happy-dom
 *
 * Avisos al educador: lo que un revisor le devolvió. Estado en memoria, bandeja y la regla de qué
 * veredictos avisan (que en el servidor la aplica un trigger; aquí se comprueba la intención y
 * la forma de la migración).
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, cleanup, fireEvent } from '@testing-library/react';

import {
    ponerAvisos, avisosAbiertos, avisosSinLeer, hayAvisosCargados, marcarLocal, olvidarAvisos
} from '../js/avisos.js';
import { RESULTADOS_POR_DEFECTO } from '../js/revisiones.js';
import { agregarVisita } from '../js/storage.js';
import { MODULOS } from '../src/app/navegacion/modulos';
import { visita as visitaDePrueba, sector as sectorDePrueba, actividad as actividadDePrueba } from './ayuda/fixtures.js';

const marcarAvisos = vi.fn(async () => true);
const abrirVisita = vi.fn();
vi.mock('../src/core/puente', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    marcarAvisos: (...a: unknown[]) => (marcarAvisos as (...x: unknown[]) => unknown)(...a)
}));
vi.mock('../src/modules/visitas/montarDrawer', () => ({ abrirVisita: (...a: unknown[]) => abrirVisita(...a) }));

import { BandejaAvisos } from '../src/modules/avisos/components/BandejaAvisos';

const aviso = (extra: Record<string, unknown> = {}) => ({
    id: 'av-1', tipo: 'revision', flujo: 'evidencia', ambito: 'actividad', id_ambito: 'a-1', id_visita: 'v-1',
    resultado: 'rechazado', etiqueta: 'Rechazado', titulo: 'Rechazado · Evidencias',
    detalle: 'La foto está borrosa, súbela de nuevo.', cliente: '100116 CLIENTE', hospital: 'Hospital X',
    dia_visita: '2026-10-03', revisor: 'Sandra', creado_en: '2026-10-06T15:00:00Z',
    leido_en: null, resuelto_en: null, ...extra
});

beforeEach(() => { localStorage.clear(); olvidarAvisos(); marcarAvisos.mockClear(); abrirVisita.mockClear(); });
afterEach(() => { cleanup(); document.body.replaceChildren(); });

describe('estado de avisos', () => {
    test('null es "aún no se baja nada", distinto de "cero avisos"', () => {
        assert.equal(hayAvisosCargados(), false);
        ponerAvisos([]);
        assert.equal(hayAvisosCargados(), true);
        assert.equal(avisosAbiertos().length, 0);
    });

    test('devuelve como nuevos solo los no leídos que no se conocían', () => {
        const nuevos = ponerAvisos([aviso(), aviso({ id: 'av-2', leido_en: '2026-10-06T16:00:00Z' })]);
        assert.deepEqual(nuevos.map((a: { id: string }) => a.id), ['av-1']);

        // La misma bajada otra vez no vuelve a anunciar lo ya conocido.
        assert.deepEqual(ponerAvisos([aviso(), aviso({ id: 'av-2' })]).map((a: { id: string }) => a.id), []);
        // Uno realmente nuevo sí.
        assert.deepEqual(ponerAvisos([aviso(), aviso({ id: 'av-3' })]).map((a: { id: string }) => a.id), ['av-3']);
    });

    test('una marca local sobrevive a una bajada que aún no la trae', () => {
        ponerAvisos([aviso()]);
        marcarLocal(['av-1'], 'resuelto');
        assert.equal(avisosAbiertos().length, 0);

        ponerAvisos([aviso()]);   // el servidor todavía lo trae abierto
        assert.equal(avisosAbiertos().length, 0, 'no reaparece');
    });

    test('abiertos del más reciente al más viejo; sin leer es un subconjunto', () => {
        ponerAvisos([
            aviso({ id: 'a', creado_en: '2026-10-01T00:00:00Z' }),
            aviso({ id: 'b', creado_en: '2026-10-05T00:00:00Z', leido_en: '2026-10-05T01:00:00Z' })
        ]);
        assert.deepEqual(avisosAbiertos().map((a: { id: string }) => a.id), ['b', 'a']);
        assert.deepEqual(avisosSinLeer().map((a: { id: string }) => a.id), ['a']);
    });
});

describe('bandeja de avisos', () => {
    test('muestra la observación del revisor y de dónde viene', () => {
        ponerAvisos([aviso()]);
        const { container } = render(<BandejaAvisos />);

        const texto = container.textContent || '';
        assert.match(texto, /Rechazado · Evidencias/);
        assert.match(texto, /Sandra dice:/);
        assert.match(texto, /La foto está borrosa/);
        assert.match(texto, /Hospital X/);
        assert.match(texto, /03\/10\/2026/, 'la fecha se lee dd/mm/aaaa');
    });

    test('abrirla marca como leídos los que no lo estaban (pero siguen en la lista)', () => {
        ponerAvisos([aviso()]);
        render(<BandejaAvisos />);

        assert.deepEqual(marcarAvisos.mock.calls[0], [['av-1'], 'leido']);
        assert.equal(avisosAbiertos().length, 1);
        assert.equal(avisosSinLeer().length, 0);
    });

    test('"Abrir la visita" lleva a la visita del aviso', () => {
        ponerAvisos([aviso()]);
        const { getByText } = render(<BandejaAvisos />);
        fireEvent.click(getByText('Abrir la visita'));
        assert.deepEqual(abrirVisita.mock.calls[0], ['v-1']);
    });

    test('"Ya lo corregí" lo quita de la lista y lo resuelve en el servidor', async () => {
        ponerAvisos([aviso()]);
        const { getByText, container } = render(<BandejaAvisos />);

        fireEvent.click(getByText('Ya lo corregí'));

        await vi.waitFor(() => assert.equal(avisosAbiertos().length, 0));
        assert.deepEqual(marcarAvisos.mock.calls.at(-1), [['av-1'], 'resuelto']);
        await vi.waitFor(() => assert.match(container.textContent || '', /Todo en orden/));
    });

    test('un aviso sin observación lo dice en vez de quedar en blanco', () => {
        ponerAvisos([aviso({ detalle: null })]);
        const { container } = render(<BandejaAvisos />);
        assert.match(container.textContent || '', /no dejó observación/);
    });

    test('mientras no se ha bajado nada no promete que esté vacía', () => {
        const { container } = render(<BandejaAvisos />);
        assert.doesNotMatch(container.textContent || '', /Todo en orden/);
    });
});

describe('qué veredictos avisan', () => {
    test('por defecto avisan "requiere corrección" y "rechazado", no "aprobado"', () => {
        const avisa = Object.fromEntries(RESULTADOS_POR_DEFECTO.map((r: { valor: string; avisa_educador?: boolean }) => [r.valor, r.avisa_educador]));
        assert.equal(avisa.correccion, true);
        assert.equal(avisa.rechazado, true);
        assert.notEqual(avisa.aprobado, true);
    });
});

describe('migración de avisos (forma)', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261008_pdt_avisos.sql'), 'utf8');

    test('el aviso lo crea un trigger sobre las revisiones, en la misma transacción', () => {
        assert.match(sql, /create trigger trg_pdt_avisos_de_revision\s+after insert on pdt_revisiones/);
        assert.match(sql, /on conflict \(id_revision\) do nothing/, 'un reenvío no duplica');
    });

    test('lectura y marca solo con la sesión: el correo sale del token, nunca del cliente', () => {
        for (const fn of ['pdt_avisos_mios_sesion', 'pdt_avisos_marcar_sesion']) {
            const cuerpo = sql.slice(sql.indexOf(`function ${fn}(`));
            assert.match(cuerpo.slice(0, 600), /pdt_correo_de_sesion\(p_sesion_token\)/);
            assert.doesNotMatch(cuerpo.slice(0, 700), /p_correo/);
        }
        assert.match(sql, /revoke execute on function pdt_avisos_mios_sesion[^;]* from public;/);
        assert.match(sql, /destinatario_correo = lower\(v_correo\)/, 'solo los del dueño de la sesión');
    });

    test('la tabla tiene RLS y la función del trigger no es ejecutable por la clave pública', () => {
        assert.match(sql, /alter table pdt_avisos enable row level security;/);
        assert.match(sql, /revoke execute on function pdt_avisos_de_revision\(\) from public, anon, authenticated;/);
    });

    test('no se avisa a quien se revisó a sí mismo', () => {
        assert.match(sql, /v_dueno = lower\(new\.revisor_correo\)/);
    });
});

describe('"Te falta un dato": la fecha del documento pendiente', () => {
    function conEvidenciaSinFecha() {
        localStorage.setItem('datosPWA', JSON.stringify({ tipos_actividad: [{
            nombre: 'Capacitación', campos: { evidencia: 'obligatorio-despues', fecha_documento: 'obligatorio' }
        }] }));
        const a = actividadDePrueba({ id: 'a-falta', tipo: 'Capacitación', evidencia: { estado: 'local', nombre: 'x.jpg', mime: 'image/jpeg', url: '' } });
        agregarVisita(visitaDePrueba({ id: 'v-falta', sectores: [sectorDePrueba({ actividades: [a] })] }));
    }

    test('aparece en Avisos, dice qué falta y qué pasa mientras tanto, y abre la ventana', () => {
        conEvidenciaSinFecha();
        ponerAvisos([]);
        const { container, getByText } = render(<BandejaAvisos />);

        const texto = container.textContent || '';
        assert.match(texto, /Te falta un dato/);
        assert.match(texto, /Falta la fecha del documento/);
        assert.match(texto, /no se sube hasta que captures la fecha/);
        assert.match(texto, /1 por atender/);

        fireEvent.click(getByText('Poner la fecha'));
        assert.ok(document.querySelector('.dialogo-raiz'), 'se abre la ventana emergente');
    });

    test('la insignia del menú cuenta lo que le falta, aunque aún no haya bajado los avisos', () => {
        const avisos = MODULOS.find(m => m.clave === 'avisos')!;
        assert.equal(avisos.insignia!(), undefined, 'nada que mostrar todavía');

        conEvidenciaSinFecha();
        assert.equal(avisos.insignia!(), 1);

        ponerAvisos([aviso()]);
        assert.equal(avisos.insignia!(), 2, 'lo del revisor + lo que le falta');
    });

    test('sin nada pendiente no hay sección', () => {
        ponerAvisos([]);
        const { container } = render(<BandejaAvisos />);
        assert.doesNotMatch(container.textContent || '', /Te falta un dato/);
    });
});
