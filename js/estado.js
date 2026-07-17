/**
 * Estado de una visita. Se CALCULA, no se declara.
 *
 * Antes había un `estado: 'agendada'|'completada'` que el usuario marcaba a mano. Un estado
 * manual siempre miente: se olvida marcarlo, o se marca completo con evidencias pendientes.
 * Aquí sale de tres hechos: si hay actividades, si sus evidencias subieron, y si ya pasó la hora.
 *
 * Los cuatro estados y su intención:
 *   programada  gris    — aún no llega su hora. Sin actividades, y está bien.
 *   sin-registrar rojo  — YA pasó su hora y sigue vacía. Esto sí es una alerta.
 *   faltan-evidencias azul — hay actividades, falta subir soporte.
 *   completa    verde   — actividades y evidencias, todo arriba.
 *
 * El rojo se gana: no aparece por estar vacía, sino por estar vacía DESPUÉS de su hora. Si
 * una visita futura naciera roja, toda la agenda de la semana se vería en llamas y el color
 * dejaría de significar algo.
 */

import { requiereEvidencia } from './catalogos.js';
import { leerVisitas, todasLasActividades } from './storage.js';

export const ESTADOS = {
    PROGRAMADA: 'programada',
    SIN_REGISTRAR: 'sin-registrar',
    FALTAN_EVIDENCIAS: 'faltan-evidencias',
    COMPLETA: 'completa'
};

const ETIQUETAS = {
    [ESTADOS.PROGRAMADA]: 'Programada',
    [ESTADOS.SIN_REGISTRAR]: 'Sin registrar',
    [ESTADOS.FALTAN_EVIDENCIAS]: 'Faltan evidencias',
    [ESTADOS.COMPLETA]: 'Completa'
};

/** Todas las actividades de la visita, de todos sus sectores. */
export function actividadesDe(visita) {
    return (visita.sectores || []).flatMap(s => s.actividades || []);
}

/**
 * Deuda real de evidencias. Solo cuentan las actividades cuyo TIPO la exige: marcar una
 * "Revisión de anaquel" como pendiente sería deuda imposible de saldar, y una bandeja llena
 * de cosas que no se pueden cerrar se deja de mirar.
 */
export function evidenciasPendientesDe(visita) {
    return actividadesDe(visita)
        .filter(a => requiereEvidencia(a) && a.evidencia?.estado !== 'subida');
}

/**
 * `ahora` se inyecta para poder probar el paso del tiempo sin viajar en él.
 * Se compara contra hora_fin: una visita en curso no es un descuido todavía.
 */
export function estadoDe(visita, ahora = new Date()) {
    const actividades = actividadesDe(visita);

    if (actividades.length === 0) {
        return yaTermino(visita, ahora) ? ESTADOS.SIN_REGISTRAR : ESTADOS.PROGRAMADA;
    }
    return evidenciasPendientesDe(visita).length === 0
        ? ESTADOS.COMPLETA
        : ESTADOS.FALTAN_EVIDENCIAS;
}

export function etiquetaEstado(estado) {
    return ETIQUETAS[estado] || estado;
}

/** Deuda de evidencias de TODA la app. Es lo que cuenta el contador de la barra. */
export function deudaGlobal(visitas = leerVisitas()) {
    return todasLasActividades(visitas)
        .filter(({ actividad }) => requiereEvidencia(actividad) && actividad.evidencia?.estado !== 'subida');
}

/** Texto que acompaña al color. El color nunca va solo. */
export function detalleEstado(visita, ahora = new Date()) {
    const estado = estadoDe(visita, ahora);
    const actividades = actividadesDe(visita);
    const faltan = evidenciasPendientesDe(visita).length;

    if (estado === ESTADOS.SIN_REGISTRAR) return 'Sin registrar · 0 actividades';
    if (estado === ESTADOS.PROGRAMADA) return 'Programada';

    const n = `${actividades.length} actividad${actividades.length === 1 ? '' : 'es'}`;
    if (estado === ESTADOS.COMPLETA) return `Completa · ${n}`;
    return `${n} · falta${faltan === 1 ? '' : 'n'} ${faltan} evidencia${faltan === 1 ? '' : 's'}`;
}

// ---------- tiempo ----------

/** Date local a partir de 'YYYY-MM-DD' + 'HH:MM'. Sin Date(string): eso interpreta UTC. */
export function fechaHora(dia, hora) {
    if (!dia) return null;
    const [a, m, d] = dia.split('-').map(Number);
    const [hh, mm] = (hora || '00:00').split(':').map(Number);
    return new Date(a, m - 1, d, hh || 0, mm || 0);
}

export function inicioDe(visita) {
    return fechaHora(visita.dia, visita.hora_inicio);
}

export function finDe(visita) {
    return fechaHora(visita.dia, visita.hora_fin);
}

export function yaTermino(visita, ahora = new Date()) {
    const fin = finDe(visita);
    return fin ? fin < ahora : false;
}

export function estaEnCurso(visita, ahora = new Date()) {
    const ini = inicioDe(visita);
    const fin = finDe(visita);
    return ini && fin ? ini <= ahora && ahora <= fin : false;
}

/** Duración en horas decimales. La rejilla la usa para dar altura a la tarjeta. */
export function duracionHoras(visita) {
    const ini = inicioDe(visita);
    const fin = finDe(visita);
    if (!ini || !fin) return 1;
    return Math.max(0.25, (fin - ini) / 3600000);
}

export function duracionTexto(visita) {
    const h = duracionHoras(visita);
    const horas = Math.floor(h);
    const min = Math.round((h - horas) * 60);
    if (horas === 0) return `${min}min`;
    return min === 0 ? `${horas}h` : `${horas}h ${min}min`;
}

// ---------- solapamientos ----------

/**
 * ¿Chocan dos visitas en el tiempo? Se ignora el toque exacto (una termina justo cuando
 * la otra empieza): eso es una agenda apretada, no un conflicto.
 */
export function seSolapan(a, b) {
    if (a.dia !== b.dia) return false;
    const iA = inicioDe(a), fA = finDe(a), iB = inicioDe(b), fB = finDe(b);
    if (!iA || !fA || !iB || !fB) return false;
    return iA < fB && iB < fA;
}

/** Visitas que chocan con un horario dado. `ignorarId` sirve al reagendar la propia visita. */
export function buscarSolapes(visitas, candidata, ignorarId = null) {
    return visitas.filter(v => v.id !== ignorarId && v.id !== candidata.id && seSolapan(v, candidata));
}

/**
 * Reparte en columnas las visitas que se pisan, para dibujarlas lado a lado.
 * Devuelve [{visita, columna, columnas}]. Un grupo es una cadena de solapes: A pisa a B y
 * B pisa a C mete a las tres en el mismo grupo aunque A y C no se toquen — si no, C se
 * dibujaría encima de A.
 */
export function repartirEnColumnas(visitasDelDia) {
    const orden = [...visitasDelDia].sort((a, b) => {
        const d = (inicioDe(a) || 0) - (inicioDe(b) || 0);
        return d !== 0 ? d : (finDe(b) || 0) - (finDe(a) || 0);
    });

    const salida = [];
    let grupo = [];
    let finGrupo = null;

    const cerrarGrupo = () => {
        if (grupo.length === 0) return;
        const columnas = [];

        grupo.forEach(visita => {
            let i = columnas.findIndex(col => !col.some(otra => seSolapan(otra, visita)));
            if (i === -1) { columnas.push([]); i = columnas.length - 1; }
            columnas[i].push(visita);
        });

        columnas.forEach((col, i) => col.forEach(visita => {
            salida.push({ visita, columna: i, columnas: columnas.length });
        }));

        grupo = [];
        finGrupo = null;
    };

    orden.forEach(visita => {
        const ini = inicioDe(visita);
        if (finGrupo && ini >= finGrupo) cerrarGrupo();
        grupo.push(visita);
        const fin = finDe(visita);
        if (!finGrupo || (fin && fin > finGrupo)) finGrupo = fin;
    });
    cerrarGrupo();

    return salida;
}
