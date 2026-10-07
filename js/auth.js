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
import { clave } from './entorno.js';

export const CLIENT_ID = '698264876096-frdrrbq27f73e3ue5rngm9g6berj85rq.apps.googleusercontent.com';
const DOMINIO = 'degasa.com';
const CLAVE_SESION = clave('sesion');
// Identidad + Calendar en un solo consentimiento: pedir ambos scopes de una vez es justamente lo
// que evita el segundo "Conectar Google Calendar" más adelante.
const SCOPES = 'openid email profile https://www.googleapis.com/auth/calendar.events';

let alCambiarSesion = () => {};
let alErrorDePopup = () => {};
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
            callback: () => {}, // se reemplaza en cada llamada, ver abajo
            // Popup cerrado a mano o bloqueado: sin esto el botón se quedaba deshabilitado
            // para siempre, porque el `callback` nunca se invoca en esos casos.
            error_callback: (err) => alErrorDePopup(err)
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

    // Logo oficial de Google + texto en su propio nodo: el texto cambia con cada paso ("Preparando…",
    // "Conectando…") y, si se reescribiera el botón entero, el logo se perdería.
    const logo = document.createElement('span');
    logo.className = 'btn-google-logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18">'
        + '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/>'
        + '<path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/>'
        + '<path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1z"/>'
        + '<path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
    const textoBoton = document.createElement('span');
    textoBoton.className = 'btn-google-txt';
    boton.append(logo, textoBoton);
    const ponerTexto = (t) => { textoBoton.textContent = t; };
    ponerTexto('Continuar con Google');

    const mensajeError = document.createElement('p');
    mensajeError.className = 'btn-google-entrada-error';
    mensajeError.setAttribute('role', 'alert');
    mensajeError.hidden = true;

    // Qué está pasando ahora mismo. Sin esto, el canje (que puede tardar varios segundos por el
    // arranque en frío del servidor) se veía como un botón congelado.
    const paso = document.createElement('p');
    paso.className = 'gate-paso';
    paso.setAttribute('role', 'status');
    paso.setAttribute('aria-live', 'polite');
    paso.hidden = true;

    function mostrarPaso(texto) {
        paso.textContent = texto;
        paso.hidden = !texto;
    }

    cargarGSI().then(() => {
        if (!window.google?.accounts?.oauth2) {
            contenedor.textContent = 'Sin conexión. Conéctate para iniciar sesión.';
            return;
        }
        boton.disabled = false;
        ponerTexto('Continuar con Google');
    });
    boton.disabled = true;
    ponerTexto('Preparando…');

    boton.addEventListener('click', () => {
        if (!gsiListo || boton.disabled) return;
        // Se bloquea YA, no cuando vuelve el popup: dos clics abrían dos popups.
        boton.disabled = true;
        mensajeError.hidden = true;
        mostrarPaso('Abriendo Google…');

        const cliente = clienteCodigoDe();
        alErrorDePopup = (err) => {
            console.error('Popup de Google:', err);
            mostrarPaso('');
            boton.disabled = false;
            ponerTexto('Continuar con Google');
            if (err?.type === 'popup_failed_to_open') {
                mostrarError('El navegador bloqueó la ventana de Google.');
            }
        };
        cliente.callback = async (resp) => {
            if (resp.error) {
                console.error('No se pudo iniciar sesión con Google:', resp.error);
                mostrarPaso('');
                boton.disabled = false;
                // Cerrar el popup a propósito no es un error que merezca un cartel.
                if (resp.error !== 'popup_closed' && resp.error !== 'access_denied') {
                    mostrarError('No se pudo iniciar sesión con Google.');
                }
                return;
            }
            ponerTexto('Conectando…');
            mostrarPaso('Verificando tu cuenta…');

            let sesion = null;
            try {
                sesion = await canjearCodigo(resp.code, mostrarPaso);
            } catch (err) {
                mostrarError(mensajeAmigable(err));
            }

            if (sesion) {
                mostrarPaso('Cargando tu agenda…');
                try {
                    alCambiarSesion(sesion);
                } catch (err) {
                    // La sesión YA está guardada: un fallo al pintar la app no es un fallo de
                    // login y no debe volver a canjear nada.
                    console.error('La sesión se guardó pero la app no pudo arrancar:', err);
                    mostrarError('Entraste, pero la app no pudo cargar. Recarga la página.');
                }
                return;
            }

            mostrarPaso('');
            boton.disabled = false;
            ponerTexto('Continuar con Google');
        };

        // `requestCode` puede lanzar de forma síncrona (popup bloqueado): no dejar el botón muerto.
        try {
            cliente.requestCode();
        } catch (err) {
            console.error('No se pudo abrir el popup de Google:', err);
            mostrarPaso('');
            boton.disabled = false;
            mostrarError('El navegador bloqueó la ventana de Google.');
        }
    });

    function mostrarError(texto) {
        mensajeError.textContent = texto + ' Inténtalo de nuevo.';
        mensajeError.hidden = false;
    }

    contenedor.appendChild(boton);
    contenedor.appendChild(paso);
    contenedor.appendChild(mensajeError);
}

function mensajeAmigable(err) {
    if (err?.tipo === 'respuesta_no_json') {
        // Típico de un arranque en frío del despliegue de Apps Script: la petición llega,
        // pero Google todavía no la enrutó al script y devuelve una página en vez de JSON.
        return 'El servidor tardó en responder (posible arranque en frío).';
    }
    if (err?.tipo === 'tiempo') {
        return 'El servidor tardó demasiado en responder.';
    }
    if (err?.tipo === 'codigo_gastado') {
        // El primer intento pudo haber llegado y gastado el código de un solo uso: no es un
        // rechazo "de verdad", solo hay que pedir uno nuevo.
        return 'La conexión se interrumpió a medias.';
    }
    if (err?.tipo === 'rechazado') {
        return err.message || 'Google rechazó el inicio de sesión.';
    }
    return 'No se pudo conectar con el servidor de inicio de sesión.';
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const ESPERAS_REINTENTO_MS = [800, 2000];
const TIEMPO_CANJE_MS = 30000;

/**
 * Un solo fallo (red lenta, arranque en frío del despliegue de Apps Script) no debería mandar
 * a la persona de vuelta al botón: se reintenta un par de veces con una espera corta.
 *
 * El `code` de Google es de UN SOLO USO. Si un intento falló sin respuesta, pudo haber llegado
 * igual y gastarlo; el servidor responde de la caché al mismo code (ver `canjearCodigoGoogle`),
 * pero si aún no está desplegado, el reintento recibe `invalid_grant`. En ese caso no se le
 * enseña a la persona un "Bad Request": se le pide pulsar de nuevo (código nuevo).
 *
 * Devuelve la sesión SIN avisar a la app: quien llama lo hace fuera de este ciclo. Si
 * `alCambiarSesion` fallaba aquí dentro, contaba como fallo de red y se canjeaba el mismo
 * código otra vez.
 */
async function canjearCodigo(code, alPaso = () => {}) {
    let ultimoError;
    let huboIntentoSinRespuesta = false;

    for (let intento = 0; intento <= ESPERAS_REINTENTO_MS.length; intento++) {
        if (intento > 0) {
            alPaso('Reintentando conexión…');
            await esperar(ESPERAS_REINTENTO_MS[intento - 1]);
        }
        try {
            return await intentarCanjearCodigo(code);
        } catch (err) {
            ultimoError = err;
            console.error(`No se pudo canjear el código de Google (intento ${intento + 1}):`, err);

            if (err?.tipo === 'rechazado') {
                if (huboIntentoSinRespuesta) {
                    throw Object.assign(new Error('Código ya usado'), { tipo: 'codigo_gastado' });
                }
                throw err;
            }
            huboIntentoSinRespuesta = true;
        }
    }
    throw ultimoError;
}

async function intentarCanjearCodigo(code) {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIEMPO_CANJE_MS);

    let resp;
    try {
        resp = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'canjearCodigoGoogle', code }),
            signal: control.signal
        });

        const tipoContenido = resp.headers.get('content-type') || '';
        if (!tipoContenido.includes('application/json')) {
            throw Object.assign(new Error('Respuesta no es JSON'), { tipo: 'respuesta_no_json' });
        }

        let datos;
        try {
            datos = await resp.json();
        } catch (err) {
            throw Object.assign(new Error('Respuesta no es JSON válido'), { tipo: 'respuesta_no_json', cause: err });
        }

        if (datos.status === 'error') {
            console.error('Login rechazado:', datos.message);
            throw Object.assign(new Error(datos.message), { tipo: 'rechazado', message: datos.message });
        }

        const sesion = {
            nombre: datos.nombre || datos.correo || '',
            correo: (datos.correo || '').toLowerCase(),
            foto: datos.foto || '',
            sesion_token: datos.sesion_token,
            obtenido: Date.now()
        };
        localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));

        // El canje ya trae un access_token de Calendar: se entrega tal cual en vez de que la
        // app tenga que pedir otro (otra ida a Apps Script) nada más entrar.
        if (datos.access_token) {
            window.dispatchEvent(new CustomEvent('pdt:calendar-token', {
                detail: { access_token: datos.access_token, expira_en: datos.expira_en }
            }));
        }
        return sesion;
    } catch (err) {
        if (err?.name === 'AbortError') {
            throw Object.assign(new Error('Tiempo agotado'), { tipo: 'tiempo' });
        }
        throw err;
    } finally {
        clearTimeout(reloj);
    }
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
