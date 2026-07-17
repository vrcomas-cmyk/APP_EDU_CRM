/**
 * Utilidades de fecha.
 *
 * Las visitas guardan el día como 'YYYY-MM-DD' y las horas como 'HH:MM', sin zona.
 * Las claves de día se sacan cortando la cadena, NO con toISOString(): eso convierte a UTC
 * y en México movería una visita de la tarde al día siguiente.
 */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Abreviados, lunes primero, para empatar con inicioSemana(). */
export const DIAS_ABREV = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

/** 'YYYY-MM-DD' de una fecha local (o de una cadena datetime-local). */
export function claveDia(fecha) {
    if (typeof fecha === 'string') return fecha.slice(0, 10);

    const mes = String(fecha.getMonth() + 1).padStart(2, '0');
    const dia = String(fecha.getDate()).padStart(2, '0');
    return `${fecha.getFullYear()}-${mes}-${dia}`;
}

export function claveHoy() {
    return claveDia(new Date());
}

/** 'HH:MM' de una cadena datetime-local. */
export function hora(fechaTexto) {
    return (fechaTexto || '').slice(11, 16);
}

/** Date a medianoche local desde 'YYYY-MM-DD'. */
export function desdeClave(clave) {
    const [a, m, d] = clave.split('-').map(Number);
    return new Date(a, m - 1, d);
}

export function sumarDias(fecha, dias) {
    const salida = new Date(fecha);
    salida.setDate(salida.getDate() + dias);
    return salida;
}

export function sumarMeses(fecha, meses) {
    const salida = new Date(fecha.getFullYear(), fecha.getMonth() + meses, 1);
    return salida;
}

/** Lunes de la semana que contiene a `fecha` (la semana laboral arranca en lunes). */
export function inicioSemana(fecha) {
    const salida = new Date(fecha);
    const diaSemana = (salida.getDay() + 6) % 7; // 0 = lunes
    salida.setDate(salida.getDate() - diaSemana);
    salida.setHours(0, 0, 0, 0);
    return salida;
}

export function inicioMes(fecha) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}

/** Claves de día de la cuadrícula del mes, incluyendo el relleno hasta completar semanas. */
export function diasDeCuadriculaMes(fecha) {
    const ultimo = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0);
    const claves = [];
    let cursor = inicioSemana(inicioMes(fecha));

    while (cursor <= ultimo || claves.length % 7 !== 0) {
        claves.push(claveDia(cursor));
        cursor = sumarDias(cursor, 1);
        if (claves.length >= 42) break;
    }
    return claves;
}

export function diasDeSemana(fecha) {
    const lunes = inicioSemana(fecha);
    return Array.from({ length: 7 }, (_, i) => claveDia(sumarDias(lunes, i)));
}

// ---------- etiquetas ----------

export function etiquetaDia(clave) {
    const hoy = claveHoy();
    if (clave === hoy) return 'Hoy';
    if (clave === claveDia(sumarDias(new Date(), 1))) return 'Mañana';
    if (clave === claveDia(sumarDias(new Date(), -1))) return 'Ayer';

    const f = desdeClave(clave);
    return `${DIAS[f.getDay()]} ${f.getDate()}`;
}

export function etiquetaDiaLarga(clave) {
    const f = desdeClave(clave);
    const base = `${DIAS[f.getDay()]} ${f.getDate()} de ${MESES[f.getMonth()]}`;
    const prefijo = etiquetaDia(clave);

    return ['Hoy', 'Mañana', 'Ayer'].includes(prefijo) ? `${prefijo} · ${base}` : base;
}

export function etiquetaMes(fecha) {
    return `${MESES[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

export function etiquetaRangoSemana(fecha) {
    const lunes = inicioSemana(fecha);
    const domingo = sumarDias(lunes, 6);

    if (lunes.getMonth() === domingo.getMonth()) {
        return `${lunes.getDate()}–${domingo.getDate()} de ${MESES[lunes.getMonth()]} ${lunes.getFullYear()}`;
    }
    return `${lunes.getDate()} ${MESES[lunes.getMonth()]} – ${domingo.getDate()} ${MESES[domingo.getMonth()]} ${domingo.getFullYear()}`;
}

export function inicialesDias() {
    // Lunes primero, para que empate con inicioSemana().
    return [1, 2, 3, 4, 5, 6, 0].map(i => DIAS_CORTOS[i]);
}

/**
 * Orden que pidió el usuario: hoy primero, luego lo que viene (ascendente) y al final
 * lo pasado (lo más reciente primero). Sin esto, el orden natural dejaría el pasado
 * arriba y hay que scrollear para ver el día de trabajo.
 */
export function ordenarClavesDias(claves, hoy = claveHoy()) {
    const futuras = claves.filter(c => c > hoy).sort();
    const pasadas = claves.filter(c => c < hoy).sort().reverse();
    const deHoy = claves.filter(c => c === hoy);
    return [...deHoy, ...futuras, ...pasadas];
}
