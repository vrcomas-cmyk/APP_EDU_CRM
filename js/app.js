/**
 * Arranque y coordinación.
 *
 * No hay router de vistas: el calendario ES la pantalla. Todo lo demás (agendar, ejecutar)
 * ocurre en un drawer encima, para no tapar el contexto que da sentido a lo que estás
 * haciendo — al agendar, la pregunta real es "¿dónde cabe esto?".
 */

import { migrarSiHaceFalta, leerCatalogo } from './storage.js';
import { descargarCatalogo, sincronizarTodo } from './sync.js';
import { deudaGlobal } from './estado.js';
import { initCalendario, refrescarCalendario, irAHoy, setModo, diaVisible } from './calendario.js';
import { initDrawer, abrirNuevaVisita, abrirVisita, hayDrawerAbierto } from './drawer.js';

let el = {};
let sincronizando = false;

document.addEventListener('DOMContentLoaded', () => {
    el = {
        sync: document.getElementById('btn-sync'),
        syncTxt: document.getElementById('sync-txt'),
        deuda: document.getElementById('btn-deuda'),
        deudaN: document.getElementById('deuda-n'),
        fab: document.getElementById('fab'),
        toasts: document.getElementById('toasts')
    };

    const migracion = migrarSiHaceFalta();
    if (migracion) {
        toast(`Se actualizaron ${migracion.visitas} visitas al formato nuevo.`, { estado: 'completa' });
    }

    initDrawer({ onCambio: refrescarTodo, onToast: toast });
    initCalendario({
        onAbrirVisita: (id) => abrirVisita(id),
        onCrearEn: (dia, hora) => abrirNuevaVisita({ dia, hora_inicio: hora })
    });

    el.fab.addEventListener('click', () => abrirNuevaVisita({ dia: diaVisible() }));
    el.sync.addEventListener('click', () => sincronizar({ manual: true }));
    el.deuda.addEventListener('click', () => toast('La bandeja de evidencias llega en el paso siguiente.'));

    document.addEventListener('keydown', atajos);
    window.addEventListener('online', alCambiarConexion);
    window.addEventListener('offline', alCambiarConexion);

    refrescarTodo();
    alCambiarConexion();
    // La línea de "ahora" se queda quieta si nadie la mueve.
    setInterval(refrescarCalendario, 60000);
});

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
    if (hayDrawerAbierto()) return;

    const acciones = {
        n: () => abrirNuevaVisita({ dia: diaVisible() }),
        t: () => irAHoy(),
        d: () => setModo('dia'),
        s: () => setModo('semana'),
        m: () => setModo('mes')
    };
    const accion = acciones[e.key.toLowerCase()];
    if (accion) { e.preventDefault(); accion(); }
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
        sincronizar();
        descargarCatalogoSiSePuede();
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
