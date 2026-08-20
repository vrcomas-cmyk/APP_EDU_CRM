/**
 * Google Calendar, de ida y vuelta.
 *
 * ── Por qué esto NO pasa por Apps Script (la LECTURA/escritura de eventos) ───────────
 *
 * `apps-script/Codigo.gs` corre siempre como la identidad que lo publicó ("ejecutar como: yo"):
 * es lo que permite que la PWA entre sin que cada educador tenga permiso de edición sobre la
 * hoja. Pero eso significa que `CalendarApp` desde Apps Script SIEMPRE tocaría el calendario
 * del dueño del script, nunca el de quien está agendando. Para que cada educador vea SUS
 * juntas y las demás personas vean SU disponibilidad, el token tiene que ser el suyo — así
 * que este módulo llama a la API de Calendar directo desde el navegador con un access_token
 * propio.
 *
 * ── De dónde SÍ sale ahora ese access_token ───────────────────────────────────────────
 *
 * El consentimiento (identidad + Calendar) se pide UNA vez, en el login (`js/auth.js`,
 * `initCodeClient`). El `code` de esa única pantalla se canjea en el servidor por un
 * access_token y, la primera vez, un REFRESH TOKEN que se guarda en Supabase por CUENTA
 * (`pdt_google_credenciales`, nunca por dispositivo). A partir de ahí, este módulo solo le pide
 * a Apps Script (`calendarToken`, ver `Codigo.gs`) que le canjee ese refresh token por un
 * access_token fresco — nunca vuelve a mostrarse una pantalla de Google. Por eso ya no hace
 * falta ningún flujo `initTokenClient`/`prompt` aquí.
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
import { APPS_SCRIPT_URL } from '../src/services/config';
import { sesionActual } from './auth.js';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const MARCA_ORIGEN = 'pdt-visita';

let tokenActual = null;   // { access_token, expira_en_ms }
// Deduplica reconexiones silenciosas en vuelo: `sincronizarCalendar` (cada 5 min) y el hook
// de React (al montar/al notar el token vencido) pueden pedirla casi al mismo tiempo: sin
// esto, cada quien dispara su propia llamada al servidor.
let intentoSilenciosoEnVuelo = null;
// Renovación proactiva: dispara unos minutos ANTES de que el token expire, para que ninguna
// etapa de sync se tope nunca con uno ya vencido. Se reprograma en cada token nuevo.
let relojRenovacion = null;

/**
 * Se dispara cuando el servidor responde `code: 'reautenticar'` (refresh token revocado o
 * inválido — contraseña de Google cambiada, acceso quitado a mano, etc.): es el único caso en
 * el que hace falta volver a pedir el permiso. La UI se suscribe para mostrar el aviso.
 */
let alNecesitarReautenticacion = () => {};
export function alReautenticar(fn) {
    alNecesitarReautenticacion = fn || (() => {});
}

function tokenVigente() {
    return tokenActual && Date.now() < tokenActual.expira_en_ms;
}

export function tieneAccesoCalendar() {
    return tokenVigente();
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
    if (!tokenActual) return;
    const margenMs = 5 * 60000;
    const espera = Math.max(0, tokenActual.expira_en_ms - Date.now() - margenMs);
    relojRenovacion = setTimeout(() => { intentarReconexionCalendar(); }, espera);
}

function aplicarToken(resp) {
    tokenActual = {
        access_token: resp.access_token,
        // Se resta un margen: pedir un token "a punto de vencer" y usarlo en la
        // siguiente llamada es peor que renovarlo un poco antes.
        expira_en_ms: Date.now() + (Number(resp.expira_en || 0) - 60) * 1000
    };
    programarRenovacionProactiva();
}

/**
 * Pide (o renueva) el access_token de Calendar contra el servidor. Ya no hay pantalla de
 * consentimiento que mostrar aquí: el refresh token vive en Supabase desde el login. Los
 * parámetros `clientId`/`correo` se conservan por compatibilidad con quien ya los pasaba
 * (`Calendario.tsx`, `MiDia.tsx`, `useConexionCalendar.ts`) pero ya no se usan.
 */
export function conectarCalendar() {
    return intentarReconexionCalendar();
}

/**
 * Igual que `conectarCalendar`: sin refresh token propio del navegador, "conectar" y
 * "reconectar" son la misma operación — pedirle a Apps Script un access_token fresco.
 *
 * Nunca rechaza salvo que el servidor confirme que hace falta reautenticarse: en ese caso
 * avisa vía `alReautenticar` y de todos modos resuelve `false`, para que la UI decida qué
 * mostrar en vez de que una promesa rota tumbe el flujo que la llamó.
 */
export function intentarReconexionCalendar() {
    if (tokenVigente()) return Promise.resolve(true);
    if (intentoSilenciosoEnVuelo) return intentoSilenciosoEnVuelo;

    // Fetch directo, sin pasar por `postear`: esa capa bloquea cualquier acción que no empiece
    // con "leer" mientras alguien está en modo "ver como" (`simulacionActiva`), y pedir un
    // access_token de Calendar no es una escritura de datos — bloquearlo ahí apagaría
    // Calendario/Mi día para quien esté simulando otro rol, que sigue siendo de solo lectura.
    intentoSilenciosoEnVuelo = fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'calendarToken', sesion_token: sesionActual()?.sesion_token })
    })
        .then((resp) => resp.json())
        .then((datos) => {
            if (datos.status === 'error') {
                if (datos.code === 'reautenticar') alNecesitarReautenticacion();
                return false;
            }
            aplicarToken(datos);
            return true;
        })
        .catch(() => false)
        .finally(() => { intentoSilenciosoEnVuelo = null; });

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
