/**
 * Identidad + Google Calendar en UN solo consentimiento (Google Identity Services, código de
 * autorización), reemplaza el campo "Educador".
 *
 * Antes había dos flujos de GSI por separado: identidad con `google.accounts.id` (id_token,
 * ~1h, sin scopes) y Calendar con `google.accounts.oauth2.initTokenClient` (flujo implícito,
 * access_token de ~1h y SIN refresh token — moría en cada recarga y cada dispositivo tenía que
 * pedir el permiso por su cuenta). Ahora es un único `initCodeClient`: pide identidad Y Calendar
 * a la vez, y el `code` que entrega se canjea del lado del servidor (Apps Script,
 * `canjearCodigoGoogle` en `apps-script/Codigo.gs`) por un access_token y, en el primer
 * consentimiento, un REFRESH TOKEN — que se guarda en Supabase por CUENTA, no por dispositivo
 * (`pdt_google_credenciales`). El navegador nunca ve el refresh token.
 *
 * Lo que este módulo guarda en localStorage es una sesión PROPIA de la app: un token opaco
 * (`sesion_token`) que Apps Script resuelve contra esa tabla. No caduca por sí sola — solo si la
 * persona cambia su contraseña de Google, revoca el acceso, o cierra sesión aquí — así que ya no
 * hace falta ningún refresco silencioso tipo One Tap (frágil sobre todo en Safari/iOS).
 */

import { APPS_SCRIPT_URL } from '../src/services/config';

export const CLIENT_ID = '698264876096-35bqu62bnsfb7v8tnph6m8p7pr7v56r9.apps.googleusercontent.com';
const DOMINIO = 'degasa.com';
const CLAVE_SESION = 'sesion';
// Identidad + Calendar en un solo consentimiento: pedir ambos scopes de una vez es justamente lo
// que evita el segundo "Conectar Google Calendar" más adelante.
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.events';

let alCambiarSesion = () => {};
let clienteCodigo = null;
let gsiListo = false;
let gsiPromesa = null;

export function initAuth({ onSesion } = {}) {
    alCambiarSesion = onSesion || (() => {});
    cargarGSI();
}

function cargarGSI() {
    if (gsiPromesa) return gsiPromesa;
    gsiPromesa = new Promise((resolve) => {
        if (window.google?.accounts?.oauth2) { gsiListo = true; return resolve(); }
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.defer = true;
        s.onload = () => { gsiListo = true; resolve(); };
        s.onerror = resolve; // sin red: la sesión cacheada sigue sirviendo para trabajar offline

        // Insertar el script puede lanzar de forma síncrona en entornos que bloquean scripts
        // externos. Se resuelve igual: la app tiene que arrancar sin GSI.
        try { document.head.appendChild(s); } catch { resolve(); }
    });
    return gsiPromesa;
}

function clienteCodigoDe() {
    if (!clienteCodigo) {
        clienteCodigo = google.accounts.oauth2.initCodeClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            ux_mode: 'popup',
            hd: DOMINIO,
            callback: () => {} // se reemplaza en cada llamada, ver abajo
        });
    }
    return clienteCodigo;
}

/**
 * Pinta el botón de entrada en el contenedor que le pases (la pantalla de login). Tiene que ser
 * un botón real y no `renderButton` de Google: `requestCode()` abre un popup, y sin un gesto del
 * usuario justo antes el navegador lo bloquea en silencio.
 */
export function pintarBotonEntrada(contenedor) {
    contenedor.textContent = '';
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-google-entrada';
    boton.textContent = 'Iniciar sesión con Google';

    cargarGSI().then(() => {
        if (!window.google?.accounts?.oauth2) {
            contenedor.textContent = 'Sin conexión. Conéctate para iniciar sesión.';
            return;
        }
        boton.disabled = false;
    });
    boton.disabled = true;

    boton.addEventListener('click', () => {
        if (!gsiListo) return;
        const cliente = clienteCodigoDe();
        cliente.callback = (resp) => {
            if (resp.error) {
                console.error('No se pudo iniciar sesión con Google:', resp.error);
                return;
            }
            canjearCodigo(resp.code);
        };
        cliente.requestCode();
    });

    contenedor.appendChild(boton);
}

async function canjearCodigo(code) {
    let datos;
    try {
        const resp = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'canjearCodigoGoogle', code })
        });
        datos = await resp.json();
    } catch (err) {
        console.error('No se pudo canjear el código de Google:', err);
        return;
    }

    if (datos.status === 'error') {
        console.error('Login rechazado:', datos.message);
        return;
    }

    const sesion = {
        nombre: datos.nombre || datos.correo || '',
        correo: (datos.correo || '').toLowerCase(),
        foto: datos.foto || '',
        sesion_token: datos.sesion_token,
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

/**
 * Sesión de la versión anterior (traía `id_token` en vez de `sesion_token`, sin refresh token
 * de Google detrás): se trata como sesión sin migrar. `resolverIdentidad` en Apps Script sigue
 * aceptando el `id_token` mientras dure —así nadie pierde trabajo a medio hacer—, pero como no
 * hay refresh token guardado para esa cuenta, Calendar le pedirá el consentimiento una última
 * vez la próxima vez que inicie sesión con el flujo nuevo.
 */
export function sesionSinMigrar() {
    const s = sesionActual();
    return !!(s && !s.sesion_token && s.id_token);
}

export function cerrarSesion() {
    const sesion = sesionActual();
    localStorage.removeItem(CLAVE_SESION);
    if (sesion?.sesion_token) {
        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'cerrarSesionGoogle', sesion_token: sesion.sesion_token })
        }).catch(() => { /* mejor esfuerzo: el logout local ya ocurrió */ });
    }
    alCambiarSesion(null);
}
