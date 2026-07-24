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

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
const MARCA_ORIGEN = 'pdt-visita';
// Recordatorio de "ya di el consentimiento antes" — no es el token (ese nunca sobrevive un
// recargo), solo la señal para intentar renovarlo solo la próxima vez sin pedir clic.
const CLAVE_RECORDATORIO = 'pdt_calendar_conectado';

let clienteToken = null;
let tokenActual = null;   // { access_token, expira_en_ms }

function tokenVigente() {
    return tokenActual && Date.now() < tokenActual.expira_en_ms;
}

export function tieneAccesoCalendar() {
    return tokenVigente();
}

function recordarConexion() {
    try { localStorage.setItem(CLAVE_RECORDATORIO, '1'); } catch { /* modo privado, etc. */ }
}

function seConectoAntes() {
    try { return localStorage.getItem(CLAVE_RECORDATORIO) === '1'; } catch { return false; }
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
 * Pide (o renueva) el token de acceso. La primera vez abre el consentimiento de Google; con
 * el consentimiento ya dado, los intentos siguientes suelen resolverse sin interacción.
 */
export function conectarCalendar(clientId) {
    return new Promise((resolve, reject) => {
        if (!window.google?.accounts?.oauth2) {
            reject(new Error('Google Identity Services no cargó. Conéctate a internet e intenta de nuevo.'));
            return;
        }

        const cliente = clienteTokenDe(clientId);
        cliente.callback = (resp) => {
            if (resp.error) {
                reject(new Error(resp.error_description || resp.error));
                return;
            }
            tokenActual = {
                access_token: resp.access_token,
                // Se resta un margen: pedir un token "a punto de vencer" y usarlo en la
                // siguiente llamada es peor que renovarlo un poco antes.
                expira_en_ms: Date.now() + (Number(resp.expires_in || 0) - 60) * 1000
            };
            recordarConexion();
            resolve(true);
        };

        cliente.requestAccessToken({ prompt: tokenActual ? '' : 'consent' });
    });
}

/**
 * Reconexión de fondo al abrir la app: si ya se había conectado en una sesión anterior
 * (recordado en `localStorage`), intenta renovar el token SIN mostrar el consentimiento.
 *
 * Nunca rechaza ni interrumpe: sin sesión activa de Google, sin el permiso ya otorgado, o si
 * el navegador bloquea el intento por no venir de un clic, simplemente resuelve `false` y la
 * app se queda como si no se hubiera intentado — el botón de conectar sigue ahí para ese caso.
 */
export function intentarReconexionCalendar(clientId) {
    if (tokenVigente()) return Promise.resolve(true);
    if (!seConectoAntes() || !window.google?.accounts?.oauth2) return Promise.resolve(false);

    return new Promise((resolve) => {
        const cliente = clienteTokenDe(clientId);
        cliente.callback = (resp) => {
            if (resp.error) { resolve(false); return; }
            tokenActual = {
                access_token: resp.access_token,
                expira_en_ms: Date.now() + (Number(resp.expires_in || 0) - 60) * 1000
            };
            recordarConexion();
            resolve(true);
        };
        try {
            cliente.requestAccessToken({ prompt: '' });
        } catch {
            resolve(false);
        }
    });
}

function encabezados() {
    if (!tokenVigente()) throw new Error('Sin acceso a Google Calendar. Conéctalo primero.');
    return {
        Authorization: `Bearer ${tokenActual.access_token}`,
        'Content-Type': 'application/json'
    };
}

/** Cuerpo del evento a partir de la visita. Un solo lugar que sabe traducir uno al otro. */
function eventoDeVisita(visita) {
    const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
        summary: `${visita.cliente || 'Visita'} · ${visita.hospital || ''}`.trim(),
        location: visita.hospital || '',
        description: `Plan de Trabajo · ${visita.educador || ''}\nSector(es): `
            + (visita.sectores || []).map(s => s.nombre).join(', '),
        start: { dateTime: `${visita.dia}T${visita.hora_inicio || '09:00'}:00`, timeZone: zona },
        end: { dateTime: `${visita.dia}T${visita.hora_fin || '10:00'}:00`, timeZone: zona },
        extendedProperties: { private: { origen: MARCA_ORIGEN, id_visita: visita.id } }
    };
}

/**
 * Crea o actualiza el evento de la visita. Devuelve el id del evento (guárdalo en
 * `visita.calendar_event_id` para poder actualizarlo/borrarlo después).
 *
 * Silenciosa por diseño: si Calendar no responde, la visita ya se guardó en Sheets, que es lo
 * que de verdad importa. El espejo de Calendar es un extra, igual que el de Supabase.
 */
export async function sincronizarEventoVisita(visita) {
    if (!visita.dia || !visita.hora_inicio || !visita.hora_fin) return null;

    const cuerpo = JSON.stringify(eventoDeVisita(visita));
    const existente = visita.calendar_event_id;

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
 */
export async function listarCompromisos(desdeISO, hastaISO) {
    const parametros = new URLSearchParams({
        timeMin: desdeISO, timeMax: hastaISO,
        singleEvents: 'true', orderBy: 'startTime', maxResults: '50'
    });

    const resp = await fetch(`${CALENDAR_API}?${parametros}`, { headers: encabezados() });
    if (!resp.ok) throw new Error(`Calendar respondió ${resp.status} al leer eventos`);

    const datos = await resp.json();
    return (datos.items || [])
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
