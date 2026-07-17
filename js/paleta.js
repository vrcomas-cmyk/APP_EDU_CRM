/**
 * Paleta de comandos (⌘K / Ctrl+K).
 *
 * Overlay centrado, no un drawer: aquí la pregunta es "¿a dónde voy?", no "¿dónde cabe esto?".
 * Combina acciones fijas (nueva visita, ir a hoy, cambiar de vista) con los clientes/hospitales
 * ya agendados, para saltar directo a una visita sin ir a buscarla en el calendario.
 */

import { leerVisitas } from './storage.js';
import { inicioDe } from './estado.js';
import { etiquetaDiaLarga } from './fechas.js';

const MAX_RESULTADOS = 8;

let el = {};
let activo = 0;
let comandos = [];
let alAbrirVisita = () => {};
let alIrADia = () => {};

export function initPaleta({ onNuevaVisita, onIrAHoy, onSetModo, onAbrirVisita, onIrADia } = {}) {
    alAbrirVisita = onAbrirVisita || (() => {});
    alIrADia = onIrADia || (() => {});

    comandos = [
        { etiqueta: 'Nueva visita', atajo: 'N', fn: () => onNuevaVisita?.() },
        { etiqueta: 'Ir a hoy', atajo: 'T', fn: () => onIrAHoy?.() },
        { etiqueta: 'Vista Día', atajo: 'D', fn: () => onSetModo?.('dia') },
        { etiqueta: 'Vista Semana', atajo: 'S', fn: () => onSetModo?.('semana') },
        { etiqueta: 'Vista Mes', atajo: 'M', fn: () => onSetModo?.('mes') }
    ];

    const raiz = document.createElement('div');
    raiz.className = 'paleta-raiz';
    raiz.hidden = true;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', cerrarPaleta);

    const panel = document.createElement('div');
    panel.className = 'paleta';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Comandos');

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'paleta-inp';
    inp.placeholder = 'Ir a un cliente, crear una visita, cambiar de vista…';
    inp.autocomplete = 'off';

    const lista = document.createElement('div');
    lista.className = 'paleta-lista';

    panel.append(inp, lista);
    raiz.append(scrim, panel);
    document.body.appendChild(raiz);
    el = { raiz, inp, lista };

    inp.addEventListener('input', pintar);
    inp.addEventListener('keydown', (e) => {
        const items = () => Array.from(el.lista.querySelectorAll('.paleta-opt'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const its = items();
            if (its.length === 0) return;
            activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length;
            marcarActivo(its);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            items()[activo]?.click();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            cerrarPaleta();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || raiz.hidden) return;
        cerrarPaleta();
    });
}

export function hayPaletaAbierta() { return el.raiz && !el.raiz.hidden; }

export function abrirPaleta() {
    if (!el.raiz || !el.raiz.hidden) return;
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    el.inp.value = '';
    activo = 0;
    pintar();
    el.inp.focus();
}

function cerrarPaleta() {
    if (!el.raiz || el.raiz.hidden) return;
    el.raiz.hidden = true;
    document.body.style.overflow = '';
}

function pintar() {
    const q = el.inp.value.trim().toLowerCase();
    el.lista.innerHTML = '';
    activo = 0;

    const fijos = q ? comandos.filter(c => c.etiqueta.toLowerCase().includes(q)) : comandos;
    fijos.forEach(c => el.lista.appendChild(opcion(c.etiqueta, c.atajo, () => { c.fn(); cerrarPaleta(); })));

    if (q) {
        resultadosClientes(q).forEach(v => {
            const etiqueta = `${v.cliente || 'Sin cliente'} · ${v.hospital || 'Sin hospital'}`;
            const meta = `${etiquetaDiaLarga(v.dia)} · ${v.hora_inicio || ''}`;
            el.lista.appendChild(opcion(etiqueta, meta, () => {
                alIrADia(v.dia);
                alAbrirVisita(v.id);
                cerrarPaleta();
            }));
        });
    }

    if (el.lista.children.length === 0) {
        const p = document.createElement('p');
        p.className = 'ayuda paleta-vacio';
        p.textContent = 'Sin resultados.';
        el.lista.appendChild(p);
    }

    marcarActivo(Array.from(el.lista.querySelectorAll('.paleta-opt')));
}

function opcion(etiqueta, meta, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'paleta-opt';

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = etiqueta;

    const m = document.createElement('span');
    m.className = 'm mono';
    m.textContent = meta;

    b.append(t, m);
    b.addEventListener('click', fn);
    return b;
}

function marcarActivo(items) {
    items.forEach((it, i) => it.classList.toggle('is-active', i === activo));
    items[activo]?.scrollIntoView({ block: 'nearest' });
}

/**
 * Un resultado por cliente, no uno por visita: buscar "Hospital X" y ver la misma fila
 * repetida diez veces no ayuda a llegar a ningún lado. Se prefiere la próxima visita futura;
 * si no hay ninguna por venir, la más reciente que ya pasó.
 */
function resultadosClientes(q) {
    const ahora = new Date();
    const porCliente = new Map();

    leerVisitas().forEach(v => {
        const texto = `${v.cliente || ''} ${v.hospital || ''}`.toLowerCase();
        if (!texto.includes(q)) return;

        const clave = v.cliente || v.hospital || v.id;
        const ini = inicioDe(v);
        const actual = porCliente.get(clave);
        if (!actual) { porCliente.set(clave, { visita: v, ini }); return; }

        const actualEsFutura = actual.ini && actual.ini >= ahora;
        const estaEsFutura = ini && ini >= ahora;
        const mejor =
            (estaEsFutura && (!actualEsFutura || ini < actual.ini)) ||
            (!actualEsFutura && !estaEsFutura && ini && (!actual.ini || ini > actual.ini));
        if (mejor) porCliente.set(clave, { visita: v, ini });
    });

    return Array.from(porCliente.values())
        .sort((a, b) => (a.ini || 0) - (b.ini || 0))
        .slice(0, MAX_RESULTADOS)
        .map(x => x.visita);
}
