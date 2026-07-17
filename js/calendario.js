/**
 * Calendario con tres modos: Día, Semana y Mes.
 *
 * No dibuja visitas: solo decide qué días están visibles y avisa al que lo usa
 * (`onCambio`), que se encarga de repintar la agenda de abajo.
 */

import { leerVisitas } from './storage.js';
import {
    claveDia, claveHoy, desdeClave, sumarDias, sumarMeses, diasDeSemana,
    diasDeCuadriculaMes, etiquetaMes, etiquetaRangoSemana, etiquetaDiaLarga,
    inicialesDias, hora
} from './fechas.js';

let modo = 'dia';
let cursor = new Date();
let alCambiar = () => {};
let el = {};

export function initCalendario(onCambio) {
    alCambiar = onCambio || (() => {});
    el = {
        titulo: document.getElementById('cal-titulo'),
        cuerpo: document.getElementById('cal-cuerpo'),
        anterior: document.getElementById('cal-anterior'),
        siguiente: document.getElementById('cal-siguiente'),
        hoy: document.getElementById('cal-hoy'),
        modos: document.getElementById('cal-modo')
    };

    el.anterior.addEventListener('click', () => mover(-1));
    el.siguiente.addEventListener('click', () => mover(1));
    el.hoy.addEventListener('click', () => {
        cursor = new Date();
        refrescar();
    });

    el.modos.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            modo = btn.dataset.modo;
            el.modos.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b === btn));
            refrescar();
        });
    });

    refrescar();
}

/** Días que el calendario está mostrando; la agenda filtra con esto. */
export function clavesVisibles() {
    if (modo === 'dia') return [claveDia(cursor)];
    if (modo === 'semana') return diasDeSemana(cursor);
    // En mes se listan solo los días del mes, no el relleno de la cuadrícula:
    // si no, la agenda mostraría visitas de meses vecinos.
    return diasDeCuadriculaMes(cursor).filter(c => desdeClave(c).getMonth() === cursor.getMonth());
}

export function refrescarCalendario() {
    render();
}

/** Salta al día de una fecha datetime-local y cambia a modo Día. */
export function irADia(fechaTexto) {
    if (!fechaTexto) return;
    cursor = desdeClave(claveDia(fechaTexto));
    modo = 'dia';
    el.modos.querySelectorAll('button')
        .forEach(b => b.classList.toggle('is-active', b.dataset.modo === 'dia'));
    refrescar();
}

function refrescar() {
    render();
    alCambiar();
}

function mover(direccion) {
    if (modo === 'dia') cursor = sumarDias(cursor, direccion);
    else if (modo === 'semana') cursor = sumarDias(cursor, 7 * direccion);
    else cursor = sumarMeses(cursor, direccion);
    refrescar();
}

// ---------- render ----------

function render() {
    el.cuerpo.innerHTML = '';

    if (modo === 'dia') {
        el.titulo.textContent = etiquetaDiaLarga(claveDia(cursor));
        el.cuerpo.appendChild(resumenDelDia(claveDia(cursor)));
    } else if (modo === 'semana') {
        el.titulo.textContent = etiquetaRangoSemana(cursor);
        el.cuerpo.appendChild(tiraDeSemana());
    } else {
        el.titulo.textContent = etiquetaMes(cursor);
        el.cuerpo.appendChild(cuadriculaDeMes());
    }
}

/** clave de día -> nº de visitas. Una sola pasada sobre las visitas. */
function cargaPorDia() {
    const conteo = {};
    leerVisitas().forEach(v => {
        const c = claveDia(v.fecha);
        conteo[c] = (conteo[c] || 0) + 1;
    });
    return conteo;
}

function resumenDelDia(clave) {
    const visitas = leerVisitas()
        .filter(v => claveDia(v.fecha) === clave)
        .sort((a, b) => hora(a.fecha).localeCompare(hora(b.fecha)));

    const caja = document.createElement('div');
    caja.className = 'cal-dia-resumen';

    if (visitas.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = 'Día libre.';
        caja.appendChild(p);
        return caja;
    }

    visitas.forEach(v => {
        const linea = document.createElement('div');
        linea.className = 'cal-linea';
        if (v.estado === 'completada') linea.classList.add('es-completada');

        const h = document.createElement('span');
        h.className = 'cal-linea-hora';
        h.textContent = hora(v.fecha) || '--:--';

        const nombre = document.createElement('span');
        nombre.className = 'cal-linea-cliente';
        nombre.textContent = v.cliente;

        linea.append(h, nombre);
        caja.appendChild(linea);
    });
    return caja;
}

function tiraDeSemana() {
    const conteo = cargaPorDia();
    const hoy = claveHoy();
    const actual = claveDia(cursor);

    const tira = document.createElement('div');
    tira.className = 'cal-semana';

    diasDeSemana(cursor).forEach(clave => {
        const fecha = desdeClave(clave);
        const dia = document.createElement('button');
        dia.type = 'button';
        dia.className = 'cal-dia';
        dia.classList.toggle('es-hoy', clave === hoy);
        dia.classList.toggle('es-activo', clave === actual);

        const inicial = document.createElement('span');
        inicial.className = 'cal-dia-inicial';
        inicial.textContent = inicialesDias()[(fecha.getDay() + 6) % 7];

        const numero = document.createElement('span');
        numero.className = 'cal-dia-numero';
        numero.textContent = fecha.getDate();

        dia.append(inicial, numero, puntos(conteo[clave] || 0));
        dia.addEventListener('click', () => {
            cursor = fecha;
            modo = 'dia';
            el.modos.querySelectorAll('button')
                .forEach(b => b.classList.toggle('is-active', b.dataset.modo === 'dia'));
            refrescar();
        });

        tira.appendChild(dia);
    });
    return tira;
}

function cuadriculaDeMes() {
    const conteo = cargaPorDia();
    const hoy = claveHoy();
    const mesActual = cursor.getMonth();

    const envoltura = document.createElement('div');
    envoltura.className = 'cal-mes';

    const cabecera = document.createElement('div');
    cabecera.className = 'cal-mes-cabecera';
    inicialesDias().forEach(inicial => {
        const s = document.createElement('span');
        s.textContent = inicial;
        cabecera.appendChild(s);
    });

    const rejilla = document.createElement('div');
    rejilla.className = 'cal-mes-rejilla';

    diasDeCuadriculaMes(cursor).forEach(clave => {
        const fecha = desdeClave(clave);
        const celda = document.createElement('button');
        celda.type = 'button';
        celda.className = 'cal-celda';
        celda.classList.toggle('es-otro-mes', fecha.getMonth() !== mesActual);
        celda.classList.toggle('es-hoy', clave === hoy);

        const numero = document.createElement('span');
        numero.className = 'cal-dia-numero';
        numero.textContent = fecha.getDate();

        celda.append(numero, puntos(conteo[clave] || 0));
        celda.addEventListener('click', () => {
            cursor = fecha;
            modo = 'dia';
            el.modos.querySelectorAll('button')
                .forEach(b => b.classList.toggle('is-active', b.dataset.modo === 'dia'));
            refrescar();
        });

        rejilla.appendChild(celda);
    });

    envoltura.append(cabecera, rejilla);
    return envoltura;
}

/** Hasta 3 puntos; de ahí en adelante "+N" para no reventar la celda. */
function puntos(cantidad) {
    const caja = document.createElement('span');
    caja.className = 'cal-puntos';
    if (cantidad === 0) return caja;

    for (let i = 0; i < Math.min(cantidad, 3); i++) {
        const punto = document.createElement('i');
        punto.className = 'cal-punto';
        caja.appendChild(punto);
    }
    if (cantidad > 3) {
        const mas = document.createElement('i');
        mas.className = 'cal-mas';
        mas.textContent = `+${cantidad - 3}`;
        caja.appendChild(mas);
    }
    return caja;
}
