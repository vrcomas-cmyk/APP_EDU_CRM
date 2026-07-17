/**
 * Drawer. Lateral en escritorio, bottom-sheet a altura completa en móvil. Nunca modal
 * centrado: al agendar la pregunta real es "¿dónde cabe esto?", y un modal tapa la respuesta.
 *
 * Tres niveles que se empujan:
 *   VISITA    agendar (todo editable) o ver una ya creada (congelada, con check-in/out).
 *   SECTOR    su objetivo, su origen y sus actividades.
 *   MATERIAL  ventana propia para buscar y capturar un material.
 *
 * Una vez creada, la visita se CONGELA: cliente, hospital, fecha y horario la identifican.
 * Para moverla está Reagendar, que deja historial; editarlos en silencio borraría el rastro.
 */

import {
    leerVisitas, leerCatalogo, agregarVisita, actualizarVisita, obtenerVisita,
    eliminarVisita, nuevoId, historialHospitales
} from './storage.js';
import {
    buscarSolapes, saludDe, estadoDe, detalleEstado, etiquetaEstado, ESTADOS,
    duracionTexto, permanenciaTexto, tieneCheckIn, tieneCheckOut,
    estadoSector, etiquetaSector
} from './estado.js';
import {
    tiposActividad, origenes, areas, unidades, reglaDe, camposExtra,
    requiereMateriales, buscarMateriales, hayMateriales
} from './catalogos.js';
import {
    iniciarVisita, finalizarVisita, reagendarVisita, cancelarVisita, reactivarVisita,
    bloqueoParaActividades, puedeIniciar, puedeFinalizar
} from './visita.js';
import { registrar, TIPOS } from './eventos.js';
import { controlEvidencia, quitarEvidencia } from './evidencias.js';
import { describirUbicacion, precisionDudosa } from './geo.js';
import { etiquetaDiaLarga, horaAMinutos as aMinutos, minutosAHora } from './fechas.js';
import { sesionActual } from './auth.js';

const MAX_SUGERENCIAS = 60;

let el = {};
let visitaId = null;
let sectorId = null;
let reagendando = false;
let alCambiar = () => {};
let alToast = () => {};
let guardadoTimer = null;

export function initDrawer({ onCambio, onToast } = {}) {
    alCambiar = onCambio || (() => {});
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
    panel.setAttribute('aria-label', 'Visita');

    raiz.append(scrim, panel);
    document.body.appendChild(raiz);
    el = { raiz, scrim, panel };

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || raiz.hidden) return;
        if (document.querySelector('.modal')) return;   // la ventana de material se cierra sola
        // Escape sube un nivel antes de cerrar: desde un sector no pierdes la visita.
        if (sectorId) { sectorId = null; pintar(); } else cerrar();
    });
}

export function hayDrawerAbierto() { return el.raiz && !el.raiz.hidden; }

/** `hora_fin` la trae el drag-to-create del calendario; sin ella, la duración por defecto es 1h. */
export function abrirNuevaVisita({ dia, hora_inicio = '09:00', hora_fin } = {}) {
    const sesion = sesionActual();
    const visita = agregarVisita({
        id: nuevoId('v'),
        educador: sesion?.nombre || '', educador_correo: sesion?.correo || '',
        cliente: '', hospital: '',
        dia: dia || hoyISO(),
        hora_inicio,
        hora_fin: hora_fin || sumarMinutos(hora_inicio, 60),
        estado: ESTADOS.PROGRAMADA,
        reagendas: [],
        sectores: [],
        sincronizado: false,
        borrador: true
    });
    abrir(visita.id);
}

export function abrirVisita(id) { abrir(id); }

function abrir(id) {
    visitaId = id;
    sectorId = null;
    reagendando = false;
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    pintar();
    el.panel.querySelector('input, button')?.focus({ preventScroll: true });
}

function cerrar() {
    const visita = obtenerVisita(visitaId);
    if (visita?.borrador) {
        // Un borrador sin cliente no es una visita: es un clic accidental.
        if (!visita.cliente?.trim()) {
            eliminarVisita(visita.id);
        } else {
            // Llegó con datos (p. ej. duplicada) y se cierra sin tocar nada más: ya es real.
            registrarProgramada(actualizarVisita(visita.id, v => { delete v.borrador; }));
        }
    }

    el.raiz.hidden = true;
    document.body.style.overflow = '';
    visitaId = null;
    sectorId = null;
    alCambiar();
}

// ---------- guardado ----------

/** El borrador deja de serlo en su primer edit real: ahí nace la visita para efectos del spec. */
function registrarProgramada(visita) {
    registrar(TIPOS.VISITA_PROGRAMADA, visita, {
        dia: visita.dia, hora_inicio: visita.hora_inicio, hora_fin: visita.hora_fin
    });
}

function editar(mutador, { repintar = false } = {}) {
    const eraBorrador = !!obtenerVisita(visitaId)?.borrador;
    const actualizada = actualizarVisita(visitaId, (v) => { mutador(v); delete v.borrador; });
    if (eraBorrador) registrarProgramada(actualizada);
    marcarGuardado();
    alCambiar();
    if (repintar) pintar();
}

function marcarGuardado() {
    const pill = el.panel.querySelector('.saving');
    if (!pill) return;
    pill.classList.add('is-on');
    pill.querySelector('.saving-txt').textContent = 'Guardado';
    clearTimeout(guardadoTimer);
    guardadoTimer = setTimeout(() => pill.classList.remove('is-on'), 1400);
}

// ---------- pintado ----------

function pintar() {
    const visita = obtenerVisita(visitaId);
    if (!visita) return cerrar();

    el.panel.innerHTML = '';
    const sector = sectorId ? visita.sectores.find(s => s.id === sectorId) : null;

    if (sector) el.panel.append(cabeceraSector(visita, sector), cuerpoSector(visita, sector), pie(visita));
    else el.panel.append(cabeceraVisita(visita), cuerpoVisita(visita), pie(visita));
}

// ---------- nivel visita ----------

function cabeceraVisita(visita) {
    const head = document.createElement('div');
    head.className = 'drawer-head';

    const izq = document.createElement('div');
    izq.className = 'drawer-head-txt';

    const h = document.createElement('h3');
    h.textContent = visita.borrador ? 'Nueva visita' : (visita.hospital || visita.cliente || 'Visita');
    izq.appendChild(h);

    if (visita.borrador) {
        const sub = document.createElement('span');
        sub.className = 'eyebrow';
        sub.textContent = etiquetaDiaLarga(visita.dia);
        izq.appendChild(sub);
    } else {
        const cli = document.createElement('p');
        cli.className = 'drawer-sub';
        cli.textContent = visita.cliente || 'Sin cliente';

        const cuando = document.createElement('p');
        cuando.className = 'drawer-cuando mono';
        cuando.textContent = `${etiquetaDiaLarga(visita.dia)} · ${visita.hora_inicio}–${visita.hora_fin} · ${duracionTexto(visita)}`;

        const pill = document.createElement('span');
        pill.className = `pill st-${saludDe(visita)}`;
        pill.textContent = detalleEstado(visita);

        izq.append(cli, cuando, pill);
    }

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '✕';
    x.addEventListener('click', cerrar);

    head.append(izq, x);
    return head;
}

function cuerpoVisita(visita) {
    const body = document.createElement('div');
    body.className = 'drawer-body';

    if (visita.borrador) {
        body.append(campoCliente(visita), campoHospital(visita),
                    campoFecha(visita), campoHoras(visita));
    } else {
        if (estadoDe(visita) === ESTADOS.CANCELADA) body.appendChild(avisoCancelada(visita));
        else body.appendChild(bloqueCheck(visita));

        if (reagendando) body.appendChild(bloqueReagendar(visita));
        if ((visita.reagendas || []).length) body.appendChild(historialReagendas(visita));
    }

    body.appendChild(listaSectores(visita));
    return body;
}

/** Check-in / check-out: el hecho de haber estado ahí. */
function bloqueCheck(visita) {
    const caja = document.createElement('div');
    caja.className = 'check';

    if (!tieneCheckIn(visita)) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = puedeIniciar(visita)
            ? 'Al llegar con el cliente, inicia la visita. Se registra la hora y tu ubicación.'
            : 'Falta el cliente para poder iniciar la visita.';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-check';
        btn.textContent = '▶ Iniciar visita';
        btn.disabled = !puedeIniciar(visita);
        btn.addEventListener('click', () => accionCheck(btn, iniciarVisita, 'Iniciando…'));

        caja.append(p, btn);
        return caja;
    }

    caja.appendChild(marcaCheck('Llegada', visita.check_in));

    if (tieneCheckOut(visita)) {
        caja.appendChild(marcaCheck('Salida', visita.check_out));
        const perm = permanenciaTexto(visita);
        if (perm) {
            const p = document.createElement('p');
            p.className = 'permanencia mono';
            p.textContent = `Permanencia real ${perm} · planeada ${duracionTexto(visita)}`;
            caja.appendChild(p);
        }
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-check';
        btn.textContent = '■ Finalizar visita';
        btn.addEventListener('click', () => accionCheck(btn, finalizarVisita, 'Finalizando…'));

        const nota = document.createElement('p');
        nota.className = 'ayuda';
        // El educador tiene que poder irse sin haber terminado de escribir.
        nota.textContent = 'Finalizar marca tu salida del cliente. Puedes seguir capturando actividades después.';

        caja.append(btn, nota);
    }
    return caja;
}

async function accionCheck(btn, accion, textoOcupado) {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = textoOcupado;

    const r = await accion(visitaId);

    if (!r.ok) {
        btn.disabled = false;
        btn.textContent = original;
        return alToast(r.error, { estado: 'sin-registrar' });
    }

    if (r.ubicacion?.error) {
        alToast(`Registrado sin ubicación: ${r.ubicacion.error.toLowerCase()}.`, { estado: 'programada', ms: 6000 });
    } else if (precisionDudosa(r.ubicacion)) {
        alToast(`Ubicación con poca precisión (±${r.ubicacion.precision_m} m).`, { estado: 'programada' });
    }
    if (r.permanencia_min != null) {
        alToast(`Visita finalizada · ${permanenciaTexto(r.visita)} en el cliente.`, { estado: 'completa' });
    }

    alCambiar();
    pintar();
}

function marcaCheck(etiqueta, check) {
    const caja = document.createElement('div');
    caja.className = 'marca';

    const l = document.createElement('span');
    l.className = 'marca-lbl';
    l.textContent = etiqueta;

    const h = document.createElement('span');
    h.className = 'marca-hora mono';
    h.textContent = new Date(check.momento).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    const u = document.createElement('span');
    u.className = 'marca-ubi';
    u.textContent = describirUbicacion(check);
    if (check.error) u.classList.add('es-sin');

    caja.append(l, h, u);
    return caja;
}

function avisoCancelada(visita) {
    const caja = document.createElement('div');
    caja.className = 'aviso es-cancelada';

    const p = document.createElement('p');
    p.textContent = visita.motivo_cancelacion
        ? `Visita cancelada: ${visita.motivo_cancelacion}`
        : 'Visita cancelada.';

    const reabrir = document.createElement('button');
    reabrir.type = 'button';
    reabrir.className = 'btn-txt';
    reabrir.textContent = 'Reactivar';
    reabrir.addEventListener('click', () => {
        const r = reactivarVisita(visitaId);
        if (!r.ok) return alToast(r.error, { estado: 'sin-registrar' });
        alCambiar();
        pintar();
    });

    caja.append(p, reabrir);
    return caja;
}

function historialReagendas(visita) {
    const caja = document.createElement('details');
    caja.className = 'historial';

    const s = document.createElement('summary');
    s.textContent = `Reagendada ${visita.reagendas.length} ${visita.reagendas.length === 1 ? 'vez' : 'veces'}`;
    caja.appendChild(s);

    visita.reagendas.slice().reverse().forEach(r => {
        const item = document.createElement('div');
        item.className = 'historial-item';

        const cambio = document.createElement('p');
        cambio.className = 'mono';
        cambio.textContent = `${r.antes.dia} ${r.antes.hora_inicio}–${r.antes.hora_fin}  →  ${r.despues.dia} ${r.despues.hora_inicio}–${r.despues.hora_fin}`;

        const meta = document.createElement('p');
        meta.className = 'historial-meta';
        meta.textContent = `${r.motivo} · ${r.usuario || 'Sin usuario'} · ${new Date(r.momento).toLocaleString('es-MX')}`;

        item.append(cambio, meta);
        caja.appendChild(item);
    });
    return caja;
}

function listaSectores(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Sectores · ${visita.sectores.length}`;
    caja.appendChild(lbl);

    if (visita.sectores.length === 0) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = 'Agrega los sectores que vas a trabajar.';
        caja.appendChild(p);
    }

    const lista = document.createElement('div');
    lista.className = 'sectores';
    visita.sectores.forEach(s => lista.appendChild(filaSector(visita, s)));
    caja.appendChild(lista);

    if (estadoDe(visita) !== ESTADOS.CANCELADA) caja.appendChild(chipsAgregarSector(visita));
    return caja;
}

function filaSector(visita, sector) {
    const est = estadoSector(visita, sector);
    const pendientes = (sector.actividades || [])
        .filter(a => reglaDe(a.tipo).evidencia && a.evidencia?.estado !== 'subida').length;

    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'sector-fila';
    fila.dataset.sector = sector.id;
    fila.dataset.estado = est;

    const txt = document.createElement('span');
    txt.className = 'sector-fila-txt';

    const nombre = document.createElement('span');
    nombre.className = 'sector-fila-nombre';
    nombre.textContent = sector.nombre;

    const resumen = document.createElement('span');
    resumen.className = 'sector-fila-resumen';
    resumen.textContent = [sector.objetivo, (sector.origen || []).join(', ')]
        .filter(Boolean).join(' · ') || 'Sin objetivo';

    txt.append(nombre, resumen);

    const meta = document.createElement('span');
    meta.className = 'sector-fila-meta';

    const chip = document.createElement('span');
    chip.className = `sector-estado es-${est}`;
    chip.textContent = etiquetaSector(est);
    meta.appendChild(chip);

    if (pendientes > 0) {
        const p = document.createElement('span');
        p.className = 'pill st-faltan-evidencias';
        p.textContent = `${pendientes} evid.`;
        meta.appendChild(p);
    }

    const flecha = document.createElement('span');
    flecha.className = 'sector-fila-flecha';
    flecha.textContent = '›';

    fila.append(txt, meta, flecha);
    fila.addEventListener('click', () => { sectorId = sector.id; pintar(); });
    return fila;
}

function chipsAgregarSector(visita) {
    const caja = document.createElement('div');
    caja.className = 'agregar-sector';

    const catalogo = (leerCatalogo() || {}).sectores || [];
    const usados = visita.sectores.map(s => s.nombre);
    const libres = catalogo.filter(s => !usados.includes(s));

    if (libres.length === 0) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = catalogo.length === 0
            ? 'El catálogo de sectores no ha cargado todavía.'
            : 'Ya agregaste todos los sectores del catálogo.';
        caja.appendChild(p);
        return caja;
    }

    const chips = document.createElement('div');
    chips.className = 'chips';
    libres.forEach(nombre => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip add';
        chip.textContent = nombre;
        chip.addEventListener('click', () => {
            const id = nuevoId('s');
            editar(v => {
                v.sectores.push({ id, nombre, objetivo: '', origen: [], actividades: [] });
            });
            sectorId = id;   // se entra directo: agregarlo sin objetivo no sirve de nada
            pintar();
        });
        chips.appendChild(chip);
    });

    caja.appendChild(chips);
    return caja;
}

// ---------- nivel sector ----------

function cabeceraSector(visita, sector) {
    const head = document.createElement('div');
    head.className = 'drawer-head';

    const volver = document.createElement('button');
    volver.type = 'button';
    volver.className = 'icon-btn volver';
    volver.setAttribute('aria-label', 'Volver a la visita');
    volver.textContent = '‹';
    volver.addEventListener('click', () => { sectorId = null; pintar(); });

    const izq = document.createElement('div');
    izq.className = 'drawer-head-txt';
    const h = document.createElement('h3');
    h.textContent = sector.nombre;
    const sub = document.createElement('p');
    sub.className = 'drawer-sub';
    sub.textContent = `${visita.hospital || 'Sin hospital'} · ${visita.hora_inicio}`;

    const est = estadoSector(visita, sector);
    const chip = document.createElement('span');
    chip.className = `sector-estado es-${est}`;
    chip.textContent = etiquetaSector(est);

    izq.append(h, sub, chip);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '✕';
    x.addEventListener('click', cerrar);

    head.append(volver, izq, x);
    return head;
}

function cuerpoSector(visita, sector) {
    const body = document.createElement('div');
    body.className = 'drawer-body';
    const enV = (v) => v.sectores.find(s => s.id === sector.id);

    body.append(
        campoTexto('Objetivo', sector.objetivo, '¿Qué se busca lograr aquí?',
            (t) => editar(v => { enV(v).objetivo = t; })),
        chipsOrigen(sector, enV),
        bloqueActividades(visita, sector)
    );

    if (estadoDe(visita) !== ESTADOS.CANCELADA && (sector.actividades || []).length === 0) {
        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'btn-txt peligro';
        quitar.textContent = 'Quitar este sector de la visita';
        quitar.addEventListener('click', () => {
            sectorId = null;
            editar(v => { v.sectores = v.sectores.filter(s => s.id !== sector.id); }, { repintar: true });
        });
        body.appendChild(quitar);
    }
    return body;
}

function chipsOrigen(sector, enV) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Origen de la actividad';

    const chips = document.createElement('div');
    chips.className = 'chips';

    origenes().forEach(origen => {
        const activo = (sector.origen || []).includes(origen);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (activo ? ' on' : '');
        chip.setAttribute('aria-pressed', String(activo));
        chip.textContent = origen;
        chip.addEventListener('click', () => editar(v => {
            const s = enV(v);
            s.origen = activo ? s.origen.filter(o => o !== origen) : [...(s.origen || []), origen];
        }, { repintar: true }));
        chips.appendChild(chip);
    });

    caja.append(lbl, chips);
    return caja;
}

// ---------- actividades ----------

function bloqueActividades(visita, sector) {
    const caja = document.createElement('div');
    caja.className = 'campo actividades';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Actividades · ${sector.actividades.length}`;
    caja.appendChild(lbl);

    const bloqueo = bloqueoParaActividades(visita);
    if (bloqueo) {
        const p = document.createElement('p');
        p.className = 'aviso';
        p.textContent = bloqueo;
        caja.appendChild(p);
        return caja;
    }

    if (sector.actividades.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'ayuda';
        vacio.textContent = 'Aún no registras actividades en este sector.';
        caja.appendChild(vacio);
    }

    sector.actividades.forEach((act, i) => caja.appendChild(tarjetaActividad(visita, sector, act, i + 1)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Registrar actividad';
    add.addEventListener('click', () => {
        const id = nuevoId('a');
        editar(v => {
            v.sectores.find(s => s.id === sector.id).actividades.push({
                id, tipo: '', area_visitada: '', creada: new Date().toISOString(),
                contacto: { nombre: '', cargo: '', servicio: '' },
                materiales: [],
                evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' }
            });
        }, { repintar: true });
        registrar(TIPOS.ACTIVIDAD, obtenerVisita(visitaId), { sector: sector.nombre, id_actividad: id });
    });
    caja.appendChild(add);

    return caja;
}

function tarjetaActividad(visita, sector, act, numero) {
    const regla = reglaDe(act.tipo);
    const enA = (v) => v.sectores.find(s => s.id === sector.id).actividades.find(a => a.id === act.id);

    const card = document.createElement('div');
    card.className = 'act-card';

    const head = document.createElement('div');
    head.className = 'act-head';
    const n = document.createElement('span');
    n.className = 'act-n';
    n.textContent = numero;
    const titulo = document.createElement('span');
    titulo.className = 'act-titulo';
    titulo.textContent = act.tipo || 'Sin tipo';

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'icon-btn';
    borrar.setAttribute('aria-label', 'Borrar actividad');
    borrar.textContent = '✕';
    borrar.addEventListener('click', async () => {
        if (!confirm(`¿Borrar esta actividad de ${sector.nombre}?`)) return;
        // El archivo primero: si se quita la actividad antes, el blob queda huérfano.
        await quitarEvidencia(act.id).catch(() => {});
        editar(v => {
            const s = v.sectores.find(x => x.id === sector.id);
            s.actividades = s.actividades.filter(a => a.id !== act.id);
        }, { repintar: true });
    });
    head.append(n, titulo, borrar);

    const body = document.createElement('div');
    body.className = 'act-body';

    // El sector es contexto, no un campo: la app ya sabe desde dónde entraste.
    const ctx = document.createElement('p');
    ctx.className = 'act-ctx mono';
    ctx.textContent = `SECTOR · ${sector.nombre}`;
    body.appendChild(ctx);

    body.appendChild(selectTipo(act, (tipo) => editar(v => { enA(v).tipo = tipo; }, { repintar: true })));
    // La regla se DECLARA antes de que los campos aparezcan: el formulario no cambia por magia.
    body.appendChild(barraRegla(act.tipo, regla));

    body.appendChild(selectSimple('Área visitada', areas(), act.area_visitada,
        (a) => editar(v => { enA(v).area_visitada = a; })));

    body.appendChild(bloqueContacto(act, enA));

    if (regla.materiales) body.appendChild(bloqueMateriales(visita, sector, act, enA));
    if (regla.evidencia) body.appendChild(controlEvidencia(act, { alCambiar: pintar, alToast }));

    card.append(head, body);
    return card;
}

/**
 * Contacto responsable, uno POR ACTIVIDAD. Aunque sea la misma persona en varias, se guarda
 * en cada una: quién atendió QUÉ es justo lo que se querrá reportar después.
 */
function bloqueContacto(act, enA) {
    const caja = document.createElement('div');
    caja.className = 'contacto';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Contacto responsable';
    caja.appendChild(lbl);

    const c = act.contacto || {};
    const set = (campo) => (t) => editar(v => {
        const a = enA(v);
        a.contacto = { ...(a.contacto || {}), [campo]: t };
        if (campo === 'nombre' && t.trim()) {
            registrar(TIPOS.CONTACTO, obtenerVisita(visitaId), { contacto: t.trim(), id_actividad: a.id });
        }
    });

    caja.appendChild(campoTexto('Nombre', c.nombre, 'Dr. Juan Pérez', set('nombre')));

    const fila = document.createElement('div');
    fila.className = 'grid-2';
    fila.append(
        campoTexto('Cargo', c.cargo, 'Jefa de piso', set('cargo')),
        campoTexto('Servicio', c.servicio, 'Quirófano', set('servicio'))
    );
    caja.appendChild(fila);
    return caja;
}

// ---------- materiales ----------

function bloqueMateriales(visita, sector, act, enA) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Materiales · ${(act.materiales || []).length}`;
    caja.appendChild(lbl);

    (act.materiales || []).forEach(m => caja.appendChild(filaMaterial(m, act, enA)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Agregar material';
    add.addEventListener('click', () => abrirModalMaterial(visita, sector, act, enA));
    caja.appendChild(add);

    if (!hayMateriales(sector.nombre)) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = `No hay materiales de ${sector.nombre} en el catálogo todavía.`;
        caja.appendChild(p);
    }
    return caja;
}

function filaMaterial(m, act, enA) {
    const fila = document.createElement('div');
    fila.className = 'mat-fila';

    const txt = document.createElement('span');
    txt.className = 'mat-txt';

    const nombre = document.createElement('span');
    nombre.className = 'mat-nombre';
    nombre.textContent = m.material;

    const meta = document.createElement('span');
    meta.className = 'mat-meta mono';
    meta.textContent = [
        [m.cantidad, m.unidad].filter(Boolean).join(' '),
        m.origen
    ].filter(Boolean).join(' · ');

    txt.append(nombre, meta);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', `Quitar ${m.material}`);
    x.textContent = '✕';
    x.addEventListener('click', () => editar(v => {
        const a = enA(v);
        a.materiales = a.materiales.filter(x2 => x2.id !== m.id);
    }, { repintar: true }));

    fila.append(txt, x);
    return fila;
}

/**
 * Ventana propia para el material: buscador + cantidad + unidad + origen. Es una decisión
 * consciente — meter esto inline dentro de la actividad la volvería un formulario largo, que
 * es justo lo que hay que evitar de pie en un pasillo.
 */
function abrirModalMaterial(visita, sector, act, enA) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja';

    const head = document.createElement('div');
    head.className = 'modal-head';
    const h = document.createElement('h3');
    h.textContent = 'Agregar material';
    const sub = document.createElement('span');
    sub.className = 'eyebrow';
    sub.textContent = sector.nombre;   // solo se buscan materiales de ESTE sector
    const cerrarBtn = document.createElement('button');
    cerrarBtn.type = 'button';
    cerrarBtn.className = 'icon-btn';
    cerrarBtn.setAttribute('aria-label', 'Cerrar');
    cerrarBtn.textContent = '✕';
    cerrarBtn.addEventListener('click', () => modal.remove());
    const izq = document.createElement('div');
    izq.append(h, sub);
    head.append(izq, cerrarBtn);

    const body = document.createElement('div');
    body.className = 'modal-body';

    let elegido = null;

    // --- paso 1: buscar ---
    const busq = document.createElement('div');
    busq.className = 'campo';
    const bl = document.createElement('label');
    bl.className = 'campo-lbl';
    bl.textContent = 'Material';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp';
    inp.placeholder = 'Escribe para buscar…';
    inp.autocomplete = 'off';
    bl.appendChild(inp);
    const res = document.createElement('div');
    res.className = 'mat-res';
    busq.append(bl, res);

    // --- paso 2: los datos, que solo aparecen al elegir ---
    const detalle = document.createElement('div');
    detalle.className = 'mat-detalle';
    detalle.hidden = true;

    const cantidad = document.createElement('input');
    cantidad.type = 'number';
    cantidad.min = '0';
    cantidad.step = 'any';
    cantidad.className = 'inp mono';
    cantidad.placeholder = '0';

    const unidad = document.createElement('select');
    unidad.className = 'inp';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Unidad…';
    unidad.appendChild(vacio);
    unidades().forEach(u => {
        const o = document.createElement('option');
        o.value = u; o.textContent = u;
        unidad.appendChild(o);
    });

    const origen = document.createElement('input');
    origen.type = 'text';
    origen.className = 'inp';
    origen.placeholder = '4500123456 o Juan Pérez';

    const guardar = document.createElement('button');
    guardar.type = 'button';
    guardar.className = 'btn';
    guardar.textContent = 'Agregar';

    const pintarRes = () => {
        const encontrados = buscarMateriales(sector.nombre, inp.value);
        res.innerHTML = '';

        if (encontrados.length === 0) {
            const p = document.createElement('p');
            p.className = 'ayuda';
            p.textContent = inp.value.trim()
                ? `Ningún material de ${sector.nombre} coincide.`
                : `No hay materiales de ${sector.nombre} en el catálogo.`;
            res.appendChild(p);
            return;
        }

        encontrados.forEach(m => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mat-opt' + (elegido?.material === m.material ? ' is-sel' : '');
            // Solo "Material y Nombre": nada más, para no ensuciar la lista.
            b.append(...resaltar(m.material, inp.value.trim()));
            b.addEventListener('click', () => {
                elegido = m;
                inp.value = m.material;
                detalle.hidden = false;
                pintarRes();
                cantidad.focus();
            });
            res.appendChild(b);
        });
    };

    inp.addEventListener('input', () => { elegido = null; detalle.hidden = true; pintarRes(); });

    guardar.addEventListener('click', () => {
        if (!elegido) return alToast('Elige un material de la lista.', { estado: 'sin-registrar' });
        if (!cantidad.value || Number(cantidad.value) <= 0) {
            return alToast('Indica cuánto entregaste.', { estado: 'sin-registrar' });
        }
        if (!unidad.value) return alToast('Elige la unidad de medida.', { estado: 'sin-registrar' });

        const nuevo = {
            id: nuevoId('m'),
            material: elegido.material,
            cantidad: cantidad.value,
            unidad: unidad.value,
            origen: origen.value.trim()
        };
        editar(v => { enA(v).materiales = [...(enA(v).materiales || []), nuevo]; }, { repintar: true });
        registrar(TIPOS.MATERIAL, obtenerVisita(visitaId), {
            sector: sector.nombre, material: nuevo.material,
            cantidad: nuevo.cantidad, unidad: nuevo.unidad, origen: nuevo.origen
        });
        modal.remove();
    });

    detalle.append(
        envolver('Cantidad', cantidad),
        envolver('Unidad de medida', unidad),
        envolver('Origen del material', origen, 'Folio SAP de mercancía sin cargo, o quién te lo entregó'),
        guardar
    );

    body.append(busq, detalle);
    caja.append(head, body);
    modal.appendChild(caja);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.addEventListener('keydown', function esc(e) {
        if (e.key === 'Escape' && document.body.contains(modal)) {
            e.stopPropagation();
            modal.remove();
            document.removeEventListener('keydown', esc);
        }
    });

    el.raiz.appendChild(modal);
    pintarRes();
    inp.focus();
}

function envolver(etiqueta, control, ayuda) {
    const campo = document.createElement('div');
    campo.className = 'campo';
    const l = document.createElement('label');
    l.className = 'campo-lbl';
    l.textContent = etiqueta;
    l.appendChild(control);
    campo.appendChild(l);
    if (ayuda) {
        const a = document.createElement('p');
        a.className = 'ayuda';
        a.textContent = ayuda;
        campo.appendChild(a);
    }
    return campo;
}

// ---------- tipo y regla ----------

function selectTipo(act, onCambio) {
    const opciones = tiposActividad().map(t => t.nombre);
    const huerfano = act.tipo && !opciones.includes(act.tipo);
    return selectSimple('Tipo de actividad', opciones, act.tipo, onCambio,
        huerfano ? `${act.tipo} (ya no está en el catálogo)` : null);
}

function selectSimple(etiqueta, opciones, valor, onCambio, extra = null) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const lbl = document.createElement('label');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;

    const sel = document.createElement('select');
    sel.className = 'inp';

    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Elige…';
    sel.appendChild(vacio);

    opciones.forEach(o => {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        if (o === valor) op.selected = true;
        sel.appendChild(op);
    });

    // Un valor que ya no está en el catálogo no se pierde en silencio.
    if (extra) {
        const op = document.createElement('option');
        op.value = valor;
        op.textContent = extra;
        op.selected = true;
        sel.appendChild(op);
    }

    sel.addEventListener('change', () => onCambio(sel.value));
    lbl.appendChild(sel);
    campo.appendChild(lbl);
    return campo;
}

function barraRegla(tipo, regla) {
    const barra = document.createElement('p');
    barra.className = 'regla';

    if (!tipo) {
        barra.textContent = 'ELIGE UN TIPO Y APARECERÁ LO QUE PIDE';
        return barra;
    }
    const partes = camposExtra(tipo).map(c => c.toUpperCase());
    if (partes.length === 0) {
        barra.textContent = 'ESTE TIPO NO PIDE NADA MÁS';
        return barra;
    }
    barra.classList.add('es-activa');
    barra.textContent = `ESTE TIPO PIDE ${partes.join(' · ')}`;
    return barra;
}

// ---------- reagendar ----------

function bloqueReagendar(visita) {
    const caja = document.createElement('div');
    caja.className = 'reagendar';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Reagendar';

    const dia = document.createElement('input');
    dia.type = 'date';
    dia.className = 'inp';
    dia.value = visita.dia;

    const ini = document.createElement('input');
    ini.type = 'time';
    ini.className = 'inp mono';
    ini.value = visita.hora_inicio;

    const fin = document.createElement('input');
    fin.type = 'time';
    fin.className = 'inp mono';
    fin.value = visita.hora_fin;

    // Mover el inicio MUEVE el bloque: reagendar corre la visita, no la estira.
    ini.addEventListener('change', () => {
        const previa = aMinutos(visita.hora_fin) - aMinutos(visita.hora_inicio);
        fin.value = sumarMinutos(ini.value, previa > 0 ? previa : 60);
    });

    const horas = document.createElement('div');
    horas.className = 'horas';
    const guion = document.createElement('span');
    guion.className = 'guion';
    guion.textContent = '–';
    horas.append(ini, guion, fin);

    const motivo = document.createElement('input');
    motivo.type = 'text';
    motivo.className = 'inp';
    motivo.placeholder = '¿Por qué se mueve?';

    const aplicar = document.createElement('button');
    aplicar.type = 'button';
    aplicar.className = 'btn';
    aplicar.textContent = 'Reagendar';
    aplicar.addEventListener('click', () => {
        const r = reagendarVisita(visitaId, {
            dia: dia.value, hora_inicio: ini.value, hora_fin: fin.value, motivo: motivo.value
        });
        if (!r.ok) return alToast(r.error, { estado: 'sin-registrar' });
        reagendando = false;
        alToast('Visita reagendada. Queda el registro del cambio.', { estado: 'completa' });
        alCambiar();
        pintar();
    });

    caja.append(lbl, envolver('Fecha', dia), envolver('Horario', horas),
                envolver('Motivo del cambio', motivo, 'Obligatorio: queda en el historial'), aplicar);
    return caja;
}

// ---------- pie ----------

function pie(visita) {
    const foot = document.createElement('div');
    foot.className = 'drawer-foot';

    const saving = document.createElement('span');
    saving.className = 'saving';
    const led = document.createElement('span');
    led.className = 'led';
    const txt = document.createElement('span');
    txt.className = 'saving-txt';
    txt.textContent = visita.borrador ? 'Sin guardar' : 'Guardado local';
    saving.append(led, txt);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    foot.append(saving, spacer);

    if (sectorId) {
        const volver = document.createElement('button');
        volver.type = 'button';
        volver.className = 'btn';
        volver.textContent = '‹ Volver a la visita';
        volver.addEventListener('click', () => { sectorId = null; pintar(); });
        foot.appendChild(volver);
        return foot;
    }

    if (!visita.borrador) {
        const dup = document.createElement('button');
        dup.type = 'button';
        dup.className = 'btn-txt';
        dup.textContent = '⧉ Duplicar';
        dup.addEventListener('click', () => duplicarVisita(visita));
        foot.appendChild(dup);
    }

    const cancelable = !visita.borrador && estadoDe(visita) !== ESTADOS.CANCELADA && !tieneCheckOut(visita);
    if (cancelable) {
        const reag = document.createElement('button');
        reag.type = 'button';
        reag.className = 'btn-txt';
        reag.textContent = reagendando ? 'Cerrar' : '⟳ Reagendar';
        reag.addEventListener('click', () => { reagendando = !reagendando; pintar(); });

        const cancelar = document.createElement('button');
        cancelar.type = 'button';
        cancelar.className = 'btn-txt peligro';
        cancelar.textContent = '⊘ Cancelar';
        cancelar.addEventListener('click', () => pedirCancelacion(visita));

        foot.append(reag, cancelar);
    }

    const listo = document.createElement('button');
    listo.type = 'button';
    listo.className = 'btn';
    listo.textContent = 'Listo';
    listo.addEventListener('click', cerrar);
    foot.appendChild(listo);

    return foot;
}

/** Doble confirmación: cancelar una visita nunca debe pasar por accidente. */
function pedirCancelacion(visita) {
    if (!confirm(`¿Cancelar la visita a ${visita.cliente || 'este cliente'}?\n\nNo se borra: queda en el calendario como registro.`)) return;

    const motivo = prompt('¿Por qué se cancela? (queda en el registro)');
    if (motivo === null) return;

    const r = cancelarVisita(visitaId, motivo);
    if (!r.ok) return alToast(r.error, { estado: 'sin-registrar' });

    alToast('Visita cancelada.', {
        estado: 'programada',
        accion: { texto: 'Deshacer', fn: () => { reactivarVisita(visitaId); alCambiar(); pintar(); } }
    });
    alCambiar();
    pintar();
}

/**
 * Una visita se repite mucho por cliente: mismo hospital, mismos sectores. Se copia la
 * estructura (sectores con su objetivo y origen) pero NUNCA lo que pasó en sitio —actividades,
 * check-in/out, evidencias— porque eso es el registro de una visita distinta.
 */
function duplicarVisita(visita) {
    const sesion = sesionActual();
    const nueva = agregarVisita({
        id: nuevoId('v'),
        educador: sesion?.nombre || visita.educador || '',
        educador_correo: sesion?.correo || visita.educador_correo || '',
        cliente: visita.cliente || '', hospital: visita.hospital || '',
        dia: visita.dia, hora_inicio: visita.hora_inicio, hora_fin: visita.hora_fin,
        estado: ESTADOS.PROGRAMADA,
        reagendas: [],
        sectores: (visita.sectores || []).map(s => ({
            id: nuevoId('s'), nombre: s.nombre, objetivo: s.objetivo || '',
            origen: [...(s.origen || [])], actividades: []
        })),
        sincronizado: false,
        borrador: true
    });
    cerrar();
    abrir(nueva.id);
}

// ---------- campos ----------

function campoCliente(visita) {
    const clientes = (leerCatalogo() || {}).clientes || [];
    return combo({
        etiqueta: 'Cliente', valor: visita.cliente, placeholder: 'Busca N° o razón social…',
        opciones: (q) => filtrar(clientes, q),
        total: clientes.length,
        onElegir: (c) => editar(v => { v.cliente = c; }),
        onEscribir: (texto) => editar(v => { v.cliente = texto; })
    });
}

function campoHospital(visita) {
    const previos = historialHospitales();
    return combo({
        etiqueta: 'Hospital', valor: visita.hospital, placeholder: 'Escribe el hospital…',
        opciones: (q) => filtrar(previos, q),
        ayuda: previos.length ? 'Se sugiere lo que ya has escrito antes' : null,
        onElegir: (h) => editar(v => { v.hospital = h; }),
        onEscribir: (texto) => editar(v => { v.hospital = texto; })
    });
}

function campoFecha(visita) {
    const inp = document.createElement('input');
    inp.type = 'date';
    inp.className = 'inp';
    inp.value = visita.dia || '';
    inp.addEventListener('change', () => editar(v => { v.dia = inp.value; }, { repintar: true }));
    return envolver('Fecha', inp);
}

function campoHoras(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Horario';

    const fila = document.createElement('div');
    fila.className = 'horas';

    const ini = document.createElement('input');
    ini.type = 'time';
    ini.className = 'inp mono';
    ini.value = visita.hora_inicio || '';
    ini.setAttribute('aria-label', 'Hora de inicio');

    const guion = document.createElement('span');
    guion.className = 'guion';
    guion.textContent = '–';

    const fin = document.createElement('input');
    fin.type = 'time';
    fin.className = 'inp mono';
    fin.value = visita.hora_fin || '';
    fin.setAttribute('aria-label', 'Hora de fin');

    // El fin nunca se calcula solo: una capacitación de 2h y una entrega de 20min no duran
    // igual. Pero mover el inicio MUEVE el bloque conservando la duración.
    ini.addEventListener('change', () => {
        const duracion = aMinutos(visita.hora_fin) - aMinutos(visita.hora_inicio);
        editar(v => {
            v.hora_inicio = ini.value;
            v.hora_fin = sumarMinutos(ini.value, duracion > 0 ? duracion : 60);
        }, { repintar: true });
    });

    fin.addEventListener('change', () => {
        if (aMinutos(fin.value) <= aMinutos(visita.hora_inicio)) {
            alToast('La hora de fin debe ser posterior al inicio.', { estado: 'sin-registrar' });
            fin.value = visita.hora_fin;
            return;
        }
        editar(v => { v.hora_fin = fin.value; }, { repintar: true });
    });

    fila.append(ini, guion, fin);
    caja.append(lbl, fila);

    const aviso = avisoSolape(visita);
    if (aviso) caja.appendChild(aviso);
    return caja;
}

/** Avisa, no bloquea: a veces las visitas se solapan de verdad. */
function avisoSolape(visita) {
    const vivas = leerVisitas().filter(v => estadoDe(v) !== ESTADOS.CANCELADA);
    const choques = buscarSolapes(vivas, visita, visita.id);
    if (choques.length === 0) return null;

    const caja = document.createElement('p');
    caja.className = 'aviso';
    const quien = choques.map(v => `${v.hora_inicio} ${v.cliente || 'Sin cliente'}`).join(', ');
    caja.textContent = choques.length === 1
        ? `Se encima con ${quien}.`
        : `Se encima con ${choques.length} visitas: ${quien}.`;
    return caja;
}

function campoTexto(etiqueta, valor, placeholder, onCambio, mono = false) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp' + (mono ? ' mono' : '');
    inp.value = valor || '';
    inp.placeholder = placeholder;
    inp.addEventListener('input', () => onCambio(inp.value));
    return envolver(etiqueta, inp);
}

/** Combobox con filtro. `opciones(q)` llega ya recortado: 11k clientes no caben en el DOM. */
function combo({ etiqueta, valor, placeholder, opciones, onElegir, onEscribir, ayuda, total }) {
    const campo = document.createElement('div');
    campo.className = 'campo combo';

    const lbl = document.createElement('label');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp';
    inp.value = valor || '';
    inp.placeholder = placeholder;
    inp.autocomplete = 'off';
    lbl.appendChild(inp);

    const pop = document.createElement('div');
    pop.className = 'combo-pop';
    pop.hidden = true;

    let activo = -1;
    const cerrarPop = () => { pop.hidden = true; activo = -1; };

    const abrirPop = () => {
        const q = inp.value.trim();
        const res = opciones(q);
        pop.innerHTML = '';
        if (res.length === 0) return cerrarPop();

        res.forEach((op, i) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'combo-opt' + (i === activo ? ' is-active' : '');
            item.append(...resaltar(op, q));
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                inp.value = op;
                onElegir(op);
                cerrarPop();
            });
            pop.appendChild(item);
        });

        if (total && total > res.length) {
            const foot = document.createElement('div');
            foot.className = 'combo-foot';
            foot.textContent = `${total.toLocaleString('es-MX')} en total · ${res.length}${res.length === MAX_SUGERENCIAS ? '+' : ''} coincidencias`;
            pop.appendChild(foot);
        }
        pop.hidden = false;
    };

    inp.addEventListener('focus', abrirPop);
    inp.addEventListener('input', () => { onEscribir(inp.value); abrirPop(); });
    inp.addEventListener('blur', () => setTimeout(cerrarPop, 120));

    inp.addEventListener('keydown', (e) => {
        const items = Array.from(pop.querySelectorAll('.combo-opt'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (pop.hidden) return abrirPop();
            activo = Math.max(0, Math.min(items.length - 1, activo + (e.key === 'ArrowDown' ? 1 : -1)));
            items.forEach((it, i) => it.classList.toggle('is-active', i === activo));
            items[activo]?.scrollIntoView({ block: 'nearest' });
        } else if (e.key === 'Enter' && activo >= 0 && !pop.hidden) {
            e.preventDefault();
            items[activo].dispatchEvent(new MouseEvent('mousedown'));
        } else if (e.key === 'Escape' && !pop.hidden) {
            e.stopPropagation();
            cerrarPop();
        }
    });

    campo.append(lbl, pop);
    if (ayuda) {
        const a = document.createElement('p');
        a.className = 'ayuda';
        a.textContent = ayuda;
        campo.appendChild(a);
    }
    return campo;
}

/**
 * Resalta la coincidencia sin innerHTML.
 *
 * Marca cada PALABRA por separado, no la cadena entera: el buscador empareja palabras sueltas
 * y en cualquier orden, así que "gasa 10x10" encuentra "GASA SIMPLE 10X10 CM" — pero un
 * indexOf literal no hallaría nada ahí y la lista se vería sin resaltar, como si no hubiera
 * entendido la búsqueda.
 */
function resaltar(texto, q) {
    const palabras = (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return [document.createTextNode(texto)];

    // Se buscan los tramos a marcar y se fusionan los que se toquen o solapen.
    const bajo = texto.toLowerCase();
    const tramos = [];
    palabras.forEach(p => {
        let i = bajo.indexOf(p);
        while (i !== -1) {
            tramos.push([i, i + p.length]);
            i = bajo.indexOf(p, i + p.length);
        }
    });
    if (tramos.length === 0) return [document.createTextNode(texto)];

    tramos.sort((a, b) => a[0] - b[0]);
    const unidos = [tramos[0]];
    for (const [ini, fin] of tramos.slice(1)) {
        const ultimo = unidos[unidos.length - 1];
        if (ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin);
        else unidos.push([ini, fin]);
    }

    const nodos = [];
    let cursor = 0;
    for (const [ini, fin] of unidos) {
        if (ini > cursor) nodos.push(document.createTextNode(texto.slice(cursor, ini)));
        const mark = document.createElement('mark');
        mark.textContent = texto.slice(ini, fin);
        nodos.push(mark);
        cursor = fin;
    }
    if (cursor < texto.length) nodos.push(document.createTextNode(texto.slice(cursor)));
    return nodos;
}

function filtrar(lista, q) {
    if (!q) return lista.slice(0, MAX_SUGERENCIAS);
    const n = q.toLowerCase();
    const salida = [];
    for (const item of lista) {
        if (item.toLowerCase().includes(n)) {
            salida.push(item);
            if (salida.length === MAX_SUGERENCIAS) break;
        }
    }
    return salida;
}

// ---------- horas ----------

function sumarMinutos(hora, min) { return minutosAHora(aMinutos(hora) + min); }

function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
