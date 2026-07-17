/**
 * El calendario. Es el producto, no una pantalla del producto.
 *
 * Día y Semana comparten rejilla de horas: la visita se POSICIONA y ESCALA por su duración
 * real, que es la razón de que hora_inicio y hora_fin sean campos separados y ninguno se
 * calcule solo. Mes tira el eje de horas porque a esa escala la pregunta ya no es "a qué
 * hora" sino "dónde hay hueco". Móvil no encoge la rejilla: cambia de forma a agenda
 * vertical, porque 7 columnas con eje de horas son ilegibles en 390px.
 */

import { leerVisitas } from './storage.js';
import {
    ESTADOS, estadoDe, detalleEstado, duracionHoras, duracionTexto,
    inicioDe, finDe, repartirEnColumnas
} from './estado.js';
import {
    claveDia, claveHoy, desdeClave, sumarDias, sumarMeses, diasDeSemana,
    diasDeCuadriculaMes, etiquetaMes, etiquetaRangoSemana, etiquetaDiaLarga,
    inicialesDias, DIAS_ABREV, hora
} from './fechas.js';

// Ventana por defecto de la rejilla: la jornada donde de verdad ocurre el trabajo.
const HORA_MIN = 7;
const HORA_MAX = 19;
const ANCHO_MOVIL = 720;

// Ventana efectiva del render actual. Se recalcula por vista: una visita a las 06:00 o a
// las 21:00 tiene que verse, no dibujarse fuera del lienzo y desaparecer.
let ventana = { desde: HORA_MIN, hasta: HORA_MAX };

let modo = 'dia';
let cursor = new Date();
let alAbrirVisita = () => {};
let alCrearEn = () => {};
let el = {};

export function initCalendario({ onAbrirVisita, onCrearEn } = {}) {
    alAbrirVisita = onAbrirVisita || (() => {});
    alCrearEn = onCrearEn || (() => {});

    el = {
        cal: document.getElementById('cal'),
        titulo: document.getElementById('cal-titulo'),
        anterior: document.getElementById('cal-anterior'),
        siguiente: document.getElementById('cal-siguiente'),
        hoy: document.getElementById('cal-hoy'),
        modos: document.getElementById('cal-modo')
    };

    el.anterior.addEventListener('click', () => mover(-1));
    el.siguiente.addEventListener('click', () => mover(1));
    el.hoy.addEventListener('click', irAHoy);

    el.modos.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => setModo(btn.dataset.modo));
    });

    // El móvil no tiene rejilla: forzar "semana" ahí no significaría nada.
    if (esMovil()) modo = 'agenda';

    window.addEventListener('resize', alRedimensionar);
    render();
}

export function setModo(nuevo) {
    modo = nuevo;
    el.modos.querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.modo === nuevo));
    });
    render();
}

export function irAHoy() {
    cursor = new Date();
    render();
}

export function irADia(dia) {
    if (!dia) return;
    cursor = desdeClave(claveDia(dia));
    if (!esMovil()) setModo('dia'); else render();
}

export function refrescarCalendario() { render(); }

export function diaVisible() { return claveDia(cursor); }

function esMovil() { return window.innerWidth <= ANCHO_MOVIL; }

let eraMovil = null;
function alRedimensionar() {
    const ahora = esMovil();
    if (eraMovil === ahora) return;   // solo re-render al CRUZAR el punto de quiebre
    eraMovil = ahora;
    if (ahora) modo = 'agenda';
    else if (modo === 'agenda') modo = 'dia';
    render();
}

function mover(dir) {
    if (modo === 'mes') cursor = sumarMeses(cursor, dir);
    else if (modo === 'semana') cursor = sumarDias(cursor, 7 * dir);
    else cursor = sumarDias(cursor, dir);
    render();
}

// ---------- render ----------

function render() {
    if (!el.cal) return;
    el.cal.innerHTML = '';

    const movil = esMovil();
    el.modos.hidden = movil;

    if (movil) {
        el.titulo.textContent = etiquetaRangoSemana(cursor);
        el.cal.append(tiraSemana(), agendaMovil());
        return;
    }

    if (modo === 'mes') {
        el.titulo.textContent = etiquetaMes(cursor);
        el.cal.appendChild(vistaMes());
    } else if (modo === 'semana') {
        el.titulo.textContent = etiquetaRangoSemana(cursor);
        el.cal.appendChild(vistaRejilla(diasDeSemana(cursor).slice(0, 5), 'semana'));
    } else {
        el.titulo.textContent = etiquetaDiaLarga(claveDia(cursor));
        el.cal.appendChild(vistaRejilla([claveDia(cursor)], 'dia'));
    }
}

function visitasDe(clave) {
    return leerVisitas().filter(v => v.dia === clave);
}

/** clave de día -> nº de visitas. Una sola pasada. */
function cargaPorDia() {
    const conteo = {};
    leerVisitas().forEach(v => { conteo[v.dia] = (conteo[v.dia] || 0) + 1; });
    return conteo;
}

// ---------- rejilla de horas ----------

function vistaRejilla(claves, clase) {
    ventana = calcularVentana(claves);

    const grid = document.createElement('div');
    grid.className = `grid ${clase}`;

    const head = document.createElement('div');
    head.className = 'grid-head';
    head.appendChild(document.createElement('div'));   // esquina sobre el eje

    claves.forEach(clave => {
        const f = desdeClave(clave);
        const celda = document.createElement('div');
        if (clave === claveHoy()) celda.className = 'is-today';

        const dow = document.createElement('div');
        dow.className = 'dow';
        dow.textContent = clase === 'dia'
            ? etiquetaDiaLarga(clave)
            : DIAS_ABREV[(f.getDay() + 6) % 7] + (clave === claveHoy() ? ' · Hoy' : '');

        const num = document.createElement('div');
        num.className = 'dnum';
        num.textContent = f.getDate();

        celda.append(dow, num);
        head.appendChild(celda);
    });
    grid.appendChild(head);
    grid.appendChild(ejeHoras());

    claves.forEach(clave => grid.appendChild(columnaDia(clave)));
    return grid;
}

/**
 * Ventana de horas a mostrar: la jornada normal (07:00-19:00), estirada lo necesario para
 * que quepa lo que hay. Sin esto, una visita a las 06:00 se dibujaría arriba del lienzo y
 * simplemente no se vería: el educador la daría por perdida.
 */
function calcularVentana(claves) {
    let desde = HORA_MIN, hasta = HORA_MAX;

    claves.flatMap(visitasDe).forEach(v => {
        const ini = inicioDe(v), fin = finDe(v);
        if (ini) desde = Math.min(desde, Math.floor(ini.getHours() + ini.getMinutes() / 60));
        if (fin) hasta = Math.max(hasta, Math.ceil(fin.getHours() + fin.getMinutes() / 60));
    });

    // La línea de ahora también merece caber, si el día es hoy.
    if (claves.includes(claveHoy())) {
        const h = new Date().getHours();
        desde = Math.min(desde, h);
        hasta = Math.max(hasta, h + 1);
    }

    return { desde: Math.max(0, desde), hasta: Math.min(24, Math.max(hasta, desde + 1)) };
}

function ejeHoras() {
    const eje = document.createElement('div');
    eje.className = 'axis';
    for (let h = ventana.desde; h < ventana.hasta; h++) {
        const t = document.createElement('div');
        t.className = 't';
        const s = document.createElement('span');
        s.textContent = `${String(h).padStart(2, '0')}:00`;
        t.appendChild(s);
        eje.appendChild(t);
    }
    return eje;
}

function columnaDia(clave) {
    const col = document.createElement('div');
    col.className = 'col';
    col.dataset.dia = clave;
    if (clave === claveHoy()) col.classList.add('is-today');

    for (let h = ventana.desde; h < ventana.hasta; h++) {
        const banda = document.createElement('div');
        banda.className = 'h';
        col.appendChild(banda);
    }

    if (clave === claveHoy()) {
        const linea = lineaAhora();
        if (linea) col.appendChild(linea);
    }

    repartirEnColumnas(visitasDe(clave)).forEach(({ visita, columna, columnas }) => {
        col.appendChild(tarjetaVisita(visita, columna, columnas));
    });

    // Click en el hueco = crear ahí. Menos clics que abrir el drawer y teclear la hora.
    col.addEventListener('click', (e) => {
        if (e.target.closest('.ev')) return;
        const rect = col.getBoundingClientRect();
        const horas = (e.clientY - rect.top) / rect.height * (ventana.hasta - ventana.desde);
        alCrearEn(clave, redondearACuarto(ventana.desde + horas));
    });

    return col;
}

/** Las visitas reales empiezan en :00 o :30, no en :07. */
function redondearACuarto(horaDecimal) {
    const total = Math.round(horaDecimal * 2) / 2;
    const h = Math.max(ventana.desde, Math.min(ventana.hasta - 1, Math.floor(total)));
    const m = (total - Math.floor(total)) >= 0.5 ? 30 : 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function lineaAhora() {
    const ahora = new Date();
    const pos = ahora.getHours() + ahora.getMinutes() / 60 - ventana.desde;
    // Fuera de la ventana (p. ej. de madrugada) no se dibuja: una línea pegada al borde mentiría.
    if (pos < 0 || pos > ventana.hasta - ventana.desde) return null;

    const linea = document.createElement('div');
    linea.className = 'nowline';
    linea.style.setProperty('--now', pos.toFixed(3));

    const badge = document.createElement('span');
    badge.className = 'now-badge';
    badge.textContent = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    linea.appendChild(badge);
    return linea;
}

function tarjetaVisita(visita, columna, columnas) {
    const estado = estadoDe(visita);
    const dur = duracionHoras(visita);
    const inicio = inicioDe(visita);
    const desplazamiento = inicio ? inicio.getHours() + inicio.getMinutes() / 60 - ventana.desde : 0;

    const ev = document.createElement('button');
    ev.type = 'button';
    ev.className = `ev st-${estado}`;
    ev.dataset.id = visita.id;
    ev.style.setProperty('--s', desplazamiento.toFixed(3));
    ev.style.setProperty('--dur', dur.toFixed(3));
    ev.style.setProperty('--col', columna);
    ev.style.setProperty('--cols', columnas);

    // Bajo ~45min no cabe más que hora y cliente; forzarlo produce texto cortado a la mitad.
    if (dur < 0.75) ev.classList.add('compacta');

    const t = document.createElement('span');
    t.className = 'ev-time';
    t.textContent = dur >= 1
        ? `${hora(visita.hora_inicio || '')}–${hora(visita.hora_fin || '')} · ${duracionTexto(visita)}`
        : visita.hora_inicio || '';

    const cliente = document.createElement('span');
    cliente.className = 'ev-client';
    cliente.textContent = visita.cliente || 'Sin cliente';

    ev.append(t, cliente);

    if (dur >= 0.75) {
        const hosp = document.createElement('span');
        hosp.className = 'ev-hosp';
        hosp.textContent = visita.hospital || 'Sin hospital';
        ev.appendChild(hosp);
    }
    if (dur >= 1.5 && modo === 'dia') {
        const sectores = document.createElement('span');
        sectores.className = 'ev-sectores';
        (visita.sectores || []).forEach(s => {
            const chip = document.createElement('span');
            chip.textContent = s.nombre;
            sectores.appendChild(chip);
        });
        if (sectores.children.length) ev.appendChild(sectores);
    }
    if (dur >= 1) {
        const flags = document.createElement('span');
        flags.className = 'ev-flags';
        flags.append(punto(estado), pastilla(detalleEstado(visita)));
        if (!visita.sincronizado) flags.appendChild(pastilla('↑ En cola', true));
        ev.appendChild(flags);
    }

    ev.addEventListener('click', (e) => { e.stopPropagation(); alAbrirVisita(visita.id); });
    return ev;
}

function punto(estado) {
    const d = document.createElement('span');
    d.className = 'dot';
    if (estado === ESTADOS.PROGRAMADA) d.classList.add('hollow');
    return d;
}

function pastilla(texto, neutro = false) {
    const p = document.createElement('span');
    p.className = neutro ? 'pill neutro' : 'pill';
    p.textContent = texto;
    return p;
}

// ---------- mes ----------

function vistaMes() {
    const hoy = claveHoy();
    const mesActual = cursor.getMonth();

    const grid = document.createElement('div');
    grid.className = 'mes';

    DIAS_ABREV.forEach((d, i) => {
        const h = document.createElement('div');
        h.className = 'mes-h' + (i >= 5 ? ' finde' : '');
        h.textContent = d;
        grid.appendChild(h);
    });

    diasDeCuadriculaMes(cursor).forEach(clave => {
        const f = desdeClave(clave);
        const finde = f.getDay() === 0 || f.getDay() === 6;

        const celda = document.createElement('button');
        celda.type = 'button';
        celda.className = 'mes-cell';
        if (f.getMonth() !== mesActual) celda.classList.add('otro-mes');
        else if (finde) celda.classList.add('finde');
        if (clave === hoy) celda.classList.add('is-today');

        const n = document.createElement('span');
        n.className = 'mes-n';
        n.textContent = f.getDate();
        celda.appendChild(n);

        const delDia = visitasDe(clave).sort((a, b) => (inicioDe(a) || 0) - (inicioDe(b) || 0));
        // Máximo 3: una celda que intenta mostrarlo todo no muestra nada.
        delDia.slice(0, 3).forEach(v => celda.appendChild(lineaMes(v)));
        if (delDia.length > 3) {
            const mas = document.createElement('span');
            mas.className = 'mes-more';
            mas.textContent = `+${delDia.length - 3} más`;
            celda.appendChild(mas);
        }

        celda.addEventListener('click', () => irADia(clave));
        grid.appendChild(celda);
    });

    return grid;
}

function lineaMes(visita) {
    const estado = estadoDe(visita);
    const linea = document.createElement('span');
    linea.className = `mes-ev st-${estado}`;

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = visita.hora_inicio || '';

    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = visita.cliente || 'Sin cliente';

    linea.append(punto(estado), t, c);
    return linea;
}

// ---------- móvil ----------

function tiraSemana() {
    const actual = claveDia(cursor);

    const tira = document.createElement('div');
    tira.className = 'wkstrip';

    diasDeSemana(cursor).forEach(clave => {
        const f = desdeClave(clave);
        const btn = document.createElement('button');
        btn.type = 'button';
        if (clave === actual) btn.className = 'is-sel';

        const d = document.createElement('span');
        d.className = 'd';
        d.textContent = inicialesDias()[(f.getDay() + 6) % 7];

        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = f.getDate();

        // Los puntos son la carga del día y su estado: se lee la semana sin abrirla.
        const carga = document.createElement('span');
        carga.className = 'carga';
        visitasDe(clave).slice(0, 4).forEach(v => {
            const i = document.createElement('i');
            i.className = `st-${estadoDe(v)}`;
            carga.appendChild(i);
        });

        btn.append(d, n, carga);
        btn.addEventListener('click', () => { cursor = f; render(); });
        tira.appendChild(btn);
    });
    return tira;
}

function agendaMovil() {
    const caja = document.createElement('div');
    const clave = claveDia(cursor);
    const delDia = visitasDe(clave).sort((a, b) => (inicioDe(a) || 0) - (inicioDe(b) || 0));

    const head = document.createElement('div');
    head.className = 'agenda-day' + (clave === claveHoy() ? ' es-hoy' : '');
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = etiquetaDiaLarga(clave);
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = delDia.length === 1 ? '1 visita' : `${delDia.length} visitas`;
    head.append(lbl, cnt);
    caja.appendChild(head);

    if (delDia.length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'empty';
        const t = document.createElement('strong');
        t.textContent = clave === claveHoy() ? 'Día libre' : 'Sin visitas';
        vacio.append(t, document.createTextNode('Toca "Nueva visita" para agendar una.'));
        caja.appendChild(vacio);
        return caja;
    }

    const lista = document.createElement('div');
    lista.className = 'agenda-list';
    delDia.forEach(v => lista.appendChild(filaAgenda(v)));
    caja.appendChild(lista);
    return caja;
}

function filaAgenda(visita) {
    const estado = estadoDe(visita);
    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = `arow st-${estado}`;
    fila.dataset.id = visita.id;

    const t = document.createElement('span');
    t.className = 'arow-time';
    t.append(
        document.createTextNode(visita.hora_inicio || '--:--'),
        document.createElement('br')
    );
    const fin = document.createElement('span');
    fin.className = 'end';
    fin.textContent = visita.hora_fin || '';
    t.appendChild(fin);

    const cuerpo = document.createElement('span');
    cuerpo.className = 'arow-body';

    const cliente = document.createElement('span');
    cliente.className = 'arow-client';
    cliente.textContent = visita.cliente || 'Sin cliente';

    const hosp = document.createElement('span');
    hosp.className = 'arow-hosp';
    hosp.textContent = visita.hospital || 'Sin hospital';

    const meta = document.createElement('span');
    meta.className = 'arow-meta';
    meta.append(punto(estado), pastilla(detalleEstado(visita)));
    if (!visita.sincronizado) meta.appendChild(pastilla('↑ En cola', true));

    cuerpo.append(cliente, hosp, meta);
    fila.append(t, cuerpo);
    fila.addEventListener('click', () => alAbrirVisita(visita.id));
    return fila;
}
