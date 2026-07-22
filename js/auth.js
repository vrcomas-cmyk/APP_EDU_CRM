/**
 * Identidad: Google Sign-In (Google Identity Services), reemplaza el campo "Educador".
 *
 * El token que da el navegador NUNCA se verifica aquí: con las herramientas de desarrollador
 * cualquiera podría inventar un JSON y decir que es quien quiera. Se decodifica solo para
 * pintar nombre/foto de inmediato; la verificación real —firma, expiración, dominio— ocurre
 * en el Apps Script cuando el dato de verdad viaja (sincronizar).
 *
 * Por eso la sesión SÍ se puede usar offline: la UI confía en la caché local (nombre/correo/
 * foto), el servidor no confía en nada que no haya verificado él mismo. El token dura ~1h y
 * offline no se puede renovar; se manda el que haya, y si ya venció, el servidor lo rechaza
 * con un mensaje claro y la fila queda pendiente hasta el siguiente sync con un token fresco.
 */

// Se exporta: el módulo de Google Calendar pide un token de ACCESO (OAuth2, con permiso de
// Calendar) con el mismo Client ID que ya usa este Sign-In de IDENTIDAD (id_token). Son dos
// flujos distintos de la misma API de Google Identity Services, no dos apps registradas.
export const CLIENT_ID = '698264876096-35bqu62bnsfb7v8tnph6m8p7pr7v56r9.apps.googleusercontent.com';
const DOMINIO = 'degasa.com';
const CLAVE_SESION = 'sesion';

let alCambiarSesion = () => {};
let gsiListo = false;
let gsiPromesa = null;

export function initAuth({ onSesion } = {}) {
    alCambiarSesion = onSesion || (() => {});

    cargarGSI().then(() => {
        // `cargarGSI` resuelve TAMBIÉN cuando el script no cargó —sin red, la sesión cacheada
        // sigue sirviendo para trabajar—, así que aquí `google` puede no existir. Sin esta
        // comprobación se lanza un rechazo no manejado en cada arranque offline, que es
        // justamente el arranque más común de esta app.
        if (!window.google?.accounts?.id) return;

        google.accounts.id.initialize({
            client_id: CLIENT_ID,
            callback: manejarCredencial,
            auto_select: true,
            hd: DOMINIO
        });
        gsiListo = true;
        // Sesión ya en caché: se intenta refrescar el token en silencio para que el
        // próximo sync no lo encuentre vencido. Si falla, no pasa nada — se reintenta
        // la próxima vez que haya conexión (ver alCambiarConexion en app.js).
        if (sesionActual() && navigator.onLine) intentarRefresco();
    });
}

function cargarGSI() {
    if (gsiPromesa) return gsiPromesa;
    gsiPromesa = new Promise((resolve) => {
        if (window.google?.accounts?.id) return resolve();
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = resolve;
        s.onerror = resolve; // sin red: la sesión cacheada sigue sirviendo para trabajar offline

        // Insertar el script puede lanzar de forma síncrona en entornos que bloquean scripts
        // externos. Se resuelve igual: la app tiene que arrancar sin GSI.
        try { document.head.appendChild(s); } catch { resolve(); }
    });
    return gsiPromesa;
}

function manejarCredencial({ credential }) {
    const datos = decodificarJWT(credential);
    if (!datos) return;

    const sesion = {
        nombre: datos.name || datos.email || '',
        correo: (datos.email || '').toLowerCase(),
        foto: datos.picture || '',
        id_token: credential,
        obtenido: Date.now()
    };
    localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    alCambiarSesion(sesion);
}

export function sesionActual() {
    try {
        const crudo = localStorage.getItem(CLAVE_SESION);
        return crudo ? JSON.parse(crudo) : null;
    } catch (err) {
        console.error('Sesión ilegible:', err);
        return null;
    }
}

/** Pinta el botón oficial de Google en el contenedor que le pases (la pantalla de entrada). */
export function pintarBotonEntrada(contenedor) {
    cargarGSI().then(() => {
        if (!window.google?.accounts?.id) {
            contenedor.textContent = 'Sin conexión. Conéctate para iniciar sesión.';
            return;
        }
        google.accounts.id.initialize({ client_id: CLIENT_ID, callback: manejarCredencial, hd: DOMINIO });
        google.accounts.id.renderButton(contenedor, {
            theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'es'
        });
    });
}

/** Intento silencioso (One Tap / auto-select): renueva el token sin pedirle nada al educador. */
export function intentarRefresco() {
    if (!gsiListo || !navigator.onLine) return;
    try { google.accounts.id.prompt(); } catch (err) { console.error('No se pudo refrescar la sesión:', err); }
}

export function cerrarSesion() {
    localStorage.removeItem(CLAVE_SESION);
    try { google.accounts.id.disableAutoSelect(); } catch { /* GSI no cargó; no hay nada que deshacer */ }
    alCambiarSesion(null);
}

/** Decodifica el payload del JWT (base64url) sin validarlo — solo para pintar la UI. */
function decodificarJWT(token) {
    try {
        const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (err) {
        console.error('Token de sesión ilegible:', err);
        return null;
    }
}
