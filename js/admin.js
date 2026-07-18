/**
 * Módulo de administración. Vive fuera del flujo de visitas —no es un nivel del drawer—
 * porque no pertenece a NINGUNA visita en particular: son catálogos compartidos por todos.
 *
 * Guardado explícito, no automático como el drawer: aquí un error se propaga a TODOS los
 * educadores en el siguiente sync, así que un botón "Guardar" da oportunidad de revisar antes
 * de que eso pase, en vez de subir cada tecla sola.
 *
 * ── Qué se configura ─────────────────────────────────────────────────────────────────
 *
 *   TIPOS      Por cada tipo de actividad, el MODO de cada campo capturable: obligatorio,
 *              opcional, solo lectura u oculto. Esto es lo que arma el formulario de captura;
 *              no hay ninguna condición escrita a mano en la pantalla de actividad.
 *   SECTORES   Cuáles de los que existen en Materiales se le ofrecen al educador.
 *   LISTAS     Orígenes, áreas, unidades de medida y tipos de evidencia.
 *   EQUIPO     Educadores y quién puede administrar.
 */

import { leerCatalogo } from './storage.js';
import { guardarCatalogosAdmin, descargarCatalogo } from './sync.js';
import { sesionActual } from './auth.js';
import {
    CAMPOS_ACTIVIDAD, MODOS, ETIQUETAS_MODO, IDS_CAMPOS,
    configuracionCampos, sectoresDelCatalogo
} from './catalogos.js';

const TABS = [
    { id: 'tipos', etiqueta: 'Tipos y campos' },
    { id: 'sectores', etiqueta: 'Sectores' },
    { id: 'listas', etiqueta: 'Listas' },
    { id: 'educadores', etiqueta: 'Equipo' }
];

/** Las listas simples se editan todas igual; solo cambian el nombre y el texto de ayuda. */
const LISTAS = [
    { clave: 'origenes', etiqueta: 'Orígenes de la actividad',
      ayuda: 'De dónde nace la visita a un sector.' },
    { clave: 'areas', etiqueta: 'Áreas visitadas',
      ayuda: 'Opciones del campo "Área visitada" de la actividad.' },
    { clave: 'unidades', etiqueta: 'Unidades de medida',
      ayuda: 'Se ofrecen al capturar la cantidad de un material.' },
    { clave: 'tipos_evidencia', etiqueta: 'Tipos de evidencia',
      ayuda: 'Solo aparecen si algún tipo de actividad muestra el campo.' }
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
let tipoAbierto = null;
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
        // La configuración de campos se materializa AQUÍ: se parte de lo que la app está
        // usando de verdad (defaults + banderas viejas + lo ya configurado), para que el
        // administrador vea el estado real y no una tabla vacía que parezca "sin configurar".
        tipos_actividad: (cat.tipos_actividad || []).map(t => ({
            ...t,
            campos: { ...configuracionCampos(t.nombre) }
        })),
        origenes: [...(cat.origenes || [])],
        areas: [...(cat.areas || [])],
        unidades: [...(cat.unidades || [])],
        tipos_evidencia: [...(cat.tipos_evidencia || [])],
        sectores_ocultos: [...(cat.sectores_ocultos || [])],
        educadores: (cat.educadores || []).map(e => ({ ...e })),
        admins: [...(cat.admins || [])]
    };
    tab = 'tipos';
    tipoAbierto = null;
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
    else if (tab === 'sectores') body.appendChild(vistaSectores());
    else if (tab === 'listas') LISTAS.forEach(l => body.appendChild(vistaLista(l)));
    else body.appendChild(vistaEducadores());
    return body;
}

// ---------- tipos de actividad ----------

function vistaTipos() {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Qué pide cada tipo de actividad';
    caja.appendChild(lbl);

    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = 'El formulario de captura se arma con esto. Un campo oculto no se '
        + 'pregunta; uno obligatorio impide guardar la actividad si queda vacío.';
    caja.appendChild(ayuda);

    borrador.tipos_actividad.forEach((t, i) => caja.appendChild(fichaTipo(t, i)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Nuevo tipo de actividad';
    add.addEventListener('click', () => {
        borrador.tipos_actividad.push({
            nombre: '', evidencia: true, materiales: false,
            campos: { ...configuracionCampos(null) }
        });
        pintar();
    });
    caja.appendChild(add);
    return caja;
}

/**
 * Un tipo con su matriz de campos. Se pinta plegado: con ocho campos por tipo y siete tipos,
 * abrir todo de golpe da una pared de 56 selectores en la que no se encuentra nada.
 */
function fichaTipo(t, i) {
    const ficha = document.createElement('details');
    ficha.className = 'tipo-ficha';
    ficha.open = tipoAbierto === i;
    ficha.addEventListener('toggle', () => { if (ficha.open) tipoAbierto = i; });

    const resumen = document.createElement('summary');
    resumen.className = 'tipo-sum';

    const nombre = document.createElement('span');
    nombre.className = 'tipo-nombre';
    nombre.textContent = t.nombre || 'Tipo sin nombre';
    if (!t.nombre) nombre.classList.add('es-vacio');

    const cuenta = document.createElement('span');
    cuenta.className = 'sector-cuenta';
    const obligatorios = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OBLIGATORIO).length;
    const ocultos = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OCULTO).length;
    cuenta.textContent = `${obligatorios} obligatorio${obligatorios === 1 ? '' : 's'} · ${ocultos} oculto${ocultos === 1 ? '' : 's'}`;

    resumen.append(nombre, cuenta);
    ficha.appendChild(resumen);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'tipo-cuerpo';

    const fila = document.createElement('div');
    fila.className = 'admin-fila';
    const inpNombre = document.createElement('input');
    inpNombre.type = 'text';
    inpNombre.className = 'inp';
    inpNombre.placeholder = 'Nombre del tipo';
    inpNombre.value = t.nombre;
    inpNombre.addEventListener('input', () => {
        t.nombre = inpNombre.value;
        nombre.textContent = t.nombre || 'Tipo sin nombre';
        nombre.classList.toggle('es-vacio', !t.nombre);
    });

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'icon-btn';
    borrar.setAttribute('aria-label', `Borrar ${t.nombre || 'tipo'}`);
    borrar.textContent = '\u2715';
    borrar.addEventListener('click', () => {
        if (!confirm(`\u00bfBorrar el tipo "${t.nombre || 'sin nombre'}"?\n\nLas actividades ya `
            + 'registradas con él no se tocan, pero dejará de ofrecerse.')) return;
        borrador.tipos_actividad.splice(i, 1);
        tipoAbierto = null;
        pintar();
    });
    fila.append(inpNombre, borrar);
    cuerpo.appendChild(fila);

    CAMPOS_ACTIVIDAD.forEach(campo => cuerpo.appendChild(filaCampo(t, campo, cuenta)));

    ficha.appendChild(cuerpo);
    return ficha;
}

function filaCampo(t, campo, cuenta) {
    const fila = document.createElement('div');
    fila.className = 'campo-fila';

    const lbl = document.createElement('span');
    lbl.className = 'campo-fila-lbl';
    lbl.textContent = campo.etiqueta;

    const sel = document.createElement('select');
    sel.className = 'inp';
    sel.setAttribute('aria-label', `Modo de ${campo.etiqueta}`);

    Object.values(MODOS).forEach(m => {
        const op = document.createElement('option');
        op.value = m;
        op.textContent = ETIQUETAS_MODO[m];
        if ((t.campos?.[campo.id] || campo.defecto) === m) op.selected = true;
        sel.appendChild(op);
    });

    sel.addEventListener('change', () => {
        t.campos = { ...(t.campos || {}), [campo.id]: sel.value };
        // Las banderas viejas se mantienen en sintonía: la hoja sigue teniendo sus columnas
        // `evidencia` y `materiales`, y dejarlas mintiendo confundiría a quien lea el Sheet.
        if (campo.id === 'evidencia') t.evidencia = sel.value !== MODOS.OCULTO;
        if (campo.id === 'materiales') t.materiales = sel.value === MODOS.OBLIGATORIO;

        const obl = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OBLIGATORIO).length;
        const ocu = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OCULTO).length;
        cuenta.textContent = `${obl} obligatorio${obl === 1 ? '' : 's'} · ${ocu} oculto${ocu === 1 ? '' : 's'}`;
    });

    fila.append(lbl, sel);
    return fila;
}

// ---------- sectores ----------

/**
 * Los sectores no se escriben: se curan.
 *
 * La lista sale de la hoja de Materiales, que es también de donde salen los materiales que se
 * ofrecen dentro de cada sector. Dejar inventar nombres aquí produciría sectores cuyo buscador
 * de materiales sale siempre vacío, y eso es indiagnosticable desde un pasillo.
 */
function vistaSectores() {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Sectores que se ofrecen al agendar';
    caja.appendChild(lbl);

    const todos = sectoresDelCatalogo();

    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = todos.length
        ? 'Salen de la hoja de Materiales y por eso no se escriben aquí: un sector sin '
          + 'materiales detrás mostraría un buscador vacío. Apaga los que no quieras ofrecer.'
        : 'El catálogo de materiales no ha cargado todavía. Conéctate para verlo.';
    caja.appendChild(ayuda);

    if (todos.length === 0) return caja;

    const activos = todos.filter(x => !borrador.sectores_ocultos.includes(x)).length;
    const cuenta = document.createElement('p');
    cuenta.className = 'sector-cuenta';
    cuenta.textContent = `${activos} de ${todos.length} activos`;
    caja.appendChild(cuenta);

    const chips = document.createElement('div');
    chips.className = 'chips';
    todos.forEach(nombre => {
        const activo = !borrador.sectores_ocultos.includes(nombre);
        chips.appendChild(toggle(nombre, activo, (v) => {
            borrador.sectores_ocultos = borrador.sectores_ocultos.filter(x => x !== nombre);
            if (!v) borrador.sectores_ocultos.push(nombre);
            const n = todos.filter(x => !borrador.sectores_ocultos.includes(x)).length;
            cuenta.textContent = `${n} de ${todos.length} activos`;
        }));
    });
    caja.appendChild(chips);
    return caja;
}

// ---------- listas simples ----------

function vistaLista({ clave, etiqueta, ayuda }) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;
    caja.appendChild(lbl);

    const ayudaP = document.createElement('p');
    ayudaP.className = 'ayuda';
    ayudaP.textContent = ayuda;
    caja.appendChild(ayudaP);

    const chips = document.createElement('div');
    chips.className = 'chips';
    borrador[clave].forEach((valor, i) => {
        const chip = document.createElement('span');
        chip.className = 'chip on admin-chip';
        chip.textContent = valor;
        const x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', `Quitar ${valor}`);
        x.textContent = '\u2715';
        x.addEventListener('click', () => { borrador[clave].splice(i, 1); pintar(); });
        chip.appendChild(x);
        chips.appendChild(chip);
    });
    caja.appendChild(chips);

    const nuevo = document.createElement('input');
    nuevo.type = 'text';
    nuevo.className = 'inp';
    nuevo.placeholder = 'Escribe y Enter para agregar…';
    nuevo.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = nuevo.value.trim();
        if (v && !borrador[clave].includes(v)) borrador[clave].push(v);
        nuevo.value = '';
        pintar();
    });
    caja.appendChild(nuevo);
    return caja;
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
    const problemas = [];

    if (borrador.tipos_actividad.some(t => !t.nombre.trim())) {
        problemas.push('hay un tipo de actividad sin nombre');
    }
    if (borrador.educadores.some(e => !e.nombre.trim() || !e.correo.trim())) {
        problemas.push('hay un educador sin nombre o sin correo');
    }

    const nombres = borrador.tipos_actividad.map(t => t.nombre.trim().toLowerCase());
    if (new Set(nombres).size !== nombres.length) {
        problemas.push('hay dos tipos de actividad con el mismo nombre');
    }

    // Una lista vacía no rompe la app (catalogos.js cae en sus defaults), pero sí sorprende:
    // el administrador creería haberla borrado y seguiría viendo opciones.
    LISTAS.forEach(l => {
        if (borrador[l.clave].length === 0) problemas.push(`"${l.etiqueta}" quedó vacía`);
    });

    if (borrador.tipos_actividad.length === 0) {
        problemas.push('no queda ningún tipo de actividad');
    }

    if (problemas.length > 0) {
        return alToast(`No se puede guardar: ${problemas.join('; ')}.`,
            { estado: 'sin-registrar', ms: 8000 });
    }

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
