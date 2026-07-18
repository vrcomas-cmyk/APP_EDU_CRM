/**
 * Dos dimensiones distintas, y conviene no confundirlas:
 *
 *   ESTADO  — el ciclo de vida. Es un DATO, lo mueven el check-in y el check-out:
 *             programada → en-proceso → finalizada.  cancelada corta en cualquier punto.
 *             Es una cadena, no un enum cerrado: agregar un estado nuevo no debe obligar a
 *             tocar la lógica de color.
 *
 *   COLOR   — la salud del registro. Se CALCULA, y solo existe DESPUÉS del check-in:
 *             antes de llegar con el cliente no ha pasado nada que juzgar.
 *               sin check-in         → sin color (gris)
 *               check-in, 0 activid. → rojo   "estás aquí y no has registrado nada"
 *               faltan evidencias    → azul
 *               todo con su soporte  → verde
 *             cancelada → apagada y tachada; no gasta color, no pasó nada que reportar.
 */

import { requiereEvidencia } from './catalogos.js';
import { leerVisitas, todasLasActividades } from './storage.js';

// ---------- ciclo de vida ----------

export const ESTADOS = {
    PROGRAMADA: 'programada',
    EN_PROCESO: 'en-proceso',
    FINALIZADA: 'finalizada',
    CANCELADA: 'cancelada'
};

const ETIQUETAS_ESTADO = {
    [ESTADOS.PROGRAMADA]: 'Programada',
    [ESTADOS.EN_PROCESO]: 'En proceso',
    [ESTADOS.FINALIZADA]: 'Finalizada',
    [ESTADOS.CANCELADA]: 'Cancelada'
};

/** El estado vive en el dato. Si viniera uno desconocido, se muestra tal cual. */
export function estadoDe(visita) {
    return visita.estado || ESTADOS.PROGRAMADA;
}

export function etiquetaEstado(estado) {
    return ETIQUETAS_ESTADO[estado] || estado;
}

export function tieneCheckIn(visita) { return !!visita.check_in; }
export function tieneCheckOut(visita) { return !!visita.check_out; }

// ---------- color (salud del registro) ----------

export const SALUD = {
    NEUTRA: 'neutra',                       // aún no hay nada que juzgar
    SIN_REGISTRAR: 'sin-registrar',         // rojo
    FALTAN_EVIDENCIAS: 'faltan-evidencias', // azul
    COMPLETA: 'completa',                   // verde
    CANCELADA: 'cancelada'
};

/**
 * El color se gana con el check-in. Sin él, la visita es gris aunque su hora ya haya pasado:
 * el color mide lo que registraste estando ahí, no si llegaste.
 */
export function saludDe(visita) {
    if (estadoDe(visita) === ESTADOS.CANCELADA) return SALUD.CANCELADA;
    if (!tieneCheckIn(visita)) return SALUD.NEUTRA;

    // Solo lo guardado cuenta: un borrador a medio escribir no es trabajo registrado, y
    // pintar la visita de verde por él afirmaría algo que todavía no ocurrió.
    const actividades = actividadesGuardadasDe(visita);
    if (actividades.length === 0) return SALUD.SIN_REGISTRAR;

    return evidenciasPendientesDe(visita).length === 0
        ? SALUD.COMPLETA
        : SALUD.FALTAN_EVIDENCIAS;
}

/** Texto que acompaña al color. El color nunca va solo. */
export function detalleEstado(visita) {
    const estado = estadoDe(visita);

    if (estado === ESTADOS.CANCELADA) {
        return visita.motivo_cancelacion ? `Cancelada · ${visita.motivo_cancelacion}` : 'Cancelada';
    }
    if (!tieneCheckIn(visita)) return 'Programada';

    const actividades = actividadesGuardadasDe(visita);
    const faltan = evidenciasPendientesDe(visita).length;
    const prefijo = etiquetaEstado(estado);

    if (actividades.length === 0) {
        const borradores = actividadesDe(visita).length;
        return borradores > 0
            ? `${prefijo} · ${borradores} sin guardar`
            : `${prefijo} · sin actividades`;
    }

    const n = `${actividades.length} actividad${actividades.length === 1 ? '' : 'es'}`;
    if (faltan === 0) return `${prefijo} · ${n}`;
    return `${prefijo} · ${n} · falta${faltan === 1 ? '' : 'n'} ${faltan} evidencia${faltan === 1 ? '' : 's'}`;
}

// ---------- actividades y evidencias ----------

export function actividadesDe(visita) {
    return (visita.sectores || []).flatMap(s => s.actividades || []);
}

/**
 * Una actividad cuenta como registro cuando tiene su sello de guardado. Antes de eso es
 * captura en curso: existe en el teléfono para no perderse, pero todavía no afirma nada.
 *
 * La distinción no es cosmética. Un borrador no sube, no suma a la salud de la visita y no
 * genera deuda de evidencia — pedir la foto de algo que aún no se termina de escribir es
 * deuda que nadie puede saldar.
 */
export function estaGuardada(actividad) { return !!actividad?.guardada; }

export function actividadesGuardadasDe(visita) {
    return actividadesDe(visita).filter(estaGuardada);
}

/**
 * Deuda real: solo cuentan las actividades cuyo TIPO exige evidencia. Marcar una
 * "Revisión de anaquel" como pendiente sería deuda imposible de saldar, y una bandeja llena
 * de cosas que no se pueden cerrar se deja de mirar.
 */
export function evidenciasPendientesDe(visita) {
    return actividadesGuardadasDe(visita)
        .filter(a => requiereEvidencia(a) && a.evidencia?.estado !== 'subida');
}

/**
 * Deuda de evidencias de TODA la app: lo que cuenta el contador de la barra.
 * Sin check-in no hay deuda —no se registró nada— y las canceladas tampoco cuentan:
 * nadie va a conseguir la foto de una visita que no ocurrió.
 */
export function deudaGlobal(visitas = leerVisitas()) {
    const vivas = visitas.filter(v => estadoDe(v) !== ESTADOS.CANCELADA && tieneCheckIn(v));
    return todasLasActividades(vivas)
        .filter(({ actividad }) => estaGuardada(actividad)
            && requiereEvidencia(actividad) && actividad.evidencia?.estado !== 'subida');
}

// ---------- estado de un sector ----------

export const SECTOR = { PENDIENTE: 'pendiente', EN_PROCESO: 'en-proceso', FINALIZADO: 'finalizado' };

/**
 * Se deriva; no hay un botón de "terminar sector". Un sector se da por finalizado cuando la
 * visita se finalizó y él tiene actividades: pedir que además lo marquen a mano sería un
 * clic que no aporta nada y que se olvida.
 */
export function estadoSector(visita, sector) {
    const n = (sector.actividades || []).length;
    if (n === 0) return SECTOR.PENDIENTE;
    return estadoDe(visita) === ESTADOS.FINALIZADA ? SECTOR.FINALIZADO : SECTOR.EN_PROCESO;
}

export function etiquetaSector(estado) {
    return { pendiente: 'Pendiente', 'en-proceso': 'En proceso', finalizado: 'Finalizado' }[estado] || estado;
}

// ---------- tiempo ----------

/** Date local desde 'YYYY-MM-DD' + 'HH:MM'. Sin Date(string): eso interpreta UTC. */
export function fechaHora(dia, hora) {
    if (!dia) return null;
    const [a, m, d] = dia.split('-').map(Number);
    const [hh, mm] = (hora || '00:00').split(':').map(Number);
    return new Date(a, m - 1, d, hh || 0, mm || 0);
}

export function inicioDe(visita) { return fechaHora(visita.dia, visita.hora_inicio); }
export function finDe(visita) { return fechaHora(visita.dia, visita.hora_fin); }

export function yaTermino(visita, ahora = new Date()) {
    const fin = finDe(visita);
    return fin ? fin < ahora : false;
}

export function estaEnCurso(visita, ahora = new Date()) {
    const ini = inicioDe(visita);
    const fin = finDe(visita);
    return ini && fin ? ini <= ahora && ahora <= fin : false;
}

/** Duración PLANEADA, en horas decimales. La rejilla la usa para dar altura a la tarjeta. */
export function duracionHoras(visita) {
    const ini = inicioDe(visita);
    const fin = finDe(visita);
    if (!ini || !fin) return 1;
    return Math.max(0.25, (fin - ini) / 3600000);
}

export function duracionTexto(visita) {
    return minutosATexto(duracionHoras(visita) * 60);
}

/**
 * Permanencia REAL: del check-in al check-out. Es otra cosa que la duración planeada, y por
 * eso se guarda aparte — la diferencia entre ambas es justo lo que un reporte querrá medir.
 */
export function permanenciaMinutos(visita) {
    if (!visita.check_in?.momento || !visita.check_out?.momento) return null;
    const ms = new Date(visita.check_out.momento) - new Date(visita.check_in.momento);
    return ms >= 0 ? Math.round(ms / 60000) : null;
}

export function permanenciaTexto(visita) {
    const min = permanenciaMinutos(visita);
    return min === null ? null : minutosATexto(min);
}

function minutosATexto(min) {
    const horas = Math.floor(min / 60);
    const resto = Math.round(min % 60);
    if (horas === 0) return `${resto}min`;
    return resto === 0 ? `${horas}h` : `${horas}h ${resto}min`;
}

// ---------- solapamientos ----------

/** Se ignora el toque exacto: una termina cuando la otra empieza es agenda apretada, no conflicto. */
export function seSolapan(a, b) {
    if (a.dia !== b.dia) return false;
    const iA = inicioDe(a), fA = finDe(a), iB = inicioDe(b), fB = finDe(b);
    if (!iA || !fA || !iB || !fB) return false;
    return iA < fB && iB < fA;
}

export function buscarSolapes(visitas, candidata, ignorarId = null) {
    return visitas.filter(v => v.id !== ignorarId && v.id !== candidata.id && seSolapan(v, candidata));
}

/**
 * Reparte en columnas las visitas que se pisan, para dibujarlas lado a lado.
 * Un grupo es una CADENA de solapes: si A pisa a B y B pisa a C, las tres van al mismo grupo
 * aunque A y C no se toquen — si no, C se dibujaría encima de A.
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
        if (finGrupo && inicioDe(visita) >= finGrupo) cerrarGrupo();
        grupo.push(visita);
        const fin = finDe(visita);
        if (!finGrupo || (fin && fin > finGrupo)) finGrupo = fin;
    });
    cerrarGrupo();

    return salida;
}
