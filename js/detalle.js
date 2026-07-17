/**
 * Vista de ejecución (#/visita/:id): lo que se usa al llegar con el cliente.
 *
 * Por cada sector agendado se ven su objetivo y sus actividades. Un sector puede tener
 * varias actividades, y cada una lleva su evidencia.
 */

import { obtenerVisita, actualizarVisita, eliminarVisita, nuevoId } from './storage.js';
import { controlEvidencia, quitarEvidencia } from './evidencias.js';
import { etiquetaDiaLarga, hora, claveDia } from './fechas.js';

let idActual = null;
let alCambiar = () => {};

export function initDetalle(onCambio) {
    alCambiar = onCambio || (() => {});
}

export function renderDetalle(id) {
    idActual = id;
    const contenedor = document.getElementById('detalle-contenido');
    contenedor.innerHTML = '';

    const visita = obtenerVisita(id);
    if (!visita) {
        contenedor.appendChild(tarjetaNoEncontrada());
        return;
    }

    contenedor.appendChild(encabezado(visita));
    (visita.sectores || []).forEach(sector => contenedor.appendChild(tarjetaSector(visita, sector)));
    contenedor.appendChild(acciones(visita));
}

function repintar() {
    renderDetalle(idActual);
    alCambiar();
}

function tarjetaNoEncontrada() {
    const card = document.createElement('section');
    card.className = 'card';

    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Esta visita ya no existe.';

    const volver = document.createElement('a');
    volver.className = 'btn';
    volver.href = '#/agenda';
    volver.textContent = '← Volver a la agenda';

    card.append(p, volver);
    return card;
}

function encabezado(visita) {
    const card = document.createElement('section');
    card.className = 'card';

    const volver = document.createElement('a');
    volver.className = 'btn-link';
    volver.href = '#/agenda';
    volver.textContent = '← Agenda';

    const titulo = document.createElement('h2');
    titulo.textContent = visita.cliente;

    const cuando = document.createElement('p');
    cuando.className = 'detalle-cuando';
    cuando.textContent = `${etiquetaDiaLarga(claveDia(visita.fecha))} · ${hora(visita.fecha)}`;

    const quien = document.createElement('p');
    quien.className = 'field-hint';
    quien.textContent = visita.educador || 'Sin educador';

    const estado = document.createElement('span');
    const completada = visita.estado === 'completada';
    estado.className = `visita-estado ${completada ? 'is-synced' : 'is-agendada'}`;
    estado.textContent = completada ? '✅ Completada' : '📅 Agendada';

    card.append(volver, titulo, cuando, quien, estado);
    return card;
}

function tarjetaSector(visita, sector) {
    const card = document.createElement('section');
    card.className = 'card sector-ejecucion';

    const titulo = document.createElement('h3');
    titulo.textContent = sector.nombre;

    const objetivo = document.createElement('p');
    objetivo.className = 'sector-objetivo';
    if (sector.objetivo) {
        const etiqueta = document.createElement('strong');
        etiqueta.textContent = 'Objetivo: ';
        objetivo.append(etiqueta, document.createTextNode(sector.objetivo));
    } else {
        objetivo.classList.add('sin-objetivo');
        objetivo.textContent = 'Sin objetivo definido';
    }

    card.append(titulo, objetivo);

    const lista = document.createElement('div');
    lista.className = 'actividades-lista';

    if ((sector.actividades || []).length === 0) {
        const vacio = document.createElement('p');
        vacio.className = 'empty-state';
        vacio.textContent = 'Aún no registras actividades en este sector.';
        lista.appendChild(vacio);
    } else {
        sector.actividades.forEach((act, i) => {
            lista.appendChild(filaActividad(visita, sector, act, i + 1));
        });
    }

    card.append(lista, formularioActividad(visita, sector));
    return card;
}

function filaActividad(visita, sector, actividad, numero) {
    const fila = document.createElement('div');
    fila.className = 'actividad-item';

    const cabecera = document.createElement('div');
    cabecera.className = 'actividad-cabecera';

    const indice = document.createElement('span');
    indice.className = 'actividad-numero';
    indice.textContent = numero;

    const texto = document.createElement('p');
    texto.className = 'actividad-texto';
    texto.textContent = actividad.texto;

    const btnBorrar = document.createElement('button');
    btnBorrar.type = 'button';
    btnBorrar.className = 'btn-remove-chip';
    btnBorrar.setAttribute('aria-label', 'Borrar actividad');
    btnBorrar.textContent = '✕';
    btnBorrar.addEventListener('click', async () => {
        if (!confirm(`¿Borrar la actividad "${actividad.texto}"?`)) return;

        // El archivo se borra de IndexedDB primero: si se quita la actividad antes,
        // el blob quedaría huérfano ocupando espacio para siempre.
        await quitarEvidencia(actividad.id).catch(() => {});
        actualizarVisita(visita.id, v => {
            const s = v.sectores.find(x => x.id === sector.id);
            s.actividades = s.actividades.filter(a => a.id !== actividad.id);
        });
        repintar();
    });

    cabecera.append(indice, texto, btnBorrar);
    fila.append(cabecera, controlEvidencia(actividad, repintar));
    return fila;
}

function formularioActividad(visita, sector) {
    const form = document.createElement('form');
    form.className = 'actividad-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '¿Qué hiciste en este sector?';
    input.required = true;
    input.setAttribute('aria-label', `Nueva actividad en ${sector.nombre}`);

    const boton = document.createElement('button');
    boton.type = 'submit';
    boton.className = 'btn-add-chip';
    boton.textContent = '➕';
    boton.setAttribute('aria-label', 'Agregar actividad');

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = input.value.trim();
        if (!texto) return;

        actualizarVisita(visita.id, v => {
            const s = v.sectores.find(x => x.id === sector.id);
            s.actividades = s.actividades || [];
            s.actividades.push({
                id: nuevoId('a'),
                texto,
                creada: new Date().toISOString(),
                evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' }
            });
        });

        input.value = '';
        repintar();
    });

    form.append(input, boton);
    return form;
}

function acciones(visita) {
    const card = document.createElement('section');
    card.className = 'card';

    const totalActividades = (visita.sectores || [])
        .reduce((t, s) => t + (s.actividades || []).length, 0);
    const sinEvidencia = (visita.sectores || []).reduce((t, s) => t + (s.actividades || [])
        .filter(a => !a.evidencia || a.evidencia.estado !== 'subida').length, 0);

    if (visita.estado !== 'completada') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = '✅ Completar visita';
        btn.addEventListener('click', () => {
            if (totalActividades === 0 &&
                !confirm('No registraste ninguna actividad. ¿Completar de todos modos?')) return;

            // Las evidencias faltantes avisan pero no bloquean: pueden subirse días después.
            if (sinEvidencia > 0 && !confirm(
                `Quedan ${sinEvidencia} actividad(es) sin evidencia subida.\n\n` +
                'Puedes completar la visita ahora y subirlas después desde "Evidencias". ¿Continuar?'
            )) return;

            actualizarVisita(visita.id, v => { v.estado = 'completada'; });
            repintar();
        });
        card.appendChild(btn);
    } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-link';
        btn.textContent = '↩ Reabrir visita';
        btn.addEventListener('click', () => {
            actualizarVisita(visita.id, v => { v.estado = 'agendada'; });
            repintar();
        });
        card.appendChild(btn);
    }

    const borrar = document.createElement('button');
    borrar.type = 'button';
    borrar.className = 'btn-link es-peligro';
    borrar.textContent = '🗑 Eliminar visita';
    borrar.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la visita a ${visita.cliente}?\n\nEsto no la borra de Google Sheets.`)) return;

        for (const sector of visita.sectores || []) {
            for (const act of sector.actividades || []) {
                await quitarEvidencia(act.id).catch(() => {});
            }
        }
        eliminarVisita(visita.id);
        location.hash = '#/agenda';
        alCambiar();
    });

    card.appendChild(borrar);
    return card;
}
