/**
 * Estrategias v2: objetivo obligatorio al generar visita, actividades por sector (drill-down),
 * grupo de cliente y filtro estricto de materiales por grupo.
 */

import { describe, test, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import { nuevaVisita } from '@modules/visitas/services/fabricas';
import { actividadesDeSector, estrategiasPendientesPara } from '@modules/estrategias/services/vinculo';
import { sectoresACapturar, consolidarPorSector, faltantes, claveGrupo } from '@modules/estrategias/services/capturaSector';
import { faltaParaGuardar } from '@modules/visitas/validators/requisitos';
import { faltaEnSector, gruposDeEstrategias, estrategiasDeSector } from '@modules/sectores/validators/requisitos';
import { guardarEstrategias, guardarCatalogo } from '../js/storage.js';
import { archivarEstrategias, archivarProducto, moverEtapaEstatus, leerEstrategias, cerrarEstrategia, cambiarValorMensual } from '../js/storage.js';
import { buscarMateriales, grupoDeCliente, gruposDeCliente, estatusEstrategia, etapasEstrategia } from '../js/catalogos.js';
import type { Estrategia, Sector, Visita } from '@core/tipos';

const nuevoId = (() => { let n = 0; return (p: string) => `${p}-${++n}`; })();
const sesion = { correo: 'edu@degasa.com', nombre: 'Edu', id_token: 'x' } as never;

const estrategia = (id: string, sector: string, grupo: string): Estrategia =>
    ({ id, cliente: 'Hospital Central', sector, grupo_articulo: grupo, proyecto: `Plan ${grupo}` });

const sectorConActividad = (nombre: string, n: number): Sector => ({
    id: `s-${nombre}`, nombre, programado: true, objetivo: 'x',
    actividades: Array.from({ length: n }, (_, i) => ({
        id: `a-${nombre}-${i}`, tipo: 'Capacitación',
        guardada: { momento: '2026-09-04T10:00:00.000Z', usuario: 'Edu' }
    }))
});

beforeEach(() => { limpiarAlmacen(); });

describe('objetivo obligatorio desde una estrategia', () => {
    test('la visita no se guarda mientras el sector de la estrategia no tenga objetivo', () => {
        guardarEstrategias([estrategia('e1', 'GASAS', 'Gasas')]);
        const v = nuevaVisita({
            cliente: 'Hospital Central', dia: '2026-10-20', hora_inicio: '09:00', hora_fin: '10:00',
            ids_estrategias: ['e1'], sectorNombres: ['GASAS']
        }, sesion, nuevoId);
        v.hospital = 'Torre A';

        assert.ok(faltaParaGuardar(v).includes('Objetivo de la visita (GASAS)'));
        v.sectores![0]!.objetivo = 'Presentar gasas nuevas';
        assert.ok(!faltaParaGuardar(v).some(f => f.startsWith('Objetivo de la visita')));
    });

    test('el objetivo capturado al generar la visita se siembra en el sector', () => {
        const v = nuevaVisita({
            cliente: 'H', ids_estrategias: ['e1'], sectorNombres: ['GASAS'],
            objetivos: { GASAS: '  Cerrar contrato ' }
        }, sesion, nuevoId);
        assert.equal(v.sectores![0]!.objetivo, 'Cerrar contrato');
    });

    test('desde una estrategia el objetivo es obligatorio aunque Administración lo relaje', () => {
        localStorage.setItem('datosPWA', JSON.stringify({ formularios: { sector: { objetivo: 'opcional' } } }));
        assert.ok(!faltaEnSector({ origen: ['BI'], solicitado_por: 'x' }).includes('Objetivo'));
        assert.deepEqual(
            faltaEnSector({ origen: ['BI'], solicitado_por: 'x' }, { desdeEstrategia: true }),
            ['Objetivo']
        );
    });

    test('dos o más grupos de artículo en el mismo sector se detectan', () => {
        const lista = [estrategia('e1', 'GASAS', 'Gasas'), estrategia('e2', 'GASAS', 'Cuidado de Heridas')];
        assert.deepEqual(gruposDeEstrategias(lista), ['Gasas', 'Cuidado de Heridas']);

        const v = { ids_estrategias: ['e1', 'e2'] } as Visita;
        assert.equal(estrategiasDeSector(v, lista, 'GASAS').length, 2);
        assert.equal(estrategiasDeSector(v, lista, 'SUTURAS').length, 0);
    });
});

describe('actividades por cliente y sector (drill-down)', () => {
    const visita = (id: string, dia: string, ids: string[], sectores: Sector[], cliente = 'Hospital Central'): Visita =>
        ({ id, dia, cliente, ids_estrategias: ids, sectores } as Visita);

    test('cuenta las actividades guardadas de las visitas vinculadas, solo del sector pedido', () => {
        const visitas = [
            visita('v1', '2026-09-01', ['e1'], [sectorConActividad('GASAS', 2), sectorConActividad('SUTURAS', 5)]),
            visita('v2', '2026-09-08', ['e1'], [sectorConActividad('GASAS', 1)]),
            visita('v3', '2026-09-09', ['otra'], [sectorConActividad('GASAS', 4)]),
            visita('v4', '2026-09-10', ['e1'], [sectorConActividad('GASAS', 3)], 'Otro hospital')
        ];
        const r = actividadesDeSector(visitas, 'Hospital Central', 'GASAS', [{ id: 'e1' }]);
        assert.equal(r.length, 3);
        assert.deepEqual([...new Set(r.map(x => x.visita.id))].sort(), ['v1', 'v2']);
        assert.equal(r[0]!.visita.id, 'v2', 'la más reciente primero');
    });

    test('las actividades sin sello (borrador) no cuentan', () => {
        const s = sectorConActividad('GASAS', 2);
        delete s.actividades![0]!.guardada;
        const r = actividadesDeSector([visita('v1', '2026-09-01', ['e1'], [s])], 'Hospital Central', 'GASAS', [{ id: 'e1' }]);
        assert.equal(r.length, 1);
    });
});

describe('catálogos', () => {
    test('grupoDeCliente y gruposDeCliente salen de "Grupo Cliente"', () => {
        guardarCatalogo({ clientes: ['A', 'B', 'C'], clientes_grupo: { A: 'Gobierno', B: 'Privado', C: 'Privado' } });
        assert.equal(grupoDeCliente('A'), 'Gobierno');
        assert.equal(grupoDeCliente('Z'), '');
        assert.deepEqual(gruposDeCliente(), ['Gobierno', 'Privado']);
    });

    test('buscarMateriales con grupo excluye los de otro grupo', () => {
        guardarCatalogo({
            materiales: [
                { material: 'GASA SIMPLE', sector: 'GASAS', grupo_articulo: 'Gasas' },
                { material: 'GASA APOSITO', sector: 'GASAS', grupo_articulo: 'Cuidado de Heridas' },
                { material: 'GASA SIN GRUPO', sector: 'GASAS' }
            ]
        });
        assert.deepEqual(buscarMateriales('GASAS', 'gasa', 40, 'Gasas').map(m => m.material), ['GASA SIMPLE']);
        assert.equal(buscarMateriales('GASAS', 'gasa').length, 3, 'sin grupo no filtra');
    });

    test('Finalizado y Cerrado ya no son estatus ni etapas: son acciones que archivan', () => {
        assert.deepEqual(estatusEstrategia(), ['Pendiente', 'En curso', 'En revisión']);
        assert.ok(!etapasEstrategia().some((e: string) => ['Finalizado', 'Cerrado'].includes(e)));
    });
});

describe('archivo y avance (las estrategias no se borran)', () => {
    const base = (id: string, sector: string, grupo: string): Estrategia =>
        ({ ...estrategia(id, sector, grupo), etapa: 'Presentación', estatus: 'Pendiente', sincronizado: true });

    test('archivar y desarchivar por nivel no borra nada y marca para sincronizar', () => {
        guardarEstrategias([base('a', 'GASAS', 'Gasas'), base('b', 'GASAS', 'Vendas'), base('c', 'SUTURAS', 'Suturas')]);

        assert.equal(archivarEstrategias(['a', 'b'], true, 'Edu'), 2);   // un sector
        let lista = leerEstrategias() as Estrategia[];
        assert.equal(lista.length, 3);
        assert.deepEqual(lista.filter(e => e.archivada).map(e => e.id), ['a', 'b']);
        assert.equal(lista.find(e => e.id === 'a')!.sincronizado, false);
        assert.equal(lista.find(e => e.id === 'c')!.sincronizado, true, 'las demás no se tocan');

        assert.equal(archivarEstrategias(['a', 'b'], true), 0, 'ya estaban archivadas');
        assert.equal(archivarEstrategias(['a'], false), 1);
        lista = leerEstrategias() as Estrategia[];
        assert.equal(lista.find(e => e.id === 'a')!.archivada, false);
    });

    test('archivar un producto deja la estrategia activa', () => {
        guardarEstrategias([{ ...base('a', 'GASAS', 'Gasas'), productos: ['GASA 1', 'GASA 2'] }]);
        archivarProducto('a', 'GASA 1', true);
        let e = (leerEstrategias() as Estrategia[])[0]!;
        assert.deepEqual(e.productos_archivados, ['GASA 1']);
        assert.deepEqual(e.productos, ['GASA 1', 'GASA 2'], 'sigue en la lista, tachado en pantalla');
        assert.notEqual(e.archivada, true);
        archivarProducto('a', 'GASA 1', false);
        e = (leerEstrategias() as Estrategia[])[0]!;
        assert.deepEqual(e.productos_archivados, []);
    });

    test('mover etapa/estatus agrega un punto a la línea de tiempo y no toca lo demás', () => {
        guardarEstrategias([{ ...base('a', 'GASAS', 'Gasas'), etapas: [{ etapa: 'Presentación', estatus: 'Pendiente', momento: '2026-10-01T10:00:00.000Z' }] }]);

        moverEtapaEstatus('a', { etapa: 'Cotización', estatus: 'En curso', nota: ' envió precios ' }, { nombre: 'Edu' });
        const e = (leerEstrategias() as Estrategia[])[0]!;
        assert.equal(e.etapa, 'Cotización');
        assert.equal(e.estatus, 'En curso');
        assert.equal(e.sector, 'GASAS');
        assert.equal(e.etapas!.length, 2);
        assert.equal(e.etapas![1]!.nota, 'envió precios');
        assert.equal(e.etapas![1]!.actor_nombre, 'Edu');
        assert.equal(e.sincronizado, false);

        moverEtapaEstatus('a', { etapa: 'Cotización', estatus: 'En curso' });
        assert.equal((leerEstrategias() as Estrategia[])[0]!.etapas!.length, 2, 'sin cambio no hay punto nuevo');
    });
});

describe('generar visita: origen y solicitado por obligatorios', () => {
    test('desde una estrategia faltan los tres aunque Administración los relaje', () => {
        localStorage.setItem('datosPWA', JSON.stringify({
            formularios: { sector: { objetivo: 'opcional', origen: 'opcional', solicitado_por: 'opcional' } }
        }));
        assert.deepEqual(faltaEnSector({}), []);
        assert.deepEqual(
            faltaEnSector({}, { desdeEstrategia: true }),
            ['Objetivo', 'Origen de la actividad', 'Solicitado por']
        );
    });

    test('nuevaVisita siembra objetivo, origen y solicitado por en el sector', () => {
        const v = nuevaVisita({
            cliente: 'H', ids_estrategias: ['e1'], sectorNombres: ['GASAS'],
            objetivos: { GASAS: 'Presentar' }, origenes: { GASAS: ['BI'] }, solicitados: { GASAS: ' Gerente ' }
        }, sesion, nuevoId);
        assert.deepEqual(
            [v.sectores![0]!.objetivo, v.sectores![0]!.origen, v.sectores![0]!.solicitado_por],
            ['Presentar', ['BI'], 'Gerente']
        );
    });

    test('la visita no se guarda sin origen ni solicitado por en un sector de estrategia', () => {
        guardarEstrategias([estrategia('e1', 'GASAS', 'Gasas')]);
        const v = nuevaVisita({
            cliente: 'Hospital Central', dia: '2026-10-20', hora_inicio: '09:00', hora_fin: '10:00',
            ids_estrategias: ['e1'], sectorNombres: ['GASAS'], objetivos: { GASAS: 'x' }
        }, sesion, nuevoId);
        v.hospital = 'Torre A';
        const falta = faltaParaGuardar(v);
        assert.ok(falta.includes('Origen de la actividad (GASAS)'));
        assert.ok(falta.includes('Solicitado por (GASAS)'));
    });
});

describe('captura por sector y grupo al generar la visita', () => {
    const sel = [estrategia('e1', 'GASAS', 'Gasas'), estrategia('e2', 'GASAS', 'Vendas'), estrategia('e3', 'SUTURAS', 'Seda')];
    const lleno = (objetivo: string, solicitado = 'Dra. Ruiz') => ({ objetivo, origen: ['Cliente'], solicitado });

    test('un sector con dos grupos exige capturar los dos antes de dar el sector por completo', () => {
        const sectores = sectoresACapturar(sel);
        assert.deepEqual(sectores.map(s => [s.sector, s.grupos]), [['GASAS', ['Gasas', 'Vendas']], ['SUTURAS', ['Seda']]]);

        const datos = { [claveGrupo('GASAS', 'Gasas')]: lleno('Capacitar'), [claveGrupo('SUTURAS', 'Seda')]: lleno('Presentar') };
        assert.deepEqual(faltantes(sectores, datos), ['GASAS'], 'falta el grupo Vendas');
    });

    test('se consolida un objetivo, solicitante y origen por sector sin repetir lo igual', () => {
        const sectores = sectoresACapturar(sel);
        const mismo = consolidarPorSector(sectores, {
            [claveGrupo('GASAS', 'Gasas')]: lleno('Capacitar'), [claveGrupo('GASAS', 'Vendas')]: lleno('Capacitar'),
            [claveGrupo('SUTURAS', 'Seda')]: lleno('Presentar')
        });
        assert.equal(mismo.objetivos.GASAS, 'Capacitar', 'mismo texto para ambos grupos: una vez');
        assert.equal(mismo.solicitados.GASAS, 'Dra. Ruiz');
        assert.deepEqual(mismo.origenes.GASAS, ['Cliente']);

        const distinto = consolidarPorSector(sectores, {
            [claveGrupo('GASAS', 'Gasas')]: lleno('Capacitar'), [claveGrupo('GASAS', 'Vendas')]: lleno('Cotizar', 'Dr. Paz')
        });
        assert.equal(distinto.objetivos.GASAS, 'Gasas: Capacitar; Vendas: Cotizar');
        assert.equal(distinto.solicitados.GASAS, 'Dra. Ruiz, Dr. Paz');
    });
});

describe('recordatorio de vinculación al terminar una visita', () => {
    const vis = (extra: Partial<Visita>) => ({ cliente: 'Hospital Central', sectores: [], ...extra }) as Visita;
    const todas = [
        estrategia('e1', 'GASAS', 'Gasas'), estrategia('e2', 'SUTURAS', 'Seda'),
        { ...estrategia('e3', 'GASAS', 'Vendas'), archivada: true }
    ];

    test('ofrece las vigentes del sector de la visita que no están vinculadas', () => {
        const v = vis({ sectores: [{ id: 's', nombre: 'GASAS', actividades: [] } as unknown as Sector] });
        assert.deepEqual(estrategiasPendientesPara(v, todas).map(e => e.id), ['e1'], 'ni SUTURAS ni la archivada');
    });

    test('sin sectores en la visita considera todo el cliente; lo ya vinculado no se repite', () => {
        assert.deepEqual(estrategiasPendientesPara(vis({}), todas).map(e => e.id), ['e1', 'e2']);
        assert.deepEqual(estrategiasPendientesPara(vis({ ids_estrategias: ['e1'] }), todas).map(e => e.id), ['e2']);
    });
});

describe('Finalizar / Cerrar y valor mensual', () => {
    beforeEach(() => { guardarEstrategias([{ id: 'e1', cliente: 'Hospital Central', sector: 'GASAS', etapa: 'Presentación', estatus: 'Pendiente' }]); });
    const actor = { correo: 'edu@degasa.com', nombre: 'Edu' };

    test('el comentario es obligatorio: sin él no cambia nada', () => {
        assert.equal(cerrarEstrategia('e1', 'cerrado', '   ', actor), null);
        assert.equal(leerEstrategias()[0].archivada, undefined);
    });

    test('cerrar archiva, guarda el motivo y lo deja en la bitácora', () => {
        cerrarEstrategia('e1', 'cerrado', 'Compró la competencia', actor);
        const e = leerEstrategias()[0];
        assert.equal(e.archivada, true);
        assert.equal(e.desenlace, 'cerrado');
        assert.equal(e.sincronizado, false);
        assert.equal(e.etapas.at(-1).nota, 'Cerrada: Compró la competencia');
    });

    test('desarchivar quita el desenlace: vuelve a estar vigente', () => {
        cerrarEstrategia('e1', 'finalizado', 'Logrado', actor);
        archivarEstrategias(['e1'], false);
        const e = leerEstrategias()[0];
        assert.equal(e.archivada, false);
        assert.equal(e.desenlace, undefined);
    });

    test('una nota sola también entra a la bitácora aunque no cambie etapa ni estatus', () => {
        moverEtapaEstatus('e1', { nota: 'Visita del 20/10/2026: se habló con compras' } as never, actor);
        const e = leerEstrategias()[0];
        assert.equal(e.etapas.length, 1);
        assert.equal(e.nota_evento, 'Visita del 20/10/2026: se habló con compras');
    });

    test('cambiar el valor mensual deja valor anterior y nuevo en la bitácora', () => {
        cambiarValorMensual('e1', 1500, actor);
        cambiarValorMensual('e1', 2500, actor);
        const e = leerEstrategias()[0];
        assert.equal(e.valor_mensual, 2500);
        assert.match(e.etapas.at(-1).nota, /1,500\.00.*→.*2,500\.00/);
        assert.equal(cambiarValorMensual('e1', 'abc', actor), null, 'un valor que no es número se rechaza');
    });
});
