/**
 * Drawer: agendar y editar una visita.
 *
 * Lateral en escritorio, bottom-sheet a altura completa en móvil. Nunca modal centrado:
 * al agendar la pregunta real es "¿dónde cabe esto?", y un modal tapa justo la respuesta.
 *
 * Guarda solo. No hay botón "Guardar" solitario porque no hay nada que confirmar: los datos
 * viven en el teléfono desde el primer trazo y suben cuando hay señal.
 */

import {
    leerVisitas, leerCatalogo, agregarVisita, actualizarVisita, obtenerVisita,
    eliminarVisita, nuevoId, historialHospitales
} from './storage.js';
import { buscarSolapes, estadoDe, detalleEstado, etiquetaEstado } from './estado.js';
import { tiposActividad, origenes, reglaDe, camposExtra } from './catalogos.js';
import { controlEvidencia, quitarEvidencia } from './evidencias.js';
import { etiquetaDiaLarga } from './fechas.js';

const MAX_SUGERENCIAS = 60;

let el = {};
let visitaId = null;
let alCambiar = () => {};
let alToast = () => {};
let guardadoTimer = null;

export function initDrawer({ onCambio, onToast } = {}) {
    alCambiar = onCambio || (() => {});
    alToast = onToast || (() => {});

    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    raiz.hidden = true;
    raiz.innerHTML = '';

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
        if (e.key === 'Escape' && !raiz.hidden) cerrar();
    });
}

export function hayDrawerAbierto() { return el.raiz && !el.raiz.hidden; }

export function abrirNuevaVisita({ dia, hora_inicio = '09:00' } = {}) {
    const cat = leerCatalogo() || {};
    const educador = cat.educadores?.[0] || {};

    const visita = agregarVisita({
        id: nuevoId('v'),
        // Mientras no exista Google Sign-In, el educador se elige a mano. Cuando llegue,
        // este campo desaparece: la sesión ya sabe quién eres.
        educador: '',
        educador_correo: '',
        cliente: '',
        hospital: '',
        dia: dia || new Date().toISOString().slice(0, 10),
        hora_inicio,
        hora_fin: sumarHoras(hora_inicio, 1),
        sectores: [],
        sincronizado: false,
        borrador: true
    });

    abrir(visita.id);
}

export function abrirVisita(id) { abrir(id); }

function abrir(id) {
    visitaId = id;
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    pintar();
    // El foco entra al panel para que Escape y el tabulado se queden dentro.
    el.panel.querySelector('input, button')?.focus({ preventScroll: true });
}

function cerrar() {
    const visita = obtenerVisita(visitaId);

    // Un borrador que nunca recibió cliente no es una visita: es un clic accidental.
    // Dejarlo guardado ensuciaría el calendario con tarjetas vacías.
    if (visita?.borrador && !visita.cliente?.trim()) {
        eliminarVisita(visita.id);
    }

    el.raiz.hidden = true;
    document.body.style.overflow = '';
    visitaId = null;
    alCambiar();
}

// ---------- guardado ----------

function editar(mutador, { repintar = false } = {}) {
    actualizarVisita(visitaId, (v) => { mutador(v); delete v.borrador; });
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
    el.panel.append(cabecera(visita), cuerpo(visita), pie(visita));
}

function cabecera(visita) {
    const head = document.createElement('div');
    head.className = 'drawer-head';

    const izq = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = visita.borrador ? 'Nueva visita' : (visita.cliente || 'Visita');
    const sub = document.createElement('span');
    sub.className = 'eyebrow';
    sub.textContent = etiquetaDiaLarga(visita.dia);
    izq.append(h, sub);

    // El estado no se elige aquí: se muestra porque se calcula solo.
    if (!visita.borrador) {
        const estado = estadoDe(visita);
        const pill = document.createElement('span');
        pill.className = `pill st-${estado}`;
        pill.textContent = detalleEstado(visita);
        izq.appendChild(pill);
    }

    const cerrarBtn = document.createElement('button');
    cerrarBtn.type = 'button';
    cerrarBtn.className = 'icon-btn';
    cerrarBtn.setAttribute('aria-label', 'Cerrar');
    cerrarBtn.textContent = '✕';
    cerrarBtn.addEventListener('click', cerrar);

    head.append(izq, cerrarBtn);
    return head;
}

function cuerpo(visita) {
    const body = document.createElement('div');
    body.className = 'drawer-body';

    body.append(
        campoEducador(visita),
        campoCliente(visita),
        campoHospital(visita),
        campoFecha(visita),
        campoHoras(visita),
        bloqueSectores(visita)
    );
    return body;
}

// --- educador (temporal, hasta Google Sign-In) ---

function campoEducador(visita) {
    const cat = leerCatalogo() || {};
    const nombres = (cat.educadores || []).map(e => e.nombre);

    return combo({
        etiqueta: 'Educador',
        valor: visita.educador,
        placeholder: 'Escribe tu nombre…',
        opciones: (q) => filtrar(nombres, q),
        onElegir: (nombre) => editar(v => {
            v.educador = nombre;
            v.educador_correo = (cat.educadores || []).find(e => e.nombre === nombre)?.correo || '';
        }),
        onEscribir: (texto) => editar(v => { v.educador = texto; })
    });
}

// --- cliente: 11,481 opciones ---

function campoCliente(visita) {
    const clientes = (leerCatalogo() || {}).clientes || [];

    return combo({
        etiqueta: 'Cliente',
        valor: visita.cliente,
        placeholder: 'Busca N° o razón social…',
        // No se pintan 11,481 opciones: se filtra y se recorta. El <datalist> anterior
        // metía todas al DOM y en celular se sentía.
        opciones: (q) => filtrar(clientes, q),
        total: clientes.length,
        onElegir: (c) => editar(v => { v.cliente = c; }, { repintar: true }),
        onEscribir: (texto) => editar(v => { v.cliente = texto; })
    });
}

// --- hospital: texto libre con memoria ---

function campoHospital(visita) {
    const previos = historialHospitales();

    return combo({
        etiqueta: 'Hospital',
        valor: visita.hospital,
        placeholder: 'Escribe el hospital…',
        opciones: (q) => filtrar(previos, q),
        // Es texto libre por decisión de producto. Sugerir lo ya escrito no impide que
        // "Hosp. Ángeles" y "H. Angeles" se dupliquen, pero hace que converja solo.
        ayuda: previos.length ? 'Se sugiere lo que ya has escrito antes' : null,
        libre: true,
        onElegir: (h) => editar(v => { v.hospital = h; }),
        onEscribir: (texto) => editar(v => { v.hospital = texto; })
    });
}

function campoFecha(visita) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const lbl = document.createElement('label');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Fecha';
    lbl.htmlFor = 'f-dia';

    const inp = document.createElement('input');
    inp.type = 'date';
    inp.id = 'f-dia';
    inp.className = 'inp';
    inp.value = visita.dia || '';
    inp.addEventListener('change', () => editar(v => { v.dia = inp.value; }, { repintar: true }));

    campo.append(lbl, inp);
    return campo;
}

// --- horas: inicio y fin independientes ---

function campoHoras(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('label');
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

    // Nunca se calcula el fin: una capacitación de 2h y una entrega de 20min no duran igual.
    // Pero si mueves el inicio más allá del fin, se arrastra el fin conservando la duración.
    ini.addEventListener('change', () => {
        const previa = duracionMin(visita.hora_inicio, visita.hora_fin);
        editar(v => {
            v.hora_inicio = ini.value;
            if (aMinutos(ini.value) >= aMinutos(v.hora_fin)) {
                v.hora_fin = sumarMinutos(ini.value, previa > 0 ? previa : 60);
            }
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
    const choques = buscarSolapes(leerVisitas(), visita, visita.id);
    if (choques.length === 0) return null;

    const caja = document.createElement('p');
    caja.className = 'aviso';
    const quien = choques.map(v => `${v.hora_inicio} ${v.cliente || 'Sin cliente'}`).join(', ');
    caja.textContent = choques.length === 1
        ? `Se encima con ${quien}.`
        : `Se encima con ${choques.length} visitas: ${quien}.`;
    return caja;
}

// ---------- sectores ----------

function bloqueSectores(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const head = document.createElement('div');
    head.className = 'campo-head';
    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Sectores · ${visita.sectores.length}`;
    head.appendChild(lbl);

    const lista = document.createElement('div');
    lista.className = 'sectores';
    visita.sectores.forEach(s => lista.appendChild(tarjetaSector(visita, s)));

    const add = document.createElement('div');
    add.className = 'chips';
    const catalogo = (leerCatalogo() || {}).sectores || [];
    const usados = visita.sectores.map(s => s.nombre);

    catalogo.filter(s => !usados.includes(s)).forEach(nombre => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip add';
        chip.textContent = nombre;
        chip.addEventListener('click', () => editar(v => {
            v.sectores.push({
                id: nuevoId('s'), nombre, objetivo: '',
                origen: [], solicitado_por: '', actividades: []
            });
        }, { repintar: true }));
        add.appendChild(chip);
    });

    if (add.children.length === 0 && catalogo.length > 0) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = 'Ya agregaste todos los sectores del catálogo.';
        add.appendChild(p);
    }

    caja.append(head, lista, add);
    return caja;
}

/** Sectores colapsados, por id. Vive fuera del modelo: es estado de vista, no dato. */
const colapsados = new Set();

function tarjetaSector(visita, sector) {
    const abierto = !colapsados.has(sector.id);

    const card = document.createElement('div');
    card.className = 'sector-card' + (abierto ? '' : ' cerrado');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'sector-head';
    head.setAttribute('aria-expanded', String(abierto));

    const flecha = document.createElement('span');
    flecha.className = 'sector-flecha';
    flecha.textContent = abierto ? '▾' : '▸';

    const h = document.createElement('h4');
    h.textContent = sector.nombre;

    const cuenta = document.createElement('span');
    cuenta.className = 'sector-cuenta';
    if (sector.actividades.length) cuenta.textContent = `${sector.actividades.length} act.`;

    head.append(flecha, h, cuenta);
    head.addEventListener('click', () => {
        if (abierto) colapsados.add(sector.id); else colapsados.delete(sector.id);
        pintar();
    });

    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'icon-btn';
    quitar.setAttribute('aria-label', `Quitar ${sector.nombre}`);
    quitar.textContent = '✕';
    quitar.addEventListener('click', async () => {
        if (sector.actividades.length &&
            !confirm(`${sector.nombre} tiene ${sector.actividades.length} actividad(es). ¿Quitarlo de todos modos?`)) return;
        for (const a of sector.actividades) await quitarEvidencia(a.id).catch(() => {});
        editar(v => { v.sectores = v.sectores.filter(s => s.id !== sector.id); }, { repintar: true });
    });

    const fila = document.createElement('div');
    fila.className = 'sector-head-fila';
    fila.append(head, quitar);
    card.appendChild(fila);

    if (!abierto) {
        // Colapsado deja un resumen de una línea: así diez sectores siguen siendo escaneables.
        const resumen = document.createElement('p');
        resumen.className = 'sector-resumen';
        resumen.textContent = [
            sector.objetivo,
            (sector.origen || []).join(', '),
            sector.solicitado_por
        ].filter(Boolean).join(' · ') || 'Sin objetivo definido';
        card.appendChild(resumen);
        return card;
    }

    const body = document.createElement('div');
    body.className = 'sector-body';
    body.append(
        campoTexto('Objetivo', sector.objetivo, '¿Qué se busca lograr aquí?',
            (t) => editar(v => { v.sectores.find(s => s.id === sector.id).objetivo = t; })),
        chipsOrigen(visita, sector),
        campoTexto('Solicitado por', sector.solicitado_por, 'Dr. Juan Pérez, Enfermera Jefe…',
            (t) => editar(v => { v.sectores.find(s => s.id === sector.id).solicitado_por = t; })),
        bloqueActividades(visita, sector)
    );

    card.appendChild(body);
    return card;
}

function chipsOrigen(visita, sector) {
    const cat = origenes();

    const caja = document.createElement('div');
    caja.className = 'campo';
    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Origen de la actividad';

    const chips = document.createElement('div');
    chips.className = 'chips';

    cat.forEach(origen => {
        const activo = (sector.origen || []).includes(origen);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip' + (activo ? ' on' : '');
        chip.setAttribute('aria-pressed', String(activo));
        chip.textContent = origen;
        chip.addEventListener('click', () => editar(v => {
            const s = v.sectores.find(x => x.id === sector.id);
            s.origen = activo ? s.origen.filter(o => o !== origen) : [...(s.origen || []), origen];
        }, { repintar: true }));
        chips.appendChild(chip);
    });

    caja.append(lbl, chips);
    return caja;
}

// ---------- actividades (lo que se registra EN SITIO) ----------

/**
 * Bloque de actividades de un sector. Un sector puede tener varias: una capacitación y una
 * entrega de muestras en GASAS son dos cosas distintas, con soporte distinto.
 */
function bloqueActividades(visita, sector) {
    const caja = document.createElement('div');
    caja.className = 'campo actividades';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Actividades · ${sector.actividades.length}`;
    caja.appendChild(lbl);

    if (sector.actividades.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'ayuda';
        vacio.textContent = 'Se registran al llegar con el cliente.';
        caja.appendChild(vacio);
    }

    sector.actividades.forEach((act, i) => {
        caja.appendChild(tarjetaActividad(visita, sector, act, i + 1));
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn-dashed';
    add.textContent = '+ Registrar actividad';
    add.addEventListener('click', () => editar(v => {
        v.sectores.find(s => s.id === sector.id).actividades.push({
            id: nuevoId('a'),
            tipo: '',
            texto: '',
            creada: new Date().toISOString(),
            materiales: [],
            folio: '',
            gerente: '',
            evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' }
        });
    }, { repintar: true }));

    caja.appendChild(add);
    return caja;
}

function tarjetaActividad(visita, sector, act, numero) {
    const regla = reglaDe(act.tipo);
    const enSector = (v) => v.sectores.find(s => s.id === sector.id).actividades.find(a => a.id === act.id);

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
        // El archivo primero: si se quita la actividad antes, el blob queda huérfano en
        // IndexedDB ocupando espacio para siempre.
        await quitarEvidencia(act.id).catch(() => {});
        editar(v => {
            const s = v.sectores.find(x => x.id === sector.id);
            s.actividades = s.actividades.filter(a => a.id !== act.id);
        }, { repintar: true });
    });

    head.append(n, titulo, borrar);

    const body = document.createElement('div');
    body.className = 'act-body';

    body.appendChild(selectTipo(act, (tipo) => editar(v => { enSector(v).tipo = tipo; }, { repintar: true })));

    // La regla se DECLARA antes de que los campos aparezcan: si no, el formulario cambiaría
    // solo y se sentiría magia en vez de una regla que alguien configuró.
    body.appendChild(barraRegla(act.tipo, regla));

    body.appendChild(campoTexto('Detalle', act.texto, '¿Qué hiciste exactamente?',
        (t) => editar(v => { enSector(v).texto = t; })));

    if (regla.materiales) {
        body.appendChild(listaMateriales(act, enSector));
    }
    if (regla.folio || regla.gerente) {
        const fila = document.createElement('div');
        fila.className = 'grid-2';
        if (regla.folio) {
            fila.appendChild(campoTexto('Folio', act.folio, 'FOL-00000',
                (t) => editar(v => { enSector(v).folio = t; }), true));
        }
        if (regla.gerente) {
            fila.appendChild(campoTexto('Gerente', act.gerente, 'Quién autoriza',
                (t) => editar(v => { enSector(v).gerente = t; })));
        }
        body.appendChild(fila);
    }
    if (regla.evidencia) {
        body.appendChild(controlEvidencia(act, { alCambiar: pintar, alToast: alToast }));
    }

    card.append(head, body);
    return card;
}

function selectTipo(act, onCambio) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const lbl = document.createElement('label');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Tipo de actividad';

    const sel = document.createElement('select');
    sel.className = 'inp';

    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Elige el tipo…';
    sel.appendChild(vacio);

    tiposActividad().forEach(t => {
        const op = document.createElement('option');
        op.value = t.nombre;
        op.textContent = t.nombre;
        if (t.nombre === act.tipo) op.selected = true;
        sel.appendChild(op);
    });

    // Un tipo que ya no está en el catálogo no se pierde en silencio.
    if (act.tipo && !tiposActividad().some(t => t.nombre === act.tipo)) {
        const huerfano = document.createElement('option');
        huerfano.value = act.tipo;
        huerfano.textContent = `${act.tipo} (ya no está en el catálogo)`;
        huerfano.selected = true;
        sel.appendChild(huerfano);
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

    const extra = camposExtra(tipo);
    const partes = [];
    if (regla.evidencia) partes.push('EVIDENCIA');
    partes.push(...extra.map(c => c.toUpperCase()));

    if (partes.length === 0) {
        barra.textContent = 'ESTE TIPO NO PIDE NADA MÁS';
        return barra;
    }
    barra.classList.add('es-activa');
    barra.textContent = `ESTE TIPO PIDE ${partes.join(' · ')}`;
    return barra;
}

function listaMateriales(act, enSector) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Materiales entregados';

    const chips = document.createElement('div');
    chips.className = 'chips';

    (act.materiales || []).forEach(m => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip on';
        chip.textContent = `${m} ✕`;
        chip.setAttribute('aria-label', `Quitar ${m}`);
        chip.addEventListener('click', () => editar(v => {
            const a = enSector(v);
            a.materiales = a.materiales.filter(x => x !== m);
        }, { repintar: true }));
        chips.appendChild(chip);
    });

    const fila = document.createElement('div');
    fila.className = 'horas';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp';
    inp.placeholder = 'Jeringa 5ml ×20';

    const agregar = () => {
        const texto = inp.value.trim();
        if (!texto) return;
        editar(v => {
            const a = enSector(v);
            a.materiales = [...(a.materiales || []), texto];
        }, { repintar: true });
    };

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-add';
    btn.textContent = '+';
    btn.setAttribute('aria-label', 'Agregar material');
    btn.addEventListener('click', agregar);

    inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); agregar(); }
    });

    fila.append(inp, btn);
    campo.append(lbl, chips, fila);
    return campo;
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

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'btn-txt peligro';
    borrar.textContent = 'Eliminar';
    borrar.addEventListener('click', () => {
        if (!confirm(`¿Eliminar la visita a ${visita.cliente || 'sin cliente'}?\n\nNo se borra de Google Sheets.`)) return;
        eliminarVisita(visita.id);
        el.raiz.hidden = true;
        document.body.style.overflow = '';
        visitaId = null;
        alCambiar();
        alToast('Visita eliminada.');
    });

    const listo = document.createElement('button');
    listo.type = 'button';
    listo.className = 'btn';
    listo.textContent = 'Listo';
    listo.addEventListener('click', cerrar);

    foot.append(saving, spacer, borrar, listo);
    return foot;
}

// ---------- piezas reutilizables ----------

function campoTexto(etiqueta, valor, placeholder, onCambio, mono = false) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const lbl = document.createElement('label');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp' + (mono ? ' mono' : '');   // los folios son códigos, no prosa
    inp.value = valor || '';
    inp.placeholder = placeholder;
    inp.addEventListener('input', () => onCambio(inp.value));

    lbl.appendChild(inp);
    campo.appendChild(lbl);
    return campo;
}

/**
 * Combobox con filtro. `opciones(q)` devuelve ya recortado: para 11k clientes no se puede
 * construir la lista completa en el DOM.
 */
function combo({ etiqueta, valor, placeholder, opciones, onElegir, onEscribir, ayuda, total, libre }) {
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

        if (res.length === 0) {
            cerrarPop();
            return;
        }

        res.forEach((op, i) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'combo-opt' + (i === activo ? ' is-active' : '');
            item.append(...resaltar(op, q));
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();          // no perder el foco antes del click
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
            e.stopPropagation();       // Escape cierra la lista, no el drawer
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

/** Parte el texto para poder resaltar la coincidencia sin innerHTML. */
function resaltar(texto, q) {
    if (!q) return [document.createTextNode(texto)];
    const i = texto.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return [document.createTextNode(texto)];

    const mark = document.createElement('mark');
    mark.textContent = texto.slice(i, i + q.length);
    return [
        document.createTextNode(texto.slice(0, i)),
        mark,
        document.createTextNode(texto.slice(i + q.length))
    ];
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

function aMinutos(hora) {
    const [h, m] = (hora || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function sumarMinutos(hora, min) {
    const total = Math.min(aMinutos(hora) + min, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function sumarHoras(hora, h) { return sumarMinutos(hora, h * 60); }

function duracionMin(ini, fin) { return aMinutos(fin) - aMinutos(ini); }
