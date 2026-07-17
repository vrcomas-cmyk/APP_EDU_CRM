/**
 * Lista de visitas agrupada por día.
 *
 * Orden: hoy primero, luego lo que viene, y al final lo pasado (ver ordenarClavesDias).
 * Dentro de cada día, de la que empieza más temprano a la más tarde.
 */

import { leerVisitas } from './storage.js';
import { claveDia, hora, etiquetaDiaLarga, ordenarClavesDias, claveHoy } from './fechas.js';

const lista = () => document.getElementById('lista-visitas');

/** claves: días visibles según el calendario. null = todas. */
export function renderAgenda(claves = null) {
    const contenedor = lista();
    contenedor.innerHTML = '';

    const visibles = filtrarPorDias(leerVisitas(), claves);

    if (visibles.length === 0) {
        contenedor.appendChild(vacio(claves));
        return;
    }

    const porDia = agruparPorDia(visibles);
    ordenarClavesDias(Object.keys(porDia)).forEach(clave => {
        contenedor.appendChild(grupoDeDia(clave, porDia[clave]));
    });
}

function filtrarPorDias(visitas, claves) {
    if (!claves) return visitas;
    const permitidas = new Set(claves);
    return visitas.filter(v => permitidas.has(claveDia(v.fecha)));
}

function agruparPorDia(visitas) {
    const grupos = {};
    visitas.forEach(visita => {
        const clave = claveDia(visita.fecha);
        (grupos[clave] = grupos[clave] || []).push(visita);
    });

    // La hora es 'HH:MM' con ceros a la izquierda, así que ordena bien como texto.
    Object.values(grupos).forEach(dia => dia.sort((a, b) => hora(a.fecha).localeCompare(hora(b.fecha))));
    return grupos;
}

function vacio(claves) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = claves && claves.length === 1 && claves[0] === claveHoy()
        ? 'No tienes visitas agendadas para hoy.'
        : 'No hay visitas agendadas en este periodo.';
    return p;
}

function grupoDeDia(clave, visitas) {
    const seccion = document.createElement('div');
    seccion.className = 'dia-grupo';

    const encabezado = document.createElement('div');
    encabezado.className = 'dia-encabezado';
    if (clave === claveHoy()) encabezado.classList.add('es-hoy');

    const titulo = document.createElement('h3');
    titulo.textContent = etiquetaDiaLarga(clave);

    const cuenta = document.createElement('span');
    cuenta.className = 'dia-cuenta';
    cuenta.textContent = visitas.length === 1 ? '1 visita' : `${visitas.length} visitas`;

    encabezado.append(titulo, cuenta);
    seccion.appendChild(encabezado);

    visitas.forEach(v => seccion.appendChild(filaVisita(v)));
    return seccion;
}

function filaVisita(visita) {
    const enlace = document.createElement('a');
    enlace.className = 'visita-item';
    enlace.href = `#/visita/${visita.id}`;
    if (visita.estado === 'completada') enlace.classList.add('es-completada');

    const horaEl = document.createElement('span');
    horaEl.className = 'visita-hora';
    horaEl.textContent = hora(visita.fecha) || '--:--';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'visita-cuerpo';

    const cliente = document.createElement('h4');
    cliente.textContent = visita.cliente;

    const sectores = document.createElement('p');
    sectores.className = 'visita-sectores';
    sectores.textContent = (visita.sectores || []).map(s => s.nombre).join(' · ') || 'Sin sectores';

    cuerpo.append(cliente, sectores);

    const pie = document.createElement('div');
    pie.className = 'visita-pie';
    pie.appendChild(insignaEstado(visita));

    const pendientes = contarEvidenciasPendientes(visita);
    if (pendientes > 0) {
        const aviso = document.createElement('span');
        aviso.className = 'visita-estado is-pending';
        aviso.textContent = `⏳ ${pendientes} evidencia${pendientes > 1 ? 's' : ''}`;
        pie.appendChild(aviso);
    }
    if (!visita.sincronizado) {
        const nube = document.createElement('span');
        nube.className = 'visita-estado is-offline';
        nube.textContent = '↑ Sin sincronizar';
        pie.appendChild(nube);
    }
    cuerpo.appendChild(pie);

    enlace.append(horaEl, cuerpo);
    return enlace;
}

function insignaEstado(visita) {
    const span = document.createElement('span');
    const completada = visita.estado === 'completada';
    span.className = `visita-estado ${completada ? 'is-synced' : 'is-agendada'}`;

    const actividades = (visita.sectores || [])
        .reduce((total, s) => total + (s.actividades || []).length, 0);

    span.textContent = completada
        ? `✅ Completada · ${actividades} actividad${actividades === 1 ? '' : 'es'}`
        : '📅 Agendada';
    return span;
}

function contarEvidenciasPendientes(visita) {
    return (visita.sectores || []).reduce((total, sector) => total + (sector.actividades || [])
        .filter(a => !a.evidencia || a.evidencia.estado !== 'subida').length, 0);
}
