/**
 * Google Calendar, de ida y vuelta.
 *
 * ── Por qué esto NO pasa por Apps Script ─────────────────────────────────────────────
 *
 * `apps-script/Codigo.gs` corre siempre como la identidad que lo publicó ("ejecutar como: yo"):
 * es lo que permite que la PWA entre sin que cada educador tenga permiso de edición sobre la
 * hoja. Pero eso significa que `CalendarApp` desde Apps Script SIEMPRE tocaría el calendario
 * del dueño del script, nunca el de quien está agendando. Para que cada educador vea SUS
 * juntas y las demás personas vean SU disponibilidad, el token tiene que ser el suyo — así
 * que este módulo pide un token de acceso a Calendar directo en el navegador (OAuth2 vía
 * Google Identity Services) y llama a la API de Calendar sin pasar por el backend.
 *
 * ── Qué hace falta en Google Cloud Console (fuera del alcance de este código) ────────
 *
 * 1. Habilitar la "Google Calendar API" en el mismo proyecto del Client ID de `auth.js`.
 * 2. En la pantalla de consentimiento OAuth, agregar el scope
 *    `https://www.googleapis.com/auth/calendar.events` (solo eventos, no configuración del
 *    calendario). Con el tipo de usuario "Interno" (Workspace, dominio degasa.com) no hace
 *    falta verificación de Google para un scope restringido.
 *
 * ── Qué se marca como "nuestro" ───────────────────────────────────────────────────────
 *
 * Cada evento que esta app crea lleva `extendedProperties.private.origen = 'pdt-visita'` y el
 * id de la visita. Al leer el calendario para mostrar "tus compromisos", esos se excluyen: ya
 * se ven como visita en la propia app, mostrarlos dos veces confundiría más de lo que ayuda.
 */

import { etiquetaVisita, esVisitaCliente } from './estado.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
const MARCA_ORIGEN = 'pdt-visita';
// Recordatorio de "ya di el consentimiento antes" — no es el token (ese nunca sobrevive un
// recargo), solo la señal para intentar renovarlo solo la próxima vez sin pedir clic. Se
// guarda el SCOPE mismo (no un booleano): si algún día este módulo pide un scope adicional,
// el valor guardado deja de coincidir con `SCOPE_CALENDAR` y el consentimiento vuelve a
// aparecer una vez, solo para ese cambio — en vez de tener que inventar una versión a mano.
//
// La clave lleva el CORREO: el consentimiento de Calendar es por cuenta de Google, no por
// dispositivo. Antes se guardaba una sola clave global y `cerrarSesion` la borraba entera para
// que la siguiente cuenta en el mismo dispositivo viera su propio consentimiento — pero eso
// también obligaba a la MISMA persona a volver a aceptar cada vez que cerraba sesión. Con la
// clave por correo ninguna de las dos cosas hace falta: cada cuenta trae su propio recuerdo.
const PREFIJO_RECORDATORIO = 'pdt_calendar_conectado:';
const PREFIJO_POSPUESTO = 'pdt_calendar_pospuesto:';

let clienteToken = null;
let tokenActual = null;   // { access_token, expira_en_ms }
// Deduplica reconexiones silenciosas en vuelo: `sincronizarCalendar` (cada 5 min) y el hook
// de React (al montar/al notar el token vencido) pueden pedirla casi al mismo tiempo: sin
// esto, cada quien dispara su propia llamada al SDK de Google.
let intentoSilenciosoEnVuelo = null;
// Renovación proactiva: dispara unos minutos ANTES de que el token expire, para que ninguna
// etapa de sync se tope nunca con uno ya vencido. Se reprograma en cada token nuevo.
let relojRenovacion = null;
let correoActual = null;
let clientIdActual = null;

function tokenVigente() {
    return tokenActual && Date.now() < tokenActual.expira_en_ms;
}

export function tieneAccesoCalendar() {
    return tokenVigente();
}

function claveRecordatorio(correo) {
    return `${PREFIJO_RECORDATORIO}${String(correo || '').trim().toLowerCase()}`;
}

function clavePospuesto(correo) {
    return `${PREFIJO_POSPUESTO}${String(correo || '').trim().toLowerCase()}`;
}

function recordarConexion(correo) {
    try { localStorage.setItem(claveRecordatorio(correo), SCOPE_CALENDAR); } catch { /* modo privado, etc. */ }
    try { localStorage.removeItem(clavePospuesto(correo)); } catch { /* modo privado, etc. */ }
}

function seConectoAntes(correo) {
    try { return localStorage.getItem(claveRecordatorio(correo)) === SCOPE_CALENDAR; } catch { return false; }
}

/** "Ahora no" en el modal de login: no repreguntar en esta MISMA sesión de nuevo. */
export function posponerConsentimientoCalendar(correo) {
    try { localStorage.setItem(clavePospuesto(correo), String(Date.now())); } catch { /* modo privado, etc. */ }
}

function seAplazoAntes(correo) {
    try { return !!localStorage.getItem(clavePospuesto(correo)); } catch { return false; }
}

/** Para el login: ¿hace falta mostrar el consentimiento, o ya se dio (o aplazó) para este correo? */
export function calendarNecesitaConsentimiento(correo) {
    return !tokenVigente() && !seConectoAntes(correo) && !seAplazoAntes(correo);
}

/**
 * Ya no se llama al cerrar sesión (ver `js/auth.js`): el consentimiento es por cuenta, así que
 * borrarlo en el logout solo forzaba a la MISMA persona a volver a aceptar la próxima vez.
 * Sigue existiendo para "Usar otra cuenta" / depuración manual.
 */
export function olvidarConsentimientoCalendar(correo) {
    tokenActual = null;
    detenerRenovacionProactiva();
    if (correo) {
        try { localStorage.removeItem(claveRecordatorio(correo)); } catch { /* modo privado, etc. */ }
        try { localStorage.removeItem(clavePospuesto(correo)); } catch { /* modo privado, etc. */ }
    }
}

function detenerRenovacionProactiva() {
    clearTimeout(relojRenovacion);
    relojRenovacion = null;
}

/**
 * Programa una renovación silenciosa ~5 min antes de que el token expire. Con esto ninguna
 * etapa de `sincronizarTodo` (cada 60s-5min, ver `js/app.js`) debería encontrarse nunca con un
 * token ya vencido — hoy solo se renovaba de forma reactiva, al notar que ya había expirado.
 */
function programarRenovacionProactiva() {
    detenerRenovacionProactiva();
    if (!tokenActual || !correoActual || !clientIdActual) return;
    const margenMs = 5 * 60000;
    const espera = Math.max(0, tokenActual.expira_en_ms - Date.now() - margenMs);
    relojRenovacion = setTimeout(() => {
        intentarReconexionCalendar(clientIdActual, correoActual);
    }, espera);
}

function clienteTokenDe(clientId) {
    if (!clienteToken) {
        clienteToken = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: SCOPE_CALENDAR,
            callback: () => {} // se reemplaza en cada llamada, ver abajo
        });
    }
    return clienteToken;
}

/**
 * Pide (o renueva) el token de acceso. Intenta SIEMPRE primero sin interacción
 * (`prompt: ''`): si el consentimiento ya se dio en una sesión anterior de Google —aunque este
 * dispositivo lo haya olvidado, p. ej. tras borrar datos— suele resolver solo. Solo cae a
 * `prompt: 'consent'` cuando ese intento en verdad falla, así la pantalla de permiso aparece
 * como mucho una vez por cuenta en vez de en cada carga de página.
 */
export function conectarCalendar(clientId, correo) {
    correoActual = correo || correoActual;
    clientIdActual = clientId;

    return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
            reject(new Error('Google Identity Services no cargó. Conéctate a internet e intenta de nuevo.'));
            return;
        }

        const cliente = clienteTokenDe(clientId);
        const conConsentimiento = () => new Promise((res, rej) => {
            cliente.callback = (resp) => {
                if (resp.error) { rej(new Error(resp.error_description || resp.error)); return; }
                aplicarToken(resp);
                res(true);
            };
            cliente.requestAccessToken({ prompt: 'consent' });
        });

        cliente.callback = (resp) => {
            if (resp.error) {
                // Sin permiso previo (o revocado): recién aquí se muestra la pantalla real.
                conConsentimiento().then(resolve, reject);
                return;
            }
            aplicarToken(resp);
            resolve(true);
        };
        cliente.requestAccessToken({ prompt: '' });
    });
}

function aplicarToken(resp) {
    tokenActual = {
        access_token: resp.access_token,
        // Se resta un margen: pedir un token "a punto de vencer" y usarlo en la
        // siguiente llamada es peor que renovarlo un poco antes.
        expira_en_ms: Date.now() + (Number(resp.expires_in || 0) - 60) * 1000
    };
    recordarConexion(correoActual);
    programarRenovacionProactiva();
}

/**
 * Reconexión de fondo al abrir la app: si ya se había conectado en una sesión anterior
 * (recordado en `localStorage`), intenta renovar el token SIN mostrar el consentimiento.
 *
 * Nunca rechaza ni interrumpe: sin sesión activa de Google, sin el permiso ya otorgado, o si
 * el navegador bloquea el intento por no venir de un clic, simplemente resuelve `false` y la
 * app se queda como si no se hubiera intentado — el botón de conectar sigue ahí para ese caso.
 */
export function intentarReconexionCalendar(clientId, correo) {
    if (correo) correoActual = correo;
    if (tokenVigente()) return Promise.resolve(true);
    if (!seConectoAntes(correoActual) || !window.google?.accounts?.oauth2) return Promise.resolve(false);
    if (intentoSilenciosoEnVuelo) return intentoSilenciosoEnVuelo;

    clientIdActual = clientId;
    intentoSilenciosoEnVuelo = new Promise((resolve) => {
        const cliente = clienteTokenDe(clientId);
        cliente.callback = (resp) => {
            if (resp.error) { resolve(false); return; }
            aplicarToken(resp);
            resolve(true);
        };
        try {
            cliente.requestAccessToken({ prompt: '' });
        } catch {
            resolve(false);
        }
    }).finally(() => { intentoSilenciosoEnVuelo = null; });

    return intentoSilenciosoEnVuelo;
}

function encabezados() {
    if (!tokenVigente()) throw new Error('Sin acceso a Google Calendar. Conéctalo primero.');
    return {
        Authorization: `Bearer ${tokenActual.access_token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Cuerpo del evento a partir de la visita. Un solo lugar que sabe traducir uno al otro.
 *
 * El título sale de `etiquetaVisita` —la misma regla que nombra la visita en el calendario
 * propio y en los tooltips— en vez de armar "cliente · hospital" a mano: antes, sin hospital
 * quedaba "CLIENTE ·" (el `.trim()` no quita el separador) y una visita administrativa o un
 * evento salía literalmente "Visita ·".
 */
export function eventoDeVisita(visita) {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hospital = esVisitaCliente(visita) ? (visita.hospital || '') : '';
    const sectores = (visita.sectores || []).map(s => s.nombre).join(', ');
    return {
        summary: [etiquetaVisita(visita), hospital].filter(Boolean).join(' · '),
        location: hospital,
        description: `Plan de Trabajo · ${visita.educador || ''}`
            + (sectores ? `\nSector(es): ${sectores}` : ''),
        start: { dateTime: `${visita.dia}T${visita.hora_inicio || '09:00'}:00`, timeZone: zona },
        end: { dateTime: `${visita.dia}T${visita.hora_fin || '10:00'}:00`, timeZone: zona },
        extendedProperties: { private: { origen: MARCA_ORIGEN, id_visita: visita.id } }
    };
}

/**
 * Busca, en el propio Calendar, un evento que YA lleve la marca de esta visita
 * (`extendedProperties.private.id_visita`). Calendar es el índice: cada evento nuestro se
 * marca al crearse (`eventoDeVisita`), así que esta búsqueda encuentra el evento aunque este
 * dispositivo nunca haya conocido su id —el caso típico de "otro dispositivo lo creó y el
 * espejo no traía `calendar_event_id` todavía"—. Sin esto, un segundo dispositivo terminaba
 * creando un evento duplicado en vez de reconocer el que ya existía.
 */
export async function buscarEventoDeVisita(idVisita) {
    const parametros = new URLSearchParams({
        privateExtendedProperty: `id_visita=${idVisita}`,
        showDeleted: 'false',
        maxResults: '1'
    });
    const resp = await fetch(`${CALENDAR_API}?${parametros}`, { headers: encabezados() });
    if (!resp.ok) throw new Error(`Calendar respondió ${resp.status} al buscar el evento`);
    const datos = await resp.json();
    return datos.items?.[0]?.id || null;
}

/**
 * Crea o actualiza el evento de la visita. Devuelve el id del evento (guárdalo en
 * `visita.calendar_event_id` para poder actualizarlo/borrarlo después), o `null` si la visita
 * no trae hora todavía (no es un error: no hay nada que agendar aún).
 *
 * Silenciosa por diseño frente a Sheets: si Calendar no responde, la visita ya se guardó ahí,
 * que es lo que de verdad importa. El espejo de Calendar es un extra, igual que el de Supabase
 * —pero a diferencia de antes, el llamador SÍ se entera cuando falla (ver `calendarSync.ts`),
 * en vez de que el intento desaparezca sin dejar rastro.
 */
export async function sincronizarEventoVisita(visita) {
    if (!visita.dia || !visita.hora_inicio || !visita.hora_fin) return null;

    // Sin id local: puede que otro dispositivo ya haya creado el evento y el espejo aún no nos
    // lo haya devuelto (o el backend todavía no tenga la columna desplegada). Buscar antes de
    // crear es lo que evita el duplicado.
    let existente = visita.calendar_event_id;
    if (!existente) existente = await buscarEventoDeVisita(visita.id);

    const cuerpo = JSON.stringify(eventoDeVisita(visita));
    const resp = await fetch(
        existente ? `${CALENDAR_API}/${existente}` : CALENDAR_API,
        { method: existente ? 'PATCH' : 'POST', headers: encabezados(), body: cuerpo }
    );

    // Si el evento ya no existe del lado de Calendar (lo borraron a mano), se recrea en vez
    // de fallar para siempre.
    if (!resp.ok && existente && resp.status === 404) {
        return sincronizarEventoVisita({ ...visita, calendar_event_id: null });
    }
    if (!resp.ok) throw new Error(`Calendar respondió ${resp.status} al guardar el evento`);

    const datos = await resp.json();
    return datos.id;
}

/** Borra el evento de una visita cancelada. Que ya no exista del otro lado no es un error. */
export async function borrarEventoVisita(idEvento) {
    if (!idEvento) return;
    const resp = await fetch(`${CALENDAR_API}/${idEvento}`, { method: 'DELETE', headers: encabezados() });
    if (!resp.ok && resp.status !== 404 && resp.status !== 410) {
        throw new Error(`Calendar respondió ${resp.status} al borrar el evento`);
    }
}

/**
 * Eventos del calendario propio en un rango, SIN los que esta app ya puso ahí (esos ya se ven
 * como visita). Sirve para "¿qué más tengo agendado?" al revisar el día.
 *
 * Pagina con `nextPageToken` en vez de fiarse de un solo `maxResults`: un mes con agenda
 * cargada (varias juntas diarias) fácilmente pasa de 50 eventos, y el tope duro los recortaba
 * en silencio —desaparecían del calendario sin ningún aviso—. `maxResults: 250` es el techo que
 * usa la propia API por página; con la paginación, el límite real deja de existir.
 */
export async function listarCompromisos(desdeISO, hastaISO) {
    const items = [];
    let pageToken;

    do {
        const parametros = new URLSearchParams({
            timeMin: desdeISO, timeMax: hastaISO,
            singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
        });
        if (pageToken) parametros.set('pageToken', pageToken);

        const resp = await fetch(`${CALENDAR_API}?${parametros}`, { headers: encabezados() });
        if (!resp.ok) throw new Error(`Calendar respondió ${resp.status} al leer eventos`);

        const datos = await resp.json();
        items.push(...(datos.items || []));
        pageToken = datos.nextPageToken || null;
    } while (pageToken);

    return items
        .filter(ev => ev.extendedProperties?.private?.origen !== MARCA_ORIGEN)
        .map(ev => ({
            id: ev.id,
            titulo: ev.summary || '(Sin título)',
            inicio: ev.start?.dateTime || ev.start?.date || '',
            fin: ev.end?.dateTime || ev.end?.date || '',
            todoElDia: !ev.start?.dateTime,
            url: ev.htmlLink || '',
            descripcion: ev.description || '',
            ubicacion: ev.location || '',
            invitados: (ev.attendees || []).map(a => a.displayName || a.email).filter(Boolean)
        }));
}
