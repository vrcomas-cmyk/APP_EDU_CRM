/**
 * Capa de acceso a datos.
 *
 * Es la costura por la que entrará la arquitectura futura sin reescribir la aplicación.
 * Hoy toda consulta se resuelve contra localStorage; mañana parte vendrá de Supabase y los
 * agregados de DuckDB. Quien pregunta —dashboards, revisión, filtros— no sabe de dónde sale
 * la respuesta, y por eso cambiar el origen no lo obliga a cambiar.
 *
 *   HOY        localStorage (lo del propio usuario)  +  Sheets/Drive vía Apps Script (escritura)
 *   DESPUÉS    + Supabase (lectura del equipo)  + DuckDB (agregados)  + R2 (archivos)
 *
 * Google Sheets, Drive y Apps Script NO se sustituyen: siguen siendo la capa operativa y de
 * integración. Esta capa se suma; no reemplaza nada.
 *
 * ── El alcance se aplica AQUÍ ────────────────────────────────────────────────────────
 *
 * Toda consulta pasa por el alcance jerárquico antes de devolver nada. Ponerlo en cada
 * pantalla significaría que una pantalla nueva puede olvidarlo, y un olvido en control de
 * acceso no se ve: la pantalla funciona, solo que muestra de más.
 */

import { leerVisitas } from './storage.js';
import { alcance, puede } from './permisos.js';
import {
    estadoDe, ESTADOS, actividadesDe,
    evidenciasPendientesDe, tieneCheckIn, tieneCheckOut, permanenciaMinutos
} from './estado.js';

// ---------- fuentes ----------

/**
 * Registro de orígenes de datos. La fuente local ya está puesta; `registrarFuente` es el
 * punto por el que se enchufa Supabase cuando exista el espejo de lectura, sin que ninguna
 * pantalla se entere.
 */
const fuentes = new Map();

export function registrarFuente(nombre, fuente) {
    if (typeof fuente?.listarVisitas !== 'function') {
        throw new Error(`La fuente "${nombre}" debe implementar listarVisitas()`);
    }
    fuentes.set(nombre, fuente);
}

export function fuentesRegistradas() { return [...fuentes.keys()]; }

/** Lo capturado en este dispositivo. */
registrarFuente('local', {
    listarVisitas() {
        // Los borradores no son datos todavía: no cuentan para ningún indicador.
        return leerVisitas().filter(v => !v.borrador);
    }
});

/**
 * El equipo, traído del espejo de Supabase.
 *
 * Se guarda en memoria y NO en localStorage: son datos de otras personas y no tienen por qué
 * quedarse en el dispositivo de nadie más de lo que dure la sesión. Además cambian solos —el
 * equipo sigue capturando— y una copia vieja en disco se leería como si fuera la actual.
 */
let visitasEquipo = [];
let equipoCargado = false;

registrarFuente('equipo', {
    listarVisitas() { return visitasEquipo; }
});

/** La llama `app.js` tras sincronizar. `visitas` ya viene recortado por jerarquía. */
export function ponerVisitasEquipo(visitas) {
    visitasEquipo = Array.isArray(visitas) ? visitas : [];
    equipoCargado = true;
}

export function hayEquipoCargado() { return equipoCargado; }

export function olvidarVisitasEquipo() {
    visitasEquipo = [];
    equipoCargado = false;
}

// ---------- filtros ----------

export const FILTRO_VACIO = {
    educador: '', cliente: '', hospital: '', sector: '',
    tipo_actividad: '', estado: '', desde: '', hasta: ''
};

export function filtroVacio() { return { ...FILTRO_VACIO }; }

export function hayFiltro(filtro) {
    return Object.keys(FILTRO_VACIO).some(k => (filtro?.[k] || '') !== '');
}

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Aplica un filtro a una lista de visitas.
 *
 * Sector y tipo de actividad miran DENTRO del árbol: filtrar por "GASAS" debe traer la visita
 * que trabajó gasas entre otros sectores, no solo la que trabajó gasas y nada más.
 */
export function aplicarFiltro(visitas, filtro = FILTRO_VACIO) {
    const f = { ...FILTRO_VACIO, ...filtro };

    return visitas.filter(v => {
        if (f.educador && norm(v.educador_correo) !== norm(f.educador)
            && norm(v.educador) !== norm(f.educador)) return false;
        if (f.cliente && norm(v.cliente) !== norm(f.cliente)) return false;
        if (f.hospital && norm(v.hospital) !== norm(f.hospital)) return false;
        if (f.estado && estadoDe(v) !== f.estado) return false;

        // Las fechas se comparan como cadena 'YYYY-MM-DD'. Es correcto porque ese formato
        // ordena igual como texto que como fecha, y evita construir Date por visita —que a
        // cientos de miles de registros sí se nota.
        if (f.desde && (v.dia || '') < f.desde) return false;
        if (f.hasta && (v.dia || '') > f.hasta) return false;

        if (f.sector) {
            const tiene = (v.sectores || []).some(s => norm(s.nombre) === norm(f.sector));
            if (!tiene) return false;
        }
        if (f.tipo_actividad) {
            const tiene = actividadesDe(v).some(a => norm(a.tipo) === norm(f.tipo_actividad));
            if (!tiene) return false;
        }
        return true;
    });
}

// ---------- consulta ----------

/**
 * La consulta única de la aplicación. Junta las fuentes registradas, recorta por alcance y
 * aplica el filtro.
 *
 * Se deduplica por id porque cuando exista el espejo remoto, una visita propia va a llegar
 * dos veces —de local y de Supabase— y contarla dos veces inflaría todos los indicadores.
 * Gana la local: es la que puede tener cambios que aún no suben.
 */
export function consultarVisitas(filtro = FILTRO_VACIO) {
    if (!puede('visitas', 'consultar')) return [];

    const porId = new Map();
    for (const [nombre, fuente] of fuentes) {
        let lote = [];
        try {
            lote = fuente.listarVisitas() || [];
        } catch (err) {
            // Una fuente caída no debe vaciar el dashboard: se sigue con las demás.
            console.error(`La fuente "${nombre}" falló:`, err);
            continue;
        }
        for (const v of lote) {
            if (nombre === 'local' || !porId.has(v.id)) porId.set(v.id, v);
        }
    }

    const visibles = [...porId.values()].filter(v => visiblePara(v));
    return aplicarFiltro(visibles, filtro);
}

/**
 * ¿Este usuario puede ver esta visita?
 *
 * Se compara por CORREO, no por nombre: dos personas pueden llamarse igual y el nombre se
 * escribe a mano en datos viejos. Una visita sin correo —capturada antes de que existiera la
 * sesión— solo la ve quien pueda ver a alguien más que a sí mismo; para un educador queda
 * fuera, que es el lado seguro.
 */
export function visiblePara(visita) {
    const correo = norm(visita.educador_correo);
    const permitidos = alcance().map(norm);

    if (correo) return permitidos.includes(correo);
    return permitidos.length > 1;
}

// ---------- valores para los filtros ----------

/** Opciones reales de cada filtro, sacadas de lo que el usuario puede ver. */
export function opcionesDeFiltro(visitas = consultarVisitas()) {
    const conjunto = (fn) => {
        const s = new Set();
        visitas.forEach(v => fn(v, s));
        return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
    };

    return {
        educadores: conjunto((v, s) => s.add(v.educador)),
        clientes: conjunto((v, s) => s.add(v.cliente)),
        hospitales: conjunto((v, s) => s.add(v.hospital)),
        sectores: conjunto((v, s) => (v.sectores || []).forEach(x => s.add(x.nombre))),
        tipos: conjunto((v, s) => actividadesDe(v).forEach(a => s.add(a.tipo))),
        estados: Object.values(ESTADOS)
    };
}

// ---------- indicadores ----------

/**
 * Todos los indicadores en UNA pasada.
 *
 * A dos visitas da igual; a cientos de miles no: trece funciones sueltas serían trece
 * recorridos del mismo arreglo. Cuando esto se mueva a DuckDB será un solo SELECT con
 * agregados, y esta forma —un objeto plano de contadores— es la que se traduce directo.
 */
export function calcularIndicadores(visitas) {
    const ind = {
        visitas: 0, programadas: 0, en_proceso: 0, finalizadas: 0, canceladas: 0,
        realizadas: 0, pendientes: 0,
        actividades: 0, actividades_borrador: 0,
        sectores: 0, sectores_distintos: 0,
        materiales: 0, piezas: 0,
        evidencias_pendientes: 0, evidencias_subidas: 0,
        reagendaciones: 0, retrasos: 0,
        minutos_efectivos: 0,
        por_educador: {}, por_tipo: {}, por_sector: {},
        por_cliente: {}, por_hospital: {}, por_dia: {}
    };

    const sectoresVistos = new Set();
    const suma = (mapa, clave, n = 1) => {
        if (!clave) return;
        mapa[clave] = (mapa[clave] || 0) + n;
    };

    for (const v of visitas) {
        ind.visitas++;

        const estado = estadoDe(v);
        if (estado === ESTADOS.PROGRAMADA) ind.programadas++;
        else if (estado === ESTADOS.EN_PROCESO) ind.en_proceso++;
        else if (estado === ESTADOS.FINALIZADA) ind.finalizadas++;
        else if (estado === ESTADOS.CANCELADA) ind.canceladas++;

        // "Realizada" es haber estado ahí (hay check-in), no que la hora ya pasó.
        if (tieneCheckIn(v)) ind.realizadas++;
        else if (estado !== ESTADOS.CANCELADA) ind.pendientes++;

        ind.reagendaciones += (v.reagendas || []).length;

        if (tieneCheckIn(v) && v.hora_inicio && v.check_in?.momento) {
            const llegada = new Date(v.check_in.momento);
            const [hh, mm] = v.hora_inicio.split(':').map(Number);
            const minutosTarde = (llegada.getHours() * 60 + llegada.getMinutes()) - (hh * 60 + mm);
            if (minutosTarde > 15) ind.retrasos++;   // 15 min de gracia: el tráfico existe
        }
        if (tieneCheckOut(v)) {
            ind.minutos_efectivos += permanenciaMinutos(v) || 0;
        }

        suma(ind.por_educador, v.educador);
        suma(ind.por_cliente, v.cliente);
        suma(ind.por_hospital, v.hospital);
        suma(ind.por_dia, v.dia);

        for (const s of v.sectores || []) {
            ind.sectores++;
            sectoresVistos.add(s.nombre);
            suma(ind.por_sector, s.nombre);

            for (const a of s.actividades || []) {
                if (!a.guardada) { ind.actividades_borrador++; continue; }
                ind.actividades++;
                suma(ind.por_tipo, a.tipo);

                for (const m of a.materiales || []) {
                    ind.materiales++;
                    const n = Number(m.cantidad);
                    if (Number.isFinite(n)) ind.piezas += n;
                }
                if (a.evidencia?.estado === 'subida') ind.evidencias_subidas++;
            }
        }

        ind.evidencias_pendientes += evidenciasPendientesDe(v).length;
    }

    ind.sectores_distintos = sectoresVistos.size;

    // Cumplimiento: de lo que ya debió ocurrir, cuánto se registró de verdad.
    const exigibles = ind.visitas - ind.canceladas;
    ind.cumplimiento = exigibles > 0 ? Math.round((ind.realizadas / exigibles) * 100) : 0;
    ind.horas_efectivas = Math.round(ind.minutos_efectivos / 6) / 10;

    return ind;
}

/** Top N de un mapa {clave: n}, del más alto al más bajo. Para las gráficas de barras. */
export function top(mapa, n = 8) {
    return Object.entries(mapa || {})
        .filter(([k]) => k)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))
        .slice(0, n);
}

// ---------- evidencias ----------

/**
 * Dónde vive el archivo de una evidencia. Hoy Drive; mañana R2.
 *
 * Existe para que ninguna pantalla escriba una URL de Drive a mano: el día que el archivo
 * viva en R2, cambia esta función y nada más.
 */
export function urlEvidencia(actividad) {
    const ev = actividad?.evidencia;
    if (!ev) return null;
    if (ev.estado === 'subida' && ev.url) return { tipo: 'remota', url: ev.url, mime: ev.mime || '' };
    if (ev.estado === 'local') return { tipo: 'local', id: actividad.id, mime: ev.mime || '' };
    return null;
}
