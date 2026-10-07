/**
 * Importar AppSheet: la transformación al modelo de la app, la fusión con lo ya revisado y el
 * armado de lo que se sube a Supabase.
 *
 * `ImportarAppSheet.gs` corre en Google, no aquí. Pero su transformación son funciones PURAS (no
 * tocan hojas), así que se cargan tal cual con `vm` y se prueban con renglones como los que
 * trae AppSheet de verdad (nombres de sector truncados a 20 caracteres, fechas como número de
 * serie, reagendadas que generan una visita nueva, renglones de material vacíos…).
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = (() => {
    const codigo = readFileSync(join(process.cwd(), 'apps-script', 'ImportarAppSheet.gs'), 'utf8');
    const contexto: any = {
        Utilities: {
            DigestAlgorithm: { SHA_1: 'SHA1' }, Charset: { UTF_8: 'utf8' },
            computeDigest: (_a: string, t: string) =>
                Array.from(createHash('sha1').update(t, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
            formatDate: (d: Date, _tz: string, patron: string) => {
                const p = (n: number) => String(n).padStart(2, '0');
                return patron === 'HH:mm' ? `${p(d.getHours())}:${p(d.getMinutes())}`
                    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
            }
        },
        PropertiesService: {}, Logger: { log: () => {} }, console
    };
    vm.createContext(contexto);
    vm.runInContext(codigo + `
;this.__api = { asTransformar, asFusionarTabla, asArmarVisitas, asFecha, asHora, asResolverNombre, asResolverArea,
   asUbicacion, asExtraerId, asFilasAObjetos, asClaveTexto, asClaveColumna, asProblemaDeOrigen, asLista, AS_COLUMNAS };`, contexto);
    // Lo que sale de `vm` trae los Array/Object de OTRO contexto, y `deepEqual` estricto los toma
    // por distintos aunque sean idénticos: se clona a datos planos en la frontera.
    const plano = (v: unknown) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    return Object.fromEntries(Object.entries(contexto.__api).map(([k, v]) =>
        [k, typeof v === 'function' ? (...args: unknown[]) => plano((v as (...a: unknown[]) => unknown)(...args)) : v]));
})();

// ---------- ayudas para armar hojas como las de AppSheet ----------

const hoja = (encabezados: string[], filas: unknown[][]) => g.asFilasAObjetos([encabezados, ...filas]);

const ENC_PLAN = ['ID Plan de trabajo', 'Fecha de visita', 'Hora de visita', 'Tiempo asignado', 'Hora de salida prevista',
    'Educador_PT', 'Correo_Educador_PT', 'No Cliente y Razon Social', 'Hora de llegada', 'Fecha de llegada', 'Ubicacion',
    'Hora de salida', 'Fecha de salida', 'Sectores Revisados', 'Puntualidad', 'Objetivo', 'Status', 'ID_Origen',
    'Comentarios', 'Hospital visitado', 'Origen de actividad', 'Solicitante', 'Mot_Reagendado',
    'Estado revisión PT', 'Estado revisión Efectividad'];

function filaPlan(o: Record<string, unknown>) {
    const base: Record<string, unknown> = {
        'ID Plan de trabajo': 'p1', 'Fecha de visita': '2026-02-12 00:00:00', 'Hora de visita': '11:40:00', 'Tiempo asignado': 60,
        'Hora de salida prevista': '12:40:00', 'Educador_PT': 'Melissa Cruz', 'Correo_Educador_PT': 'MCruzJ@degasa.com',
        'No Cliente y Razon Social': '100116 ATENCION MEDICA LIRA', 'Status': 'Pendiente', 'Hospital visitado': 'Sanatorio Lira',
        'Origen de actividad': 'Gerencia de Marca , Ventas', 'Solicitante': 'Sandra', 'Objetivo': 'Agendar taller', ...o
    };
    return ENC_PLAN.map(c => base[c] ?? '');
}

const ENC_SEC = ['ID_PT_SECTORES', 'ID_PT', 'Educador', 'Sector', 'Objetivo', 'Origen de actividad', 'Solicitante'];
const filaSec = (id: string, idPt: string, sector: string, extra: Record<string, unknown> = {}) =>
    ENC_SEC.map(c => ({ ID_PT_SECTORES: id, ID_PT: idPt, Sector: sector, ...extra } as Record<string, unknown>)[c] ?? '');

const ENC_ACT = ['ID_ACT', 'ID_PT_REF', 'Fecha', 'Tipo de actividad', 'Educador', 'Correo', 'Evidencia', 'Sector_Act_Reg',
    'ID_PT_INICIAL_REF', 'Nombre archivo', 'Folio', 'Comentarios ', 'Fecha documento', 'Estado actividad', 'Evidencia URL',
    'Evidencia Drive ID', 'Area visitada'];
const filaAct = (o: Record<string, unknown>) =>
    ENC_ACT.map(c => ({ 'Fecha': '2026-02-12 00:00:00', 'Tipo de actividad': 'Capacitacion', 'Area visitada': 'Usuaria / Especialidad', ...o } as Record<string, unknown>)[c] ?? '');

const ENC_MAT = ['ID_ACT_MAT', 'ID_ACT_REF', 'Material y Descripcion', 'Materiales', 'Descripcion', 'Sector', 'Cantidad', 'UM', 'Folio'];
const filaMat = (o: Record<string, unknown>) => ENC_MAT.map(c => (o as Record<string, unknown>)[c] ?? '');

const CATALOGO = {
    sectores: ['CARDINAL', 'ALGODÓN Y APLICADORES', 'ANTISÉPTICOS Y ALCOHOL', 'SUTURAS', 'GUANTES', 'PAÑAL'],
    tipos: ['Capacitación', 'Evaluación (General)', 'Seguimiento', 'Taller'],
    areas: ['Área Usuaria', 'Otra']
};

function contexto(extra: Record<string, unknown> = {}) {
    return {
        catalogo: CATALOGO, alias: { sector: {}, tipo: {}, area: {} },
        educadorPorNombre: {}, zonaDe: (c: string) => (c.startsWith('100116') ? '7' : ''),
        ejecutivoDe: (z: string) => (z === '007' ? 'Ejecutivo Siete' : ''),
        cortes: {}, hoy: '2026-10-07', reglas: { origen_min_digitos: 6, origen_min_caracteres: 3 },
        formatear: (d: Date, p: string) => g.asFecha.length && p === 'HH:mm'
            ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
            : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        ...extra
    };
}

function entrada(p: { plan?: unknown[][]; sectores?: unknown[][]; actividades?: unknown[][]; materiales?: unknown[][] }) {
    return {
        plan: hoja(ENC_PLAN, p.plan || []), sectores: hoja(ENC_SEC, p.sectores || []),
        actividades: hoja(ENC_ACT, p.actividades || []), materiales: hoja(ENC_MAT, p.materiales || [])
    };
}

// ---------- ayudas de lectura ----------

describe('fechas, horas y ubicación de AppSheet', () => {
    test('fechas: texto con hora, dd/mm/aaaa, número de serie y Date', () => {
        assert.equal(g.asFecha('2026-02-12 00:00:00'), '2026-02-12');
        assert.equal(g.asFecha('12/02/2026'), '2026-02-12');
        assert.equal(g.asFecha(46122), '2026-04-10', 'AppSheet guarda algunas fechas como número de serie');
        assert.equal(g.asFecha(new Date(2026, 1, 12), { formatear: (d: Date) => '2026-02-12' }), '2026-02-12');
        assert.equal(g.asFecha(''), '');
        assert.equal(g.asFecha(7), '', 'un número cualquiera no es una fecha');
    });

    test('horas: "11:40:00", "9:05" y fracción de día', () => {
        assert.equal(g.asHora('11:40:00'), '11:40');
        assert.equal(g.asHora('9:05'), '09:05');
        assert.equal(g.asHora(0.5), '12:00');
        assert.equal(g.asHora(''), '');
    });

    test('ubicación "lat, lng"', () => {
        assert.deepEqual(g.asUbicacion('19.351351, -99.170256'), { lat: 19.351351, lng: -99.170256 });
        assert.equal(g.asUbicacion('sin ubicación'), null);
    });

    test('los encabezados se comparan sin acentos ni mayúsculas', () => {
        assert.equal(g.asClaveColumna('Estado revisión PT'), 'estado_revision_pt');
        assert.equal(g.asClaveColumna('Comentarios '), 'comentarios');
        assert.equal(g.asClaveColumna('N° cliente y Razon social'), 'n_cliente_y_razon_social');
    });

    test('la regla del origen es la misma que la de la app', () => {
        assert.equal(g.asProblemaDeOrigen('210066'), '');
        assert.match(g.asProblemaDeOrigen('12345'), /dígitos/);
        assert.match(g.asProblemaDeOrigen('NA'), /caracteres/);
        assert.equal(g.asProblemaDeOrigen(''), '');
    });
});

describe('el id de las hojas de AppSheet', () => {
    test('se puede pegar el enlace completo o solo el id', () => {
        const id = '1LlV4MNeq_m1VzTyeiL2__vpB1oceGBWhO5tWgupf1WI';
        assert.equal(g.asExtraerId(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=0#gid=0`), id);
        assert.equal(g.asExtraerId(`  ${id} `), id);
        assert.equal(g.asExtraerId(''), '');
        assert.equal(g.asExtraerId(undefined), '');
    });
});

describe('nombres de sector, tipo y área', () => {
    test('un sector truncado a 20 caracteres se completa si es único', () => {
        const r = g.asResolverNombre('ALGODÓN Y APLICADORE', CATALOGO.sectores, {});
        assert.equal(r.valor, 'ALGODÓN Y APLICADORES');
        assert.equal(r.motivo, 'truncado');
    });

    test('sin acentos ni mayúsculas', () => {
        assert.equal(g.asResolverNombre('Capacitacion', CATALOGO.tipos, {}).valor, 'Capacitación');
        assert.equal(g.asResolverNombre('antisepticos y alcohol', CATALOGO.sectores, {}).valor, 'ANTISÉPTICOS Y ALCOHOL');
    });

    test('lo desconocido se conserva y se avisa; el alias de la persona manda', () => {
        const desconocido = g.asResolverNombre('Catálogo completo', CATALOGO.sectores, {});
        assert.equal(desconocido.ok, false);
        assert.equal(desconocido.valor, 'Catálogo completo');

        const conAlias = g.asResolverNombre('Catálogo completo', CATALOGO.sectores, { 'CATALOGO COMPLETO': 'CARDINAL' });
        assert.deepEqual([conAlias.valor, conAlias.ok], ['CARDINAL', true]);
    });

    test('un prefijo que cuadra con varios sectores es ambiguo: no se adivina', () => {
        const r = g.asResolverNombre('ANTISEPTICOS', ['ANTISÉPTICOS Y ALCOHOL', 'ANTISÉPTICOS DE PIEL'], {});
        assert.equal(r.ok, false);
        assert.equal(r.motivo, 'ambiguo');
    });

    test('el área "Usuaria / Especialidad" se reconoce como el área usuaria', () => {
        assert.equal(g.asResolverArea('Usuaria / Especialidad', CATALOGO.areas, {}).valor, 'Área Usuaria');
        assert.equal(g.asResolverArea('Otra', CATALOGO.areas, {}).valor, 'Otra');
    });
});

// ---------- la transformación ----------

describe('una visita normal, de punta a punta', () => {
    const datos = entrada({
        plan: [filaPlan({
            'ID Plan de trabajo': 'p1', Status: 'Completo', 'Hora de llegada': '11:40:03', 'Fecha de llegada': '2026-02-12 00:00:00',
            Ubicacion: '19.351351, -99.170256', 'Hora de salida': '12:39:40', 'Fecha de salida': '2026-02-12 00:00:00'
        })],
        sectores: [filaSec('s1', 'p1', 'ALGODÓN Y APLICADORE'), filaSec('s2', 'p1', 'CARDINAL', { Objetivo: 'Revisar rotación' })],
        actividades: [filaAct({ 'ID_ACT': 'a1', 'ID_PT_REF': 's1', 'ID_PT_INICIAL_REF': 'p1', 'Fecha documento': 46122, 'Evidencia URL': 'https://drive.google.com/x' })],
        materiales: [
            filaMat({ ID_ACT_MAT: 'm1', ID_ACT_REF: 'a1', 'Material y Descripcion': 'GASA SIMPLE', Cantidad: 12, UM: 'PI', Folio: '210066' }),
            filaMat({ ID_ACT_MAT: 'm2', ID_ACT_REF: 'a1', 'Material y Descripcion': 'GASA 10X10', Cantidad: 3, UM: 'PI', Folio: 'NA' }),
            filaMat({ ID_ACT_MAT: 'm3', ID_ACT_REF: 'a1', Sector: 'CARDINAL' })      // renglón vacío de AppSheet
        ]
    });
    const r = () => g.asTransformar(datos, contexto());

    test('la visita sale con el modelo de la app', () => {
        const v = r().visitas[0];
        assert.equal(v.id_visita, 'as-p1');
        assert.equal(v.educador_correo, 'mcruzj@degasa.com', 'el correo va en minúsculas');
        assert.equal(v.dia, '2026-02-12');
        assert.equal(v.hora_inicio, '11:40');
        assert.equal(v.hora_fin, '12:40');
        assert.equal(v.estado, 'finalizada');
        assert.equal(v.check_in_momento, '2026-02-12T11:40:00-06:00');
        assert.equal(v.check_out_momento, '2026-02-12T12:39:00-06:00');
        assert.equal(v.check_in_lat, 19.351351);
        assert.equal(v.zona, '007', 'la zona va a 3 dígitos, como en la app');
        assert.equal(v.ejecutivo, 'Ejecutivo Siete');
        assert.equal(v.import_estado, 'pendiente');
        assert.equal(v.n_actividades, 1);
        assert.deepEqual(JSON.parse(v.src_json)['ID Plan de trabajo'], 'p1', 'se conservan TODAS las columnas de origen');
    });

    test('los sectores se completan y heredan objetivo, origen y solicitante del plan', () => {
        const [s1, s2] = r().sectores;
        assert.equal(s1.nombre, 'ALGODÓN Y APLICADORES');
        assert.equal(s1.nombre_original, 'ALGODÓN Y APLICADORE');
        assert.equal(s1.objetivo, 'Agendar taller', 'sin objetivo propio usa el del plan');
        assert.equal(s1.origen, 'Gerencia de Marca, Ventas');
        assert.equal(s1.solicitado_por, 'Sandra');
        assert.equal(s2.objetivo, 'Revisar rotación');
    });

    test('la actividad normaliza tipo y área, convierte la fecha del documento y marca la evidencia', () => {
        const a = r().actividades[0];
        assert.equal(a.id_actividad, 'as-a1');
        assert.equal(a.id_sector, 'as-s1');
        assert.equal(a.tipo, 'Capacitación');
        assert.equal(a.area_visitada, 'Área Usuaria');
        assert.equal(a.fecha_documento, '2026-04-10');
        assert.equal(a.evidencia_estado, 'subida');
        assert.equal(a.evidencia_url, 'https://drive.google.com/x');
        assert.equal(a.guardada_usuario, 'Melissa Cruz');
    });

    test('los materiales: el origen es el folio, se avisa del que no cumple y no se importan renglones vacíos', () => {
        const res = r();
        assert.equal(res.materiales.length, 2);
        assert.equal(res.resumen.materiales_vacios, 1);
        const [m1, m2] = res.materiales;
        assert.equal(m1.origen, '210066');
        assert.equal(m1.import_notas, '');
        assert.equal(m2.origen, 'NA');
        assert.match(m2.import_notas, /menos de 3 caracteres/);
    });
});

describe('reagendadas, cancelaciones y estados', () => {
    test('una visita reagendada se une a la que la sustituyó (no queda como visita aparte)', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'p1', Status: 'Reagendado', 'Mot_Reagendado': 'El cliente pidió otro día' }),
                filaPlan({ 'ID Plan de trabajo': 'p2', Status: 'Pendiente', 'ID_Origen': 'p1', 'Fecha de visita': '2026-02-20 00:00:00' })
            ],
            sectores: [filaSec('s1', 'p1', 'CARDINAL'), filaSec('s2', 'p2', 'CARDINAL')]
        }), contexto());

        assert.deepEqual(res.visitas.map((v: any) => v.id_visita), ['as-p2']);
        assert.equal(res.visitas[0].reagendas, 1);
        assert.equal(res.resumen.reagendadas_unidas, 1);
        assert.equal(res.sectores.length, 1, 'los sectores de la visita reagendada no se duplican');
    });

    test('las actividades de una visita reagendada se pasan a la visita nueva', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'p1', Status: 'Reagendado' }),
                filaPlan({ 'ID Plan de trabajo': 'p2', Status: 'Completo', 'ID_Origen': 'p1' })
            ],
            sectores: [filaSec('s1', 'p1', 'CARDINAL'), filaSec('s2', 'p2', 'CARDINAL')],
            actividades: [filaAct({ ID_ACT: 'a1', ID_PT_REF: 's1', ID_PT_INICIAL_REF: 'p1' })]
        }), contexto());

        assert.equal(res.actividades[0].id_visita, 'as-p2');
        assert.equal(res.actividades[0].import_estado, 'pendiente');
    });

    test('reagendada SIN visita nueva se importa como cancelada, con nota', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ 'ID Plan de trabajo': 'p1', Status: 'Reagendado' })],
            sectores: [filaSec('s1', 'p1', 'CARDINAL')]
        }), contexto());
        assert.equal(res.visitas[0].estado, 'cancelada');
        assert.match(res.visitas[0].import_notas, /sin una visita nueva/);
    });

    test('cancelada, pendiente, y una pendiente con llegada (vieja) vuelve a programada', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'c', Status: 'Cancelado' }),
                filaPlan({ 'ID Plan de trabajo': 'p', Status: 'Pendiente' }),
                filaPlan({ 'ID Plan de trabajo': 'e', Status: 'Pendiente', 'Hora de llegada': '10:00:00' })
            ],
            sectores: [filaSec('s1', 'c', 'CARDINAL'), filaSec('s2', 'p', 'CARDINAL'), filaSec('s3', 'e', 'CARDINAL')]
        }), contexto());
        const por = Object.fromEntries(res.visitas.map((v: any) => [v.id_visita, v.estado]));
        assert.deepEqual(por, { 'as-c': 'cancelada', 'as-p': 'programada', 'as-e': 'programada' });
    });

    test('una visita VIEJA con llegada y sin salida no se importa abierta (bloquearía al educador)', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'vieja', Status: 'Pendiente', 'Hora de llegada': '10:00:00', 'Fecha de visita': '2026-02-12 00:00:00' }),
                filaPlan({ 'ID Plan de trabajo': 'completa', Status: 'Completo', 'Hora de llegada': '10:00:00' })
            ],
            sectores: [filaSec('s1', 'vieja', 'CARDINAL'), filaSec('s2', 'completa', 'CARDINAL')]
        }), contexto());
        const por = Object.fromEntries(res.visitas.map((v: any) => [v.id_visita, v]));

        for (const v of Object.values(por) as any[]) {
            assert.equal(v.check_in_momento, '', 'sin salida no se deja la llegada: la app la vería como visita abierta');
            assert.match(v.import_notas, /sin check-in/);
        }
        assert.equal(por['as-vieja'].estado, 'programada');
    });

    test('solo una visita de HOY con llegada y sin salida queda en proceso', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ Status: 'Pendiente', 'Hora de llegada': '10:00:00', 'Fecha de visita': '2026-10-07 00:00:00' })],
            sectores: [filaSec('s1', 'p1', 'CARDINAL')]
        }), contexto());
        assert.equal(res.visitas[0].estado, 'en-proceso');
        assert.equal(res.visitas[0].check_in_momento, '2026-10-07T10:00:00-06:00');
    });

    test('"Completo" sin horas de llegada y salida se importa, pero con aviso', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ Status: 'Completo' })], sectores: [filaSec('s1', 'p1', 'CARDINAL')]
        }), contexto());
        assert.equal(res.visitas[0].estado, 'finalizada');
        assert.match(res.visitas[0].import_notas, /sin hora de llegada o de salida/);
    });
});

describe('lo que le falta a la app y lo que no se debe importar', () => {
    test('sin correo, sin fecha o sin cliente: con_error (no se aprueba a ciegas)', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ 'Correo_Educador_PT': '', 'Educador_PT': 'Nadie Conocido', 'Fecha de visita': '', 'No Cliente y Razon Social': '' })],
            sectores: [filaSec('s1', 'p1', 'CARDINAL')]
        }), contexto());
        assert.equal(res.visitas[0].import_estado, 'con_error');
        assert.match(res.visitas[0].import_notas, /Sin correo/);
        assert.match(res.visitas[0].import_notas, /Sin fecha/);
        assert.match(res.visitas[0].import_notas, /Sin cliente/);
    });

    test('el correo que falta se busca por nombre en el catálogo de educadores', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ 'Correo_Educador_PT': '', 'Educador_PT': 'Melissa Cruz' })], sectores: [filaSec('s1', 'p1', 'CARDINAL')]
        }), contexto({ educadorPorNombre: { 'MELISSA CRUZ': 'mcruzj@degasa.com' } }));
        assert.equal(res.visitas[0].educador_correo, 'mcruzj@degasa.com');
        assert.equal(res.visitas[0].import_estado, 'pendiente');
    });

    test('la fecha de corte del educador: lo posterior no se importa (ya capturó en la app)', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'a', 'Fecha de visita': '2026-02-12 00:00:00' }),
                filaPlan({ 'ID Plan de trabajo': 'b', 'Fecha de visita': '2026-03-01 00:00:00' })
            ],
            sectores: [filaSec('s1', 'a', 'CARDINAL'), filaSec('s2', 'b', 'CARDINAL')]
        }), contexto({ cortes: { 'mcruzj@degasa.com': '2026-02-28' } }));
        const por = Object.fromEntries(res.visitas.map((v: any) => [v.id_visita, v.import_estado]));
        assert.deepEqual(por, { 'as-a': 'pendiente', 'as-b': 'omitida_corte' });
    });

    test('una actividad cuya visita no está en el plan queda como sin_visita, y no se sube', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({})], sectores: [filaSec('s1', 'p1', 'CARDINAL')],
            actividades: [filaAct({ ID_ACT: 'huerfana', ID_PT_REF: 'no-existe', ID_PT_INICIAL_REF: 'tampoco' })]
        }), contexto());
        assert.equal(res.actividades[0].import_estado, 'sin_visita');
        assert.ok(res.problemas.some((p: any) => p.tipo === 'sin_visita'));
    });

    test('sector sin visita en el plan: no se importa, se reporta', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({})], sectores: [filaSec('s1', 'p1', 'CARDINAL'), filaSec('s9', 'fuera', 'CARDINAL')]
        }), contexto());
        assert.equal(res.sectores.length, 1);
        assert.ok(res.problemas.some((p: any) => p.id === 'as-s9'));
    });

    test('un sector que no se reconoce se conserva, se avisa y se pide el alias', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({})], sectores: [filaSec('s1', 'p1', 'Catálogo completo')]
        }), contexto());
        assert.equal(res.sectores[0].nombre, 'Catálogo completo');
        assert.match(res.sectores[0].import_notas, /Sector no reconocido/);
        assert.deepEqual(res.faltantes, [{ tipo: 'sector', original: 'Catálogo completo' }]);
    });

    test('sin renglones en PT_Sectores, los sectores salen de "Sectores Revisados"', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({ 'Sectores Revisados': 'CARDINAL, SUTURAS' })]
        }), contexto());
        assert.deepEqual(res.sectores.map((s: any) => s.nombre), ['CARDINAL', 'SUTURAS']);
        assert.equal(res.visitas[0].sectores, 'CARDINAL, SUTURAS');
    });

    test('evidencia en AppSheet sin enlace: se marca subida (no es deuda) pero se avisa', () => {
        const res = g.asTransformar(entrada({
            plan: [filaPlan({})], sectores: [filaSec('s1', 'p1', 'CARDINAL')],
            actividades: [
                filaAct({ ID_ACT: 'a1', ID_PT_REF: 's1', ID_PT_INICIAL_REF: 'p1', Evidencia: 'Cliente -1/2026.06.29.OTRO.jpg' }),
                filaAct({ ID_ACT: 'a2', ID_PT_REF: 's1', ID_PT_INICIAL_REF: 'p1' })
            ]
        }), contexto());
        assert.equal(res.actividades[0].evidencia_estado, 'subida');
        assert.equal(res.actividades[0].evidencia_url, '');
        assert.match(res.actividades[0].import_notas, /sin enlace de Drive/);
        assert.equal(res.actividades[1].evidencia_estado, 'pendiente');
    });
});

// ---------- fusión con lo ya revisado ----------

describe('conciliación: cada renglón de origen termina en una cuenta', () => {
    test('lo que no entra se cuenta por motivo y todo cuadra', () => {
        const res = g.asTransformar(entrada({
            plan: [
                filaPlan({ 'ID Plan de trabajo': 'p1', Status: 'Reagendado' }),
                filaPlan({ 'ID Plan de trabajo': 'p2', Status: 'Completo', 'ID_Origen': 'p1' }),
                filaPlan({ 'ID Plan de trabajo': 'p3', Status: 'Pendiente' })
            ],
            sectores: [
                filaSec('s1', 'p1', 'CARDINAL'), filaSec('s2', 'p2', 'CARDINAL'),   // mismo sector, visita reagendada → se une
                filaSec('s3', 'p3', 'SUTURAS'), filaSec('s9', 'fuera', 'SUTURAS')    // sin visita
            ],
            actividades: [filaAct({ ID_ACT: 'a1', ID_PT_REF: 's2', ID_PT_INICIAL_REF: 'p2' })],
            materiales: [
                filaMat({ ID_ACT_MAT: 'm1', ID_ACT_REF: 'a1', 'Material y Descripcion': 'GASA', Cantidad: 1, UM: 'PI' }),
                filaMat({ ID_ACT_MAT: 'm2', ID_ACT_REF: 'a1' }),                       // vacío
                filaMat({ ID_ACT_MAT: 'm3', ID_ACT_REF: 'no-existe', 'Material y Descripcion': 'X' })
            ]
        }), contexto());
        const r = res.resumen;

        assert.deepEqual(
            [r.origen_plan, r.visitas, r.reagendadas_unidas], [3, 2, 1]);
        assert.deepEqual(
            [r.origen_sectores, r.sectores, r.sectores_repetidos_en_visita, r.sectores_sin_visita], [4, 2, 1, 1]);
        assert.deepEqual(
            [r.origen_materiales, r.materiales, r.materiales_vacios, r.materiales_sin_actividad], [3, 1, 1, 1]);
        assert.deepEqual([r.cuadra_plan, r.cuadra_sectores, r.cuadra_actividades, r.cuadra_materiales], [true, true, true, true]);
    });
});

describe('fusionar con lo que la persona ya revisó', () => {
    const def = () => ({ id: 'id_visita', columnas: ['id_visita', 'cliente'] });
    const nueva = (cliente: string, estado = 'pendiente') =>
        ({ id_visita: 'as-1', cliente, import_estado: estado, import_notas: '' });
    const hash = (cliente: string) => g.asFusionarTabla(def(), [], [nueva(cliente)], 't').filas[0].import_hash;

    test('lo nuevo entra como pendiente', () => {
        const { filas, cuenta } = g.asFusionarTabla(def(), [], [nueva('A')], '2026-10-07T10:00:00');
        assert.equal(filas.length, 1);
        assert.equal(filas[0].import_estado, 'pendiente');
        assert.equal(cuenta.nuevas, 1);
    });

    test('lo que NO cambió en AppSheet se queda exactamente como lo dejó la persona', () => {
        const editada = { id_visita: 'as-1', cliente: 'A', import_estado: 'aprobada', import_hash: hash('A'), import_notas: 'revisada' };
        const { filas, cuenta } = g.asFusionarTabla(def(), [editada], [nueva('A')], 't');
        assert.equal(filas[0].import_estado, 'aprobada');
        assert.equal(filas[0].import_notas, 'revisada');
        assert.equal(cuenta.sin_cambio, 1);
    });

    test('lo aprobado o subido que CAMBIÓ en AppSheet vuelve a pendiente, con nota', () => {
        for (const antes of ['aprobada', 'subida']) {
            const previa = { id_visita: 'as-1', cliente: 'A', import_estado: antes, import_hash: hash('A'), import_subido: 'ayer' };
            const { filas, cuenta } = g.asFusionarTabla(def(), [previa], [nueva('B')], 't');
            assert.equal(filas[0].cliente, 'B');
            assert.equal(filas[0].import_estado, 'pendiente');
            assert.match(filas[0].import_notas, new RegExp(`estaba ${antes}`));
            assert.equal(cuenta.actualizadas, 1);
        }
    });

    test('lo descartado nunca se toca', () => {
        const previa = { id_visita: 'as-1', cliente: 'A', import_estado: 'descartada', import_hash: hash('A') };
        const { filas, cuenta } = g.asFusionarTabla(def(), [previa], [nueva('B')], 't');
        assert.equal(filas[0].cliente, 'A');
        assert.equal(filas[0].import_estado, 'descartada');
        assert.equal(cuenta.descartadas_intactas, 1);
    });

    test('lo que AppSheet ya no trae se conserva (no se pierde en silencio)', () => {
        const huerfana = { id_visita: 'as-9', cliente: 'Z', import_estado: 'subida', import_hash: 'x' };
        const { filas } = g.asFusionarTabla(def(), [huerfana], [nueva('A')], 't');
        assert.deepEqual(filas.map((f: any) => f.id_visita).sort(), ['as-1', 'as-9']);
    });
});

// ---------- lo que se sube ----------

describe('lo que se sube a Supabase', () => {
    const tablas = (estadoVisita: string) => ({
        visitas: [{
            id_visita: 'as-p1', educador: 'Melissa Cruz', educador_correo: 'MCruzJ@degasa.com', cliente: '100116 LIRA',
            hospital: 'Sanatorio', dia: '2026-02-12', hora_inicio: '11:40', hora_fin: '12:40', estado: 'finalizada',
            check_in_momento: '2026-02-12T11:40:00-06:00', check_in_lat: '19.35', check_in_lng: '-99.17',
            check_out_momento: '2026-02-12T12:39:00-06:00', reagendas: '2', zona: '007', ejecutivo: 'E', notas: '',
            import_estado: estadoVisita
        }],
        sectores: [
            { id_sector: 'as-s1', id_visita: 'as-p1', nombre: 'CARDINAL', objetivo: 'Rotación', origen: 'BI, Ventas', solicitado_por: 'Sandra', import_estado: 'pendiente' },
            { id_sector: 'as-s2', id_visita: 'as-p1', nombre: 'SUTURAS', objetivo: '', origen: '', solicitado_por: '', import_estado: 'descartada' }
        ],
        actividades: [
            { id_actividad: 'as-a1', id_sector: 'as-s1', id_visita: 'as-p1', tipo: 'Capacitación', area_visitada: 'Área Usuaria',
              fecha_documento: '2026-04-10', guardada_momento: '2026-02-12T12:00:00-06:00', guardada_usuario: 'Melissa Cruz',
              evidencia_estado: 'subida', evidencia_url: 'https://drive.google.com/x', import_estado: 'pendiente' },
            { id_actividad: 'as-a2', id_sector: 'as-s1', id_visita: 'as-p1', tipo: 'Seguimiento', import_estado: 'descartada' }
        ],
        materiales: [
            { id_material: 'as-m1', id_actividad: 'as-a1', id_visita: 'as-p1', material: 'GASA', cantidad: '12', unidad: 'PI', origen: '210066', import_estado: 'pendiente' },
            { id_material: 'as-m2', id_actividad: 'as-a1', id_visita: 'as-p1', material: 'VENDA', cantidad: '', unidad: '', origen: '', import_estado: 'pendiente' }
        ]
    });

    test('solo las visitas aprobadas', () => {
        assert.equal(g.asArmarVisitas(tablas('pendiente')).length, 0);
        assert.equal(g.asArmarVisitas(tablas('subida')).length, 0);
        assert.equal(g.asArmarVisitas(tablas('aprobada')).length, 1);
    });

    test('el árbol es el mismo que manda la app', () => {
        const [v] = g.asArmarVisitas(tablas('aprobada'));
        assert.equal(v.id, 'as-p1');
        assert.equal(v.educador_correo, 'mcruzj@degasa.com');
        assert.equal(v.tipo, 'cliente');
        assert.deepEqual(v.check_in, { momento: '2026-02-12T11:40:00-06:00', lat: 19.35, lng: -99.17 });
        assert.equal(v.reagendas.length, 2, 'el servidor cuenta las reagendas por la longitud');
        assert.equal(v.sectores.length, 1, 'el sector descartado se queda fuera');
        const s = v.sectores[0];
        assert.deepEqual(s.origen, ['BI', 'Ventas']);
        assert.equal(s.programado, true);
        assert.ok(s.guardado.momento, 'el sector va sellado');
        assert.equal(s.actividades.length, 1, 'la actividad descartada se queda fuera');
        const a = s.actividades[0];
        assert.equal(a.guardada.usuario, 'Melissa Cruz');
        assert.equal(a.fecha_documento, '2026-04-10');
        assert.deepEqual(a.evidencia, { estado: 'subida', url: 'https://drive.google.com/x' });
        assert.deepEqual(a.materiales[0], { id: 'as-m1', material: 'GASA', cantidad: 12, unidad: 'PI', origen: '210066' });
        assert.equal(a.materiales[1].cantidad, null, 'sin cantidad no se inventa una');
    });

    test('lo que la persona corrigió en la hoja es lo que sube', () => {
        const t = tablas('aprobada');
        t.visitas[0]!.hospital = 'Hospital corregido a mano';
        t.sectores[0]!.nombre = 'GUANTES';
        const [v] = g.asArmarVisitas(t);
        assert.equal(v.hospital, 'Hospital corregido a mano');
        assert.equal(v.sectores[0].nombre, 'GUANTES');
    });

    test('las actividades sin visita no se suben', () => {
        const t = tablas('aprobada');
        t.actividades.push({ id_actividad: 'as-a9', id_sector: '', id_visita: '', tipo: 'X', import_estado: 'sin_visita' } as never);
        const [v] = g.asArmarVisitas(t);
        assert.equal(v.sectores[0].actividades.length, 1);
    });
});

describe('forma de la migración y de los datos importados', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261009_pdt_appsheet_importar.sql'), 'utf8');

    test('guarda con la misma función que la app y encola el export a las pestañas normales', () => {
        assert.match(sql, /perform pdt_espejo_guardar\(v_correo, jsonb_build_array\(v\)\)/);
        assert.match(sql, /insert into pdt_export_cola/);
    });

    test('solo Apps Script (service_role) puede llamarla', () => {
        assert.match(sql, /revoke execute on function pdt_appsheet_importar\(jsonb\) from public, anon, authenticated;/);
        assert.match(sql, /grant\s+execute on function pdt_appsheet_importar\(jsonb\) to service_role;/);
    });

    test('no pisa lo editado en la app ni acepta ids que no sean de AppSheet', () => {
        assert.match(sql, /v_previa\.actualizado > v_previa\.importado_en/);
        assert.match(sql, /v_id not like 'as-%'/);
    });

    test('las pestañas de revisión conservan todas las columnas de origen', () => {
        for (const def of Object.values(g.AS_COLUMNAS) as any[]) assert.ok(def.columnas.includes('src_json'));
    });
});
