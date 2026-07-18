/**
 * Roles, permisos y alcance jerárquico.
 *
 * El permiso NUNCA se decide en el código. La app pregunta `puede('visitas', 'exportar')` y
 * la respuesta sale de la base de datos: un rol nuevo, o un permiso que cambia, no requiere
 * tocar un solo archivo de aquí.
 *
 * ── Por qué Supabase y no Sheets ─────────────────────────────────────────────────────
 *
 * Google Sheets sigue siendo la capa operativa y no se sustituye: ahí siguen escribiéndose
 * las visitas, las actividades y los catálogos, vía Apps Script, exactamente igual que antes.
 * Pero una hoja no sabe responder "¿qué puede ver ESTE usuario?" sin entregar la hoja
 * completa, y entregarla completa es justamente lo que hay que evitar. El control de acceso
 * necesita filtrar por fila del lado del servidor, y eso lo da Postgres, no una hoja.
 *
 * ── Sin conexión ─────────────────────────────────────────────────────────────────────
 *
 * El perfil se cachea. Si no hay red y tampoco caché, se cae a EDUCADOR: es el rol de menor
 * privilegio que todavía permite capturar. Un educador en un pasillo sin señal tiene que
 * poder registrar su visita; lo que no puede es ver la de alguien más, y con este default
 * tampoco podría.
 */

import { sesionActual } from './auth.js';

const SUPABASE_URL = 'https://fiplfsuhsqibzrpvjvbx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcGxmc3Voc3FpYnpycHZqdmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODAyNjgsImV4cCI6MjA4OTg1NjI2OH0.YG3Fk8XJ_n9PGIYUHtoiy-MJNuWqJTsFBwooKnt1X5s';

const CLAVE_CACHE = 'pdt_perfil_cache';

/** Lo que puede un educador. Es también el piso cuando no hay perfil que consultar. */
const PERMISOS_EDUCADOR = [
    'visitas.crear', 'visitas.consultar',
    'actividades.crear', 'actividades.consultar',
    'materiales.crear', 'materiales.consultar',
    'evidencias.subir', 'evidencias.consultar',
    'comentarios.crear', 'comentarios.leer', 'comentarios.responder',
    'dashboards.personal'
];

let perfil = null;

// ---------- caché ----------

function leerCache() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CACHE)) || null; }
    catch { return null; }
}

function guardarCache(p) {
    try { localStorage.setItem(CLAVE_CACHE, JSON.stringify(p)); }
    catch { /* cuota llena: el perfil se vuelve a pedir, no es crítico */ }
}

/**
 * Perfil mínimo para que la app funcione sin haber podido preguntar nunca.
 *
 * `invitado` queda en null —ni sí ni no— a propósito. Es la diferencia entre "no tienes
 * acceso" y "todavía no sé": la primera cierra la puerta, la segunda deja capturar y vuelve
 * a preguntar cuando haya señal. Negar por no saber dejaría fuera a un educador que abre la
 * app en un sótano sin cobertura.
 */
function perfilDeRespaldo(correo) {
    return {
        correo: correo || '',
        nombre: '',
        rol: 'educador',
        es_admin: false,
        invitado: null,
        invitacion_estado: 'desconocido',
        permisos: [...PERMISOS_EDUCADOR],
        alcance: correo ? [correo] : [],
        origen: 'respaldo'
    };
}

// ---------- carga ----------

/**
 * Deja listo el perfil desde la caché, sin red. Se llama al arrancar para que la primera
 * pintada ya sepa qué mostrar: esperar a la respuesta dejaría la barra parpadeando.
 */
export function initPermisos() {
    const sesion = sesionActual();
    const cache = leerCache();

    perfil = (cache && sesion && cache.correo === sesion.correo)
        ? { ...cache, origen: 'cache' }
        : perfilDeRespaldo(sesion?.correo);

    return perfil;
}

/**
 * Refresca el perfil contra Supabase. Nunca lanza: sin red se queda con lo que ya tenía.
 * Devuelve el perfil nuevo, o null si no se pudo consultar (para que quien llame sepa que
 * no hubo respuesta y no repinte de más).
 */
export async function actualizarPerfil() {
    const sesion = sesionActual();
    if (!sesion || !navigator.onLine) return null;

    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pdt_perfil`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_correo: sesion.correo })
        });
        if (!resp.ok) throw new Error(`Supabase respondió ${resp.status}`);

        const datos = await resp.json();
        if (!datos || typeof datos !== 'object') throw new Error('Perfil vacío');

        // Un correo que no está dado de alta no tiene rol. Se le deja el piso de educador:
        // dejarlo sin permisos lo bloquearía de capturar sus propias visitas, que es
        // precisamente lo que sí debe poder hacer.
        const nuevo = {
            correo: datos.correo || sesion.correo,
            nombre: datos.nombre || sesion.nombre || '',
            rol: datos.rol || 'educador',
            es_admin: datos.es_admin === true,
            permisos: Array.isArray(datos.permisos) && datos.permisos.length
                ? datos.permisos
                : [...PERMISOS_EDUCADOR],
            alcance: Array.isArray(datos.alcance) && datos.alcance.length
                ? datos.alcance
                : [sesion.correo],
            invitado: datos.invitado === true,
            invitacion_estado: datos.invitacion_estado || 'sin_invitacion',
            origen: 'supabase'
        };

        perfil = nuevo;
        guardarCache(nuevo);
        return nuevo;
    } catch (err) {
        console.error('No se pudo leer el perfil de permisos:', err);
        return null;
    }
}

export function perfilActual() {
    if (!perfil) initPermisos();
    return perfil;
}

export function olvidarPerfil() {
    perfil = null;
    try { localStorage.removeItem(CLAVE_CACHE); } catch { /* da igual */ }
}

// ---------- preguntas ----------

/**
 * ¿Puede el usuario hacer `accion` en `modulo`?
 *
 * La ausencia de permiso es la negación. No hay lista de denegados que pudiera contradecir
 * a la de permitidos: con dos listas, la pregunta "¿y si está en las dos?" no tiene una
 * respuesta obvia, y las respuestas no obvias en control de acceso terminan en fugas.
 */
export function puede(modulo, accion) {
    const p = perfilActual();
    if (!p) return false;
    if (p.es_admin) return true;               // el administrador no se enumera
    return p.permisos.includes(`${modulo}.${accion}`);
}

export function rolActual() { return perfilActual()?.rol || 'educador'; }

export function esAdministrador() { return perfilActual()?.es_admin === true; }

/**
 * Correos que este usuario puede ver: el suyo y los de quien tenga a cargo, a cualquier
 * profundidad. Lo resuelve Postgres con un recorrido recursivo, no el cliente: calcularlo
 * aquí exigiría bajarse el organigrama completo, que es justo lo que no debe salir.
 */
export function alcance() {
    return perfilActual()?.alcance || [];
}

export function enAlcance(correo) {
    if (!correo) return false;
    const objetivo = String(correo).trim().toLowerCase();
    return alcance().some(c => String(c).trim().toLowerCase() === objetivo);
}

// ---------- invitación ----------

/**
 * ¿Tiene invitación para entrar?
 *
 *   true   invitación vigente
 *   false  se preguntó y NO la tiene: se le cierra la puerta
 *   null   todavía no se ha podido preguntar (sin red, primer arranque)
 *
 * Los tres estados son distintos y se tratan distinto. Colapsar null en false convertiría
 * cada bache de señal en un bloqueo; colapsarlo en true haría el control decorativo.
 */
export function estadoInvitacion() {
    const p = perfilActual();
    if (!p) return null;
    return p.invitado === undefined ? null : p.invitado;
}

/** Solo se bloquea ante un NO explícito del servidor. */
export function accesoBloqueado() {
    return estadoInvitacion() === false;
}

export function detalleInvitacion() {
    return perfilActual()?.invitacion_estado || 'desconocido';
}

/** Marca la invitación como aceptada la primera vez que entra. Silencioso: es un trámite. */
export async function aceptarInvitacion() {
    const sesion = sesionActual();
    if (!sesion || !navigator.onLine) return;

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/pdt_aceptar_invitacion`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_correo: sesion.correo })
        });
    } catch (err) {
        console.error('No se pudo marcar la invitación como aceptada:', err);
    }
}

/** ¿Ve a alguien además de sí mismo? Decide si tiene sentido ofrecerle vistas de equipo. */
export function tieneEquipo() {
    const p = perfilActual();
    return !!p && p.alcance.length > 1;
}
