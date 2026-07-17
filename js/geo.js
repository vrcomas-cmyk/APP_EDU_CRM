/**
 * Ubicación para el check-in / check-out.
 *
 * Regla de oro: el GPS NUNCA bloquea. Dentro de un hospital la señal es mala, el usuario
 * puede negar el permiso, y el educador está de pie con el cliente enfrente. Si la ubicación
 * no llega, el check-in se registra igual y deja constancia de POR QUÉ no la hay — que es un
 * dato más honesto que una coordenada inventada o un botón que no responde.
 *
 * La dirección aproximada NO se resuelve aquí: geocodificar exige una API con llave. Lo hace
 * el Apps Script al sincronizar, con el servicio Maps que ya viene incluido.
 */

const TIEMPO_MAX = 8000;    // más de 8s de pie frente al cliente es una eternidad
const CACHE_MAX = 30000;    // una posición de hace <30s sirve perfectamente

export const MOTIVOS = {
    SIN_SOPORTE: 'El dispositivo no tiene GPS',
    PERMISO: 'Permiso de ubicación denegado',
    NO_DISPONIBLE: 'No se pudo obtener la señal',
    TIMEOUT: 'El GPS tardó demasiado',
    DESCONOCIDO: 'No se pudo obtener la ubicación'
};

/**
 * Devuelve SIEMPRE un objeto, nunca lanza:
 *   { lat, lng, precision_m, momento }        cuando hay señal
 *   { error: 'motivo legible', momento }      cuando no
 */
export function obtenerUbicacion() {
    return new Promise(resolve => {
        const momento = new Date().toISOString();

        if (!navigator.geolocation) {
            return resolve({ error: MOTIVOS.SIN_SOPORTE, momento });
        }

        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                lat: redondear(pos.coords.latitude),
                lng: redondear(pos.coords.longitude),
                precision_m: Math.round(pos.coords.accuracy),
                momento
            }),
            (err) => resolve({ error: motivoDe(err), momento }),
            { enableHighAccuracy: true, timeout: TIEMPO_MAX, maximumAge: CACHE_MAX }
        );
    });
}

function motivoDe(err) {
    if (err.code === 1) return MOTIVOS.PERMISO;
    if (err.code === 2) return MOTIVOS.NO_DISPONIBLE;
    if (err.code === 3) return MOTIVOS.TIMEOUT;
    return MOTIVOS.DESCONOCIDO;
}

/** ~1cm de resolución. Más decimales solo serían ruido del sensor. */
function redondear(n) { return Math.round(n * 1e7) / 1e7; }

/**
 * Qué dispositivo registró la acción. userAgent completo es ilegible en una hoja de cálculo;
 * esto deja algo que un humano puede leer en una columna.
 */
export function describirDispositivo() {
    const ua = navigator.userAgent || '';
    const so = [
        [/Android[ /]([\d.]+)/, 'Android'], [/iPhone OS ([\d_]+)/, 'iOS'],
        [/iPad.*OS ([\d_]+)/, 'iPadOS'], [/Windows NT ([\d.]+)/, 'Windows'],
        [/Mac OS X ([\d_]+)/, 'macOS'], [/Linux/, 'Linux']
    ].find(([re]) => re.test(ua));

    const navegador = [
        [/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Chrome\//, 'Chrome'],
        [/Firefox\//, 'Firefox'], [/Safari\//, 'Safari']
    ].find(([re]) => re.test(ua));

    const version = so ? (ua.match(so[0])?.[1] || '').replace(/_/g, '.') : '';
    return [so ? `${so[1]} ${version}`.trim() : 'Desconocido', navegador?.[1]]
        .filter(Boolean).join(' · ');
}

/** Texto para la UI. Sin coordenadas crudas: a nadie le dicen nada 19.4326, -99.1332. */
export function describirUbicacion(u) {
    if (!u) return 'Sin ubicación';
    if (u.error) return u.error;
    if (u.direccion) return u.direccion;
    return `Ubicación registrada · ±${u.precision_m} m`;
}

/**
 * Una precisión de cientos de metros no sirve para probar que estuviste en el hospital.
 * Se avisa en vez de descartarla: sigue siendo mejor que nada.
 */
export function precisionDudosa(u) {
    return !!u && !u.error && u.precision_m > 200;
}
