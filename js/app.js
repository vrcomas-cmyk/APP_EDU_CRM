/**
 * Arranque y coordinación.
 *
 * No hay router de vistas: el calendario ES la pantalla. Todo lo demás (agendar, ejecutar)
 * ocurre en un drawer encima, para no tapar el contexto que da sentido a lo que estás
 * haciendo — al agendar, la pregunta real es "¿dónde cabe esto?".
 */

import { migrarSiHaceFalta, leerCatalogo } from './storage.js';
import { descargarCatalogo, sincronizarTodo, descargarVisitasEquipo } from './sync.js';
import { deudaGlobal } from './estado.js';
import { initCalendario, refrescarCalendario, irAHoy, setModo, irADia } from './calendario.js';
import { initDrawer, abrirNuevaVisita, abrirVisita, hayDrawerAbierto } from './drawer.js';
import { initPaleta, abrirPaleta, hayPaletaAbierta } from './paleta.js';
import { initAdmin, abrirAdmin, hayAdminAbierto } from './admin.js';
import {
    initPermisos, actualizarPerfil, esAdministrador, olvidarPerfil,
    accesoBloqueado, aceptarInvitacion, tieneEquipo
} from './permisos.js';
import { ponerVisitasEquipo, olvidarVisitasEquipo } from './datos.js';
import { initDashboard, abrirDashboard, puedeVerDashboard, hayDashboardAbierto } from './dashboard.js';
import { initAuth, sesionActual, pintarBotonEntrada, intentarRefresco, cerrarSesion } from './auth.js';

let el = {};
let sincronizando = false;
let appIniciada = false;

document.addEventListener('DOMContentLoaded', () => {
    el = {
        gate: document.getElementById('gate'),
        sinInvitacion: document.getElementById('sin-invitacion'),
        sinInvitacionCorreo: document.getElementById('sin-invitacion-correo'),
        sinInvitacionSalir: document.getElementById('sin-invitacion-salir'),
        gateBoton: document.getElementById('gate-boton'),
        app: document.getElementById('app'),
        sync: document.getElementById('btn-sync'),
        syncTxt: document.getElementById('sync-txt'),
        deuda: document.getElementById('btn-deuda'),
        deudaN: document.getElementById('deuda-n'),
        admin: document.getElementById('btn-admin'),
        dashboard: document.getElementById('btn-dashboard'),
        sesion: document.getElementById('btn-sesion'),
        sesionFoto: document.getElementById('sesion-foto'),
        sesionNombre: document.getElementById('sesion-nombre'),
        fab: document.getElementById('fab'),
        toasts: document.getElementById('toasts')
    };

    el.sesion.addEventListener('click', () => {
        if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
        // El perfil cacheado es de quien se va: dejarlo daría sus permisos a quien entre.
        olvidarPerfil();
        cerrarSesion();
    });

    el.sinInvitacionSalir.addEventListener('click', () => {
        olvidarPerfil();
        olvidarVisitasEquipo();
        cerrarSesion();
    });

    initPermisos();
    initAuth({ onSesion: alCambiarSesion });
    pintarBotonEntrada(el.gateBoton);

    const sesion = sesionActual();
    if (!sesion) return mostrarGate();

    pintarSesion(sesion);
    // El bloqueo cacheado se respeta desde el arranque: si ya se supo que no hay invitación,
    // no tiene sentido armar la app entera para cerrarla medio segundo después.
    if (accesoBloqueado()) mostrarSinInvitacion(sesion);
    else { mostrarApp(); iniciarApp(); }
});

/** Login (primera vez en esta carga) o logout: no hay estado intermedio a medio armar. */
function alCambiarSesion(sesion) {
    pintarSesion(sesion);
    if (sesion) {
        if (accesoBloqueado()) return mostrarSinInvitacion(sesion);
        if (!appIniciada) { mostrarApp(); iniciarApp(); }
        return;
    }
    // Cerrar sesión con la app ya armada (calendario, drawer, listeners…) es más simple de
    // resolver recargando que desmontando todo módulo por módulo a mano.
    location.reload();
}

function mostrarGate() {
    el.gate.hidden = false;
    el.app.hidden = true;
    el.sinInvitacion.hidden = true;
}

function mostrarApp() {
    el.gate.hidden = true;
    el.sinInvitacion.hidden = true;
    el.app.hidden = false;
}

/**
 * Puerta cerrada. Solo se llega aquí con un NO explícito del servidor —nunca por falta de
 * red— porque bloquear a alguien por no haber podido preguntar convertiría cada bache de
 * señal en un educador que no puede trabajar.
 */
function mostrarSinInvitacion(sesion) {
    el.gate.hidden = true;
    el.app.hidden = true;
    el.sinInvitacion.hidden = false;
    el.sinInvitacionCorreo.textContent = sesion?.correo || '';
}

function pintarSesion(sesion) {
    el.sesion.hidden = !sesion;
    if (!sesion) return;
    el.sesionNombre.textContent = sesion.nombre;
    el.sesionFoto.hidden = !sesion.foto;
    if (sesion.foto) el.sesionFoto.src = sesion.foto;
    pintarAccesos();
}

/** Lo que la barra ofrece depende del rol, y el rol vive en la base de datos. */
function pintarAccesos() {
    el.admin.hidden = !esAdministrador();
    el.dashboard.hidden = !puedeVerDashboard();
}

/**
 * Consulta Supabase en segundo plano. Si vuelve con que no hay invitación, se cierra la
 * puerta aunque la app ya estuviera armada: una invitación revocada tiene que surtir efecto
 * sin esperar a que la persona decida recargar.
 */
function refrescarPerfil() {
    actualizarPerfil().then((res) => {
        if (res === null) return;
        if (accesoBloqueado()) return mostrarSinInvitacion(sesionActual());

        aceptarInvitacion();      // trámite silencioso la primera vez
        pintarAccesos();
        cargarEquipo();
    });
}

/**
 * Trae las visitas del equipo al espejo en memoria. Solo para quien tenga a alguien a cargo:
 * pedirlas para un educador sería una petición que siempre vuelve con lo que ya tiene.
 */
function cargarEquipo() {
    if (!tieneEquipo()) return;

    descargarVisitasEquipo().then(({ visitas, espejo }) => {
        if (!espejo) return;      // el espejo no está configurado: se sigue con lo local
        ponerVisitasEquipo(visitas);
        refrescarTodo();
    });
}

/** Todo lo que antes vivía suelto en DOMContentLoaded: ahora espera a que haya sesión. */
function iniciarApp() {
    appIniciada = true;

    const migracion = migrarSiHaceFalta();
    if (migracion) {
        toast(`Se actualizaron ${migracion.visitas} visitas al formato nuevo.`, { estado: 'completa' });
    }

    initDrawer({ onCambio: refrescarTodo, onToast: toast });
    initCalendario({
        onAbrirVisita: (id) => abrirVisita(id),
        onCrearEn: (dia, horaInicio, horaFin) => abrirNuevaVisita({ dia, hora_inicio: horaInicio, hora_fin: horaFin }),
        onCambio: refrescarTodo,
        onToast: toast
    });
    initPaleta({
        onNuevaVisita: () => abrirNuevaVisita(),
        onIrAHoy: irAHoy,
        onSetModo: setModo,
        onAbrirVisita: abrirVisita,
        onIrADia: irADia
    });
    initAdmin({ onToast: toast });
    initDashboard({ onToast: toast });

    el.fab.addEventListener('click', () => abrirNuevaVisita());
    el.sync.addEventListener('click', () => sincronizar({ manual: true }));
    el.deuda.addEventListener('click', () => toast('La bandeja de evidencias llega en el paso siguiente.'));
    el.admin.addEventListener('click', abrirAdmin);
    el.dashboard.addEventListener('click', abrirDashboard);

    document.addEventListener('keydown', atajos);
    document.addEventListener('keydown', atajoPaleta);
    window.addEventListener('online', alCambiarConexion);
    window.addEventListener('offline', alCambiarConexion);

    refrescarTodo();
    alCambiarConexion();
    // La línea de "ahora" se queda quieta si nadie la mueve.
    setInterval(refrescarCalendario, 60000);
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
    });
}

// ---------- atajos ----------

function atajos(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Si estás escribiendo, "n" es una letra, no un comando.
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (escribiendo) return;

    if (e.key === 'Escape') return;              // el drawer se cierra solo
    if (hayDrawerAbierto() || hayAdminAbierto() || hayDashboardAbierto()) return;

    const acciones = {
        n: () => abrirNuevaVisita(),
        t: () => irAHoy(),
        d: () => setModo('dia'),
        s: () => setModo('semana'),
        m: () => setModo('mes'),
        i: () => { if (puedeVerDashboard()) abrirDashboard(); }
    };
    const accion = acciones[e.key.toLowerCase()];
    if (accion) { e.preventDefault(); accion(); }
}

/** Separado de `atajos`: éste SÍ debe funcionar con el drawer abierto (para poder saltar). */
function atajoPaleta(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    if (hayDrawerAbierto() || hayAdminAbierto() || hayDashboardAbierto() || hayPaletaAbierta()) return;
    abrirPaleta();
}

// ---------- refresco ----------

export function refrescarTodo() {
    refrescarCalendario();
    actualizarDeuda();
}

function actualizarDeuda() {
    const n = deudaGlobal().length;
    el.deudaN.textContent = n;
    el.deuda.hidden = n === 0;
}

// ---------- toasts ----------

let toastSeq = 0;

/**
 * Un toast nombra qué pasó y, si aplica, qué hacer. Nunca se disculpa ni dice
 * "algo salió mal": eso no es información.
 */
export function toast(texto, { estado = null, accion = null, ms = 4000 } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (estado ? ` st-${estado}` : '');
    t.dataset.id = ++toastSeq;

    if (estado) {
        const d = document.createElement('span');
        d.className = 'dot';
        if (estado === 'programada') d.classList.add('hollow');
        t.appendChild(d);
    }

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = texto;
    t.appendChild(txt);

    if (accion) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'u';
        btn.textContent = accion.texto;
        btn.addEventListener('click', () => { accion.fn(); t.remove(); });
        t.appendChild(btn);
    }

    el.toasts.appendChild(t);
    setTimeout(() => t.remove(), ms);
    return t;
}

// ---------- conexión y sync ----------

function alCambiarConexion() {
    if (navigator.onLine) {
        // Antes de mandar nada: si el token de sesión ya venció (posible tras horas
        // offline), esto lo renueva en silencio para que el sync no lo rechace.
        intentarRefresco();
        sincronizar();
        descargarCatalogoSiSePuede();
        refrescarPerfil();
    } else {
        pintarSync('is-off', 'Sin conexión');
    }
}

function pintarSync(clase, texto) {
    el.sync.className = `sync ${clase}`;
    el.syncTxt.textContent = texto;
}

function estadoSyncEnReposo() {
    if (!navigator.onLine) return pintarSync('is-off', 'Sin conexión');

    const pendientes = deudaGlobal().length;
    if (pendientes > 0) return pintarSync('is-queue', `${pendientes} en cola`);
    pintarSync('', 'Al día');
}

async function sincronizar({ manual = false } = {}) {
    if (sincronizando || !navigator.onLine) {
        if (manual && !navigator.onLine) {
            toast('Sin conexión. Lo que registres se guarda y sube solo al recuperar señal.', { estado: 'programada' });
        }
        return;
    }
    sincronizando = true;
    pintarSync('is-busy', 'Enviando');

    try {
        const r = await sincronizarTodo();
        const nada = r.visitas.enviadas === 0 && r.evidencias.subidas === 0;
        if (manual && nada) toast('Todo está sincronizado.', { estado: 'completa' });
        if (!nada) {
            const partes = [];
            if (r.visitas.enviadas) partes.push(`${r.visitas.enviadas} visita${r.visitas.enviadas > 1 ? 's' : ''}`);
            if (r.evidencias.subidas) partes.push(`${r.evidencias.subidas} evidencia${r.evidencias.subidas > 1 ? 's' : ''}`);
            toast(`${partes.join(' y ')} sincronizada${partes.length > 1 || r.visitas.enviadas > 1 ? 's' : ''}.`, { estado: 'completa' });
        }
    } catch (error) {
        console.error('Error al sincronizar:', error);
        pintarSync('is-error', 'Error');
        toast(`No se pudo sincronizar: ${error.message}`, {
            estado: 'sin-registrar',
            accion: { texto: 'Reintentar', fn: () => sincronizar({ manual: true }) },
            ms: 8000
        });
        sincronizando = false;
        return;
    }

    sincronizando = false;
    refrescarTodo();
    estadoSyncEnReposo();
}

// ---------- catálogo ----------

async function descargarCatalogoSiSePuede() {
    try {
        await descargarCatalogo();
        pintarAccesos();   // el catálogo pudo cambiar
        refrescarTodo();
    } catch (err) {
        // Silencioso a propósito: el catálogo cacheado sirve, y no hay nada que el
        // educador pueda hacer al respecto en un pasillo.
        console.error('No se pudieron descargar los catálogos:', err);
    }
}

export function catalogo() {
    return leerCatalogo() || { clientes: [], sectores: [], educadores: [] };
}
