/**
 * Selector de sectores por chips para el formulario de agendar.
 *
 * Al agendar solo se captura el sector y su OBJETIVO. Las actividades no van aquí:
 * se registran en sitio, desde la vista de detalle.
 *
 * La selección se lee del DOM (`.sector-block[data-sector]`) en vez de mantener un array
 * aparte, para que no puedan desincronizarse.
 */

let catalogo = [];
let secuencia = 0;
let el = {};

export function initSelectorSectores() {
    el = {
        disponibles: document.getElementById('sectores-disponibles'),
        contenedor: document.getElementById('sectores-container'),
        custom: document.getElementById('sector-custom'),
        btnCustom: document.getElementById('btn-add-sector-custom'),
        contador: document.getElementById('sectores-contador'),
        error: document.getElementById('sectores-error'),
        btnTodos: document.getElementById('btn-select-all'),
        btnNinguno: document.getElementById('btn-deselect-all')
    };

    el.btnCustom.addEventListener('click', agregarPersonalizado);
    el.custom.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            agregarPersonalizado();
        }
    });

    el.btnTodos.addEventListener('click', seleccionarTodos);
    el.btnNinguno.addEventListener('click', quitarTodos);

    actualizarEstado();
    renderChips();
}

/** Mezcla con lo existente para no perder los sectores personalizados de esta sesión. */
export function setCatalogoSectores(lista) {
    catalogo = Array.from(new Set([...(lista || []), ...catalogo]));
    renderChips();
}

/** [{ nombre, objetivo }] en el orden en que se agregaron. */
export function getSeleccion() {
    return Array.from(el.contenedor.querySelectorAll('.sector-block')).map(bloque => ({
        nombre: bloque.dataset.sector,
        objetivo: bloque.querySelector('.objetivo-input').value.trim()
    }));
}

export function mostrarError(mostrar) {
    el.error.hidden = !mostrar;
    if (mostrar) el.error.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function limpiarSeleccion() {
    el.contenedor.innerHTML = '';
    actualizarEstado();
    renderChips();
}

// ---------- interno ----------

function nombresSeleccionados() {
    return Array.from(el.contenedor.querySelectorAll('.sector-block'))
        .map(bloque => bloque.dataset.sector);
}

function renderChips() {
    const seleccionados = nombresSeleccionados();
    const disponibles = catalogo.filter(s => !seleccionados.includes(s));

    actualizarBotonesMasivos();
    el.disponibles.innerHTML = '';

    if (disponibles.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = catalogo.length === 0
            ? 'Aún no hay sectores en el catálogo. Agrega uno abajo.'
            : 'Ya agregaste todos los sectores disponibles.';
        el.disponibles.appendChild(p);
        return;
    }

    disponibles.forEach(sector => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = sector;
        chip.addEventListener('click', () => agregarSector(sector));
        el.disponibles.appendChild(chip);
    });
}

function actualizarBotonesMasivos() {
    const seleccionados = nombresSeleccionados();
    el.btnTodos.disabled = catalogo.length === 0 || catalogo.every(s => seleccionados.includes(s));
    el.btnNinguno.disabled = seleccionados.length === 0;
}

function actualizarEstado() {
    const bloques = el.contenedor.querySelectorAll('.sector-block');
    let vacio = document.getElementById('sectores-empty');

    if (bloques.length === 0) {
        if (!vacio) {
            vacio = document.createElement('p');
            vacio.id = 'sectores-empty';
            vacio.className = 'empty-state';
            vacio.textContent = 'Aún no has seleccionado ningún sector.';
            el.contenedor.appendChild(vacio);
        }
    } else if (vacio) {
        vacio.remove();
    }

    el.contador.textContent = bloques.length;
}

function crearBloque(nombreSector) {
    const uid = ++secuencia;

    const div = document.createElement('div');
    div.className = 'sector-block sector-card';
    div.dataset.sector = nombreSector;

    const header = document.createElement('div');
    header.className = 'sector-card-header';

    const titulo = document.createElement('h4');
    titulo.textContent = nombreSector;

    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'btn-remove-chip';
    btnQuitar.setAttribute('aria-label', `Quitar sector ${nombreSector}`);
    btnQuitar.textContent = '✕';
    btnQuitar.addEventListener('click', () => quitarSector(div));

    header.append(titulo, btnQuitar);

    const label = document.createElement('label');
    label.textContent = 'Objetivo';
    label.htmlFor = `objetivo-${uid}`;

    const objetivo = document.createElement('input');
    objetivo.type = 'text';
    objetivo.id = `objetivo-${uid}`;
    objetivo.className = 'objetivo-input';
    objetivo.placeholder = '¿Qué se busca lograr en este sector?';

    div.append(header, label, objetivo);
    return div;
}

// Sin focus() a propósito: hacía que la vista brincara al chip recién agregado
// y en celular abría el teclado encima de la lista.
function agregarSector(nombreSector) {
    const nombre = (nombreSector || '').trim();
    if (!nombre || nombresSeleccionados().includes(nombre)) return;

    el.contenedor.appendChild(crearBloque(nombre));
    actualizarEstado();
    renderChips();
    mostrarError(false);
}

function quitarSector(bloque) {
    bloque.remove();
    actualizarEstado();
    renderChips();
}

function seleccionarTodos() {
    const seleccionados = nombresSeleccionados();
    catalogo.filter(s => !seleccionados.includes(s))
        .forEach(s => el.contenedor.appendChild(crearBloque(s)));

    actualizarEstado();
    renderChips();
    if (nombresSeleccionados().length > 0) mostrarError(false);
}

function quitarTodos() {
    el.contenedor.querySelectorAll('.sector-block').forEach(b => b.remove());
    actualizarEstado();
    renderChips();
}

function agregarPersonalizado() {
    const nombre = el.custom.value.trim();
    if (!nombre) return;

    if (!catalogo.includes(nombre)) catalogo.push(nombre);
    agregarSector(nombre);
    el.custom.value = '';
    el.custom.focus();
}
