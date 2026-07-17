/**
 * Módulo de administración: Tipos de actividad (con sus reglas), Orígenes de la actividad
 * y Educadores/Admins. Vive fuera del flujo de visitas —no es un nivel del drawer— porque no
 * pertenece a NINGUNA visita en particular: son catálogos compartidos por todos.
 *
 * Guardado explícito, no automático como el drawer: aquí un error se propaga a TODOS los
 * educadores en el siguiente sync, así que un botón "Guardar" da oportunidad de revisar antes
 * de que eso pase, en vez de subir cada tecla sola.
 */

import { leerCatalogo } from './storage.js';
import { guardarCatalogosAdmin, descargarCatalogo } from './sync.js';
import { sesionActual } from './auth.js';

const TABS = [
    { id: 'tipos', etiqueta: 'Tipos de actividad' },
    { id: 'origenes', etiqueta: 'Orígenes' },
    { id: 'educadores', etiqueta: 'Educadores y admins' }
];

// El rol de administrador vive en Supabase (tabla pdt_admins, consultada por este RPC que
// solo expone un booleano por correo — nunca la lista completa). El resto de la app sigue
// sincronizando con Sheets/Apps Script sin cambios; esto es exclusivamente para el gate de
// "quién puede administrar".
const SUPABASE_URL = 'https://fiplfsuhsqibzrpvjvbx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcGxmc3Voc3FpYnpycHZqdmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODAyNjgsImV4cCI6MjA4OTg1NjI2OH0.YG3Fk8XJ_n9PGIYUHtoiy-MJNuWqJTsFBwooKnt1X5s';
const CLAVE_CACHE_ADMIN = 'pdt_admin_cache';

let el = {};
let tab = 'tipos';
let borrador = null;
let guardando = false;
let alToast = () => {};
let cacheAdmin = cargarCacheAdmin();

function cargarCacheAdmin() {
    try { return JSON.parse(localStorage.getItem(CLAVE_CACHE_ADMIN)) || {}; }
    catch { return {}; }
}

function guardarCacheAdmin(correo, esAdmin) {
    cacheAdmin = { correo, esAdmin, obtenido: Date.now() };
    try { localStorage.setItem(CLAVE_CACHE_ADMIN, JSON.stringify(cacheAdmin)); } catch { /* cuota llena: no es crítico */ }
}

export function initAdmin({ onToast } = {}) {
    alToast = onToast || (() => {});

    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    raiz.hidden = true;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', cerrar);

    const panel = document.createElement('aside');
    panel.className = 'drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Administración');

    raiz.append(scrim, panel);
    document.body.appendChild(raiz);
    el = { raiz, panel };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !raiz.hidden) cerrar();
    });
}

export function hayAdminAbierto() { return el.raiz && !el.raiz.hidden; }

/**
 * Solo puede administrar quien esté dado de alta como admin en Supabase. Se consulta async
 * y se cachea (mismo patrón que la sesión): la respuesta de red no bloquea el render, se
 * confía en la última respuesta conocida y se refresca en segundo plano al recuperar señal.
 * Se conserva el catálogo "Admins" de Sheets como respaldo, por si Supabase no responde y ya
 * había administradores dados de alta ahí antes de este cambio.
 */
export function puedeAdministrar() {
    const sesion = sesionActual();
    if (!sesion) return false;
    if (((leerCatalogo() || {}).admins || []).includes(sesion.correo)) return true;
    return cacheAdmin.correo === sesion.correo && cacheAdmin.esAdmin === true;
}

/** Refresca el estado de admin contra Supabase. Nunca lanza: sin red, se queda con la caché. */
export async function actualizarEstadoAdmin() {
    const sesion = sesionActual();
    if (!sesion || !navigator.onLine) return null;

    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/pdt_es_admin`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ p_correo: sesion.correo })
        });
        if (!resp.ok) throw new Error(`Supabase respondió ${resp.status}`);
        const esAdmin = (await resp.json()) === true;
        guardarCacheAdmin(sesion.correo, esAdmin);
        return esAdmin;
    } catch (err) {
        console.error('No se pudo verificar el rol de administrador en Supabase:', err);
        return null;
    }
}

export function abrirAdmin() {
    if (!puedeAdministrar() || !el.raiz) return;

    const cat = leerCatalogo() || {};
    borrador = {
        tipos_actividad: (cat.tipos_actividad || []).map(t => ({ ...t })),
        origenes: [...(cat.origenes || [])],
        educadores: (cat.educadores || []).map(e => ({ ...e })),
        admins: [...(cat.admins || [])]
    };
    tab = 'tipos';
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    pintar();
}

function cerrar() {
    if (!el.raiz) return;
    el.raiz.hidden = true;
    document.body.style.overflow = '';
    borrador = null;
}

function pintar() {
    el.panel.innerHTML = '';
    el.panel.append(cabecera(), tabsNav(), cuerpo(), pie());
}

// ---------- cabecera y tabs ----------

function cabecera() {
    const head = document.createElement('div');
    head.className = 'drawer-head';

    const izq = document.createElement('div');
    izq.className = 'drawer-head-txt';
    const h = document.createElement('h3');
    h.textContent = 'Administración';
    const sub = document.createElement('p');
    sub.className = 'drawer-sub';
    sub.textContent = 'Catálogos compartidos por todos los educadores.';
    izq.append(h, sub);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '✕';
    x.addEventListener('click', cerrar);

    head.append(izq, x);
    return head;
}

function tabsNav() {
    const nav = document.createElement('div');
    nav.className = 'seg admin-tabs';
    nav.setAttribute('role', 'group');
    TABS.forEach(t => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = t.etiqueta;
        btn.setAttribute('aria-pressed', String(t.id === tab));
        btn.addEventListener('click', () => { tab = t.id; pintar(); });
        nav.appendChild(btn);
    });
    return nav;
}

function cuerpo() {
    const body = document.createElement('div');
    body.className = 'drawer-body';
    if (tab === 'tipos') body.appendChild(vistaTipos());
    else if (tab === 'origenes') body.appendChild(vistaOrigenes());
    else body.appendChild(vistaEducadores());
    return body;
}

// ---------- tipos de actividad ----------

function vistaTipos() {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Qué exige cada tipo al registrar una actividad';
    caja.appendChild(lbl);

    borrador.tipos_actividad.forEach((t, i) => caja.appendChild(filaTipo(t, i)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Nuevo tipo de actividad';
    add.addEventListener('click', () => {
        borrador.tipos_actividad.push({ nombre: '', evidencia: true, materiales: false });
        pintar();
    });
    caja.appendChild(add);
    return caja;
}

function filaTipo(t, i) {
    const fila = document.createElement('div');
    fila.className = 'admin-fila';

    const nombre = document.createElement('input');
    nombre.type = 'text';
    nombre.className = 'inp';
    nombre.placeholder = 'Nombre del tipo';
    nombre.value = t.nombre;
    nombre.addEventListener('input', () => { t.nombre = nombre.value; });

    const flags = document.createElement('div');
    flags.className = 'chips';
    flags.append(
        toggle('Evidencia', t.evidencia, (v) => { t.evidencia = v; }),
        toggle('Materiales', t.materiales, (v) => { t.materiales = v; })
    );

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'icon-btn';
    borrar.setAttribute('aria-label', `Borrar ${t.nombre || 'tipo'}`);
    borrar.textContent = '✕';
    borrar.addEventListener('click', () => { borrador.tipos_actividad.splice(i, 1); pintar(); });

    fila.append(nombre, flags, borrar);
    return fila;
}

function toggle(etiqueta, activo, onCambio) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (activo ? ' on' : '');
    chip.setAttribute('aria-pressed', String(!!activo));
    chip.textContent = etiqueta;
    chip.addEventListener('click', () => {
        const nuevo = !chip.classList.contains('on');
        chip.classList.toggle('on', nuevo);
        chip.setAttribute('aria-pressed', String(nuevo));
        onCambio(nuevo);
    });
    return chip;
}

// ---------- orígenes ----------

function vistaOrigenes() {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Orígenes de la actividad';
    caja.appendChild(lbl);

    const chips = document.createElement('div');
    chips.className = 'chips';
    borrador.origenes.forEach((o, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip on admin-chip';
        chip.textContent = o;
        const x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', `Quitar ${o}`);
        x.textContent = '✕';
        x.addEventListener('click', () => { borrador.origenes.splice(i, 1); pintar(); });
        chip.appendChild(x);
        chips.appendChild(chip);
    });
    caja.appendChild(chips);

    const nuevo = document.createElement('input');
    nuevo.type = 'text';
    nuevo.className = 'inp';
    nuevo.placeholder = 'Nuevo origen y Enter…';
    nuevo.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = nuevo.value.trim();
        if (v && !borrador.origenes.includes(v)) borrador.origenes.push(v);
        nuevo.value = '';
        pintar();
    });
    caja.appendChild(nuevo);
    return caja;
}

// ---------- educadores y admins ----------

function vistaEducadores() {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Educadores';
    caja.appendChild(lbl);

    borrador.educadores.forEach((e, i) => caja.appendChild(filaEducador(e, i)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Nuevo educador';
    add.addEventListener('click', () => {
        borrador.educadores.push({ nombre: '', correo: '' });
        pintar();
    });
    caja.appendChild(add);
    return caja;
}

function filaEducador(e, i) {
    const fila = document.createElement('div');
    fila.className = 'admin-fila';

    const nombre = document.createElement('input');
    nombre.type = 'text';
    nombre.className = 'inp';
    nombre.placeholder = 'Nombre';
    nombre.value = e.nombre;
    nombre.addEventListener('input', () => { e.nombre = nombre.value; });

    const correo = document.createElement('input');
    correo.type = 'email';
    correo.className = 'inp mono';
    correo.placeholder = 'correo@degasa.com';
    correo.value = e.correo;
    correo.addEventListener('input', () => { e.correo = correo.value.trim().toLowerCase(); });

    const esAdmin = toggle('Admin', borrador.admins.includes(e.correo), (v) => {
        borrador.admins = borrador.admins.filter(c => c !== e.correo);
        if (v && e.correo) borrador.admins.push(e.correo);
    });
    // El toggle se creó con el correo de ANTES de cualquier edición; si lo cambian,
    // reflejarlo en la lista de admins exige releer el valor actual al guardar, no aquí.
    correo.addEventListener('change', () => pintar());

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'icon-btn';
    borrar.setAttribute('aria-label', `Borrar ${e.nombre || 'educador'}`);
    borrar.textContent = '✕';
    borrar.addEventListener('click', () => {
        borrador.admins = borrador.admins.filter(c => c !== e.correo);
        borrador.educadores.splice(i, 1);
        pintar();
    });

    fila.append(nombre, correo, esAdmin, borrar);
    return fila;
}

// ---------- pie ----------

function pie() {
    const foot = document.createElement('div');
    foot.className = 'drawer-foot';

    const cancelar = document.createElement('button');
    cancelar.type = 'button';
    cancelar.className = 'btn-txt';
    cancelar.textContent = 'Cancelar';
    cancelar.addEventListener('click', cerrar);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const guardar = document.createElement('button');
    guardar.type = 'button';
    guardar.className = 'btn';
    guardar.textContent = guardando ? 'Guardando…' : 'Guardar cambios';
    guardar.disabled = guardando;
    guardar.addEventListener('click', guardarCambios);

    foot.append(cancelar, spacer, guardar);
    return foot;
}

async function guardarCambios() {
    const vacios = borrador.tipos_actividad.filter(t => !t.nombre.trim()).length
        + borrador.educadores.filter(e => !e.nombre.trim() || !e.correo.trim()).length;
    if (vacios > 0) return alToast('Hay filas sin completar.', { estado: 'sin-registrar' });

    if (!confirm('Estos catálogos los usan TODOS los educadores. ¿Guardar los cambios?')) return;

    guardando = true;
    pintar();
    try {
        await guardarCatalogosAdmin(borrador);
        await descargarCatalogo();
        alToast('Catálogos actualizados.', { estado: 'completa' });
        cerrar();
    } catch (err) {
        alToast(`No se pudo guardar: ${err.message}`, { estado: 'sin-registrar', ms: 7000 });
    } finally {
        guardando = false;
    }
}
