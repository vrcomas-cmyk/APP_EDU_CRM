/**
 * Módulo de revisión.
 *
 * Una pestaña por flujo, y en cada una solo lo que falta por revisar. Quien entra a revisar
 * evidencias no debería tener que buscar cuáles, ni ver las que ya pasaron por sus manos:
 * una bandeja que no se vacía se deja de mirar.
 *
 * Revisar es una acción de negocio, no una edición: no se toca ni un dato de lo revisado.
 * Queda una revisión nueva, firmada y fechada, y el elemento sale de la cola.
 */

import {
    flujosDisponibles, pendientesDe, conteoPendientes, revisar, historialDe,
    RESULTADOS, ETIQUETAS_RESULTADO, minutosDeRetraso
} from './revisiones.js';
import { consultarVisitas } from './datos.js';
import { comentariosDeVisita } from './comentarios.js';
import { miniaturaEvidencia } from './vistaprevia.js';
import { cabeceraModal, cerrarConEscape, dato } from './campos.js';

let el = {};
let flujoActivo = null;
let alToast = () => {};
let alCambiar = () => {};

export function initRevision({ onToast, onCambio } = {}) {
    alToast = onToast || (() => {});
    alCambiar = onCambio || (() => {});

    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    raiz.hidden = true;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => cerrar());

    const panel = document.createElement('aside');
    panel.className = 'panel-ancho';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Revisión');

    raiz.append(scrim, panel);
    document.body.appendChild(raiz);
    el = { raiz, panel, soltarEscape: () => {} };
}

export function hayRevisionAbierta() { return el.raiz && !el.raiz.hidden; }

export function puedeAbrirRevision() { return flujosDisponibles().length > 0; }

export function abrirRevision() {
    if (!puedeAbrirRevision() || !el.raiz) return;
    const disponibles = flujosDisponibles();
    if (!flujoActivo || !disponibles.some(f => f.clave === flujoActivo)) {
        flujoActivo = disponibles[0].clave;
    }
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    el.soltarEscape = cerrarConEscape(el.panel, cerrar);
    pintar();
}

function cerrar() {
    if (!el.raiz) return;
    el.raiz.hidden = true;
    document.body.style.overflow = '';
    el.soltarEscape();
    alCambiar();
}

// ---------- pintado ----------

function pintar() {
    const visitas = consultarVisitas();
    const { porFlujo, total } = conteoPendientes(visitas);

    el.panel.innerHTML = '';
    el.panel.append(
        cabeceraModal(
            'Revisión',
            total === 0 ? 'Nada pendiente' : `${total} elemento${total === 1 ? '' : 's'} por revisar`,
            cerrar
        ),
        pestanas(porFlujo),
        cuerpo(visitas)
    );
}

function pestanas(porFlujo) {
    const nav = document.createElement('div');
    nav.className = 'seg revision-tabs';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Flujos de revisión');

    flujosDisponibles().forEach(f => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(f.clave === flujoActivo));

        const txt = document.createElement('span');
        txt.textContent = f.nombre;
        btn.appendChild(txt);

        // El contador va en la pestaña: es lo que decide por cuál empezar.
        const n = porFlujo[f.clave] || 0;
        if (n > 0) {
            const badge = document.createElement('span');
            badge.className = 'tab-badge';
            badge.textContent = String(n);
            btn.appendChild(badge);
        }

        btn.addEventListener('click', () => { flujoActivo = f.clave; pintar(); });
        nav.appendChild(btn);
    });

    return nav;
}

function cuerpo(visitas) {
    const body = document.createElement('div');
    body.className = 'panel-body';

    const flujo = flujosDisponibles().find(f => f.clave === flujoActivo);
    if (!flujo) return body;

    const desc = document.createElement('p');
    desc.className = 'ayuda';
    desc.textContent = flujo.descripcion || '';
    body.appendChild(desc);

    const pendientes = pendientesDe(flujo, visitas);

    if (pendientes.length === 0) {
        body.appendChild(bandejaVacia(flujo));
        return body;
    }

    const lista = document.createElement('div');
    lista.className = 'revision-lista';
    pendientes.forEach(p => lista.appendChild(tarjeta(flujo, p)));
    body.appendChild(lista);

    return body;
}

function bandejaVacia(flujo) {
    const caja = document.createElement('div');
    caja.className = 'vacio-grande';

    const t = document.createElement('p');
    t.className = 'vacio-titulo';
    t.textContent = 'Al día';

    const p = document.createElement('p');
    p.className = 'ayuda';
    p.textContent = `No hay nada pendiente en "${flujo.nombre}".`;

    caja.append(t, p);
    return caja;
}

// ---------- tarjeta de un elemento ----------

function tarjeta(flujo, item) {
    const card = document.createElement('div');
    card.className = 'revision-card';

    // --- cabecera ---
    const head = document.createElement('div');
    head.className = 'revision-head';

    const txt = document.createElement('div');
    txt.className = 'revision-head-txt';

    const titulo = document.createElement('span');
    titulo.className = 'revision-titulo';
    titulo.textContent = item.titulo;

    const detalle = document.createElement('span');
    detalle.className = 'revision-detalle';
    detalle.textContent = item.detalle;

    txt.append(titulo, detalle);
    head.appendChild(txt);

    // La evidencia se ve, no se describe: revisar veinte archivos abriendo veinte pestañas
    // es exactamente lo que hace que la revisión no ocurra.
    if (item.actividad) {
        const mini = miniaturaEvidencia(item.actividad);
        if (mini) head.appendChild(mini);
    }

    card.appendChild(head);

    // --- contexto ---
    card.appendChild(contexto(flujo, item));

    // --- lo ya dicho ---
    const historial = historialDe(flujo.clave, item.id_ambito);
    if (historial.length) card.appendChild(bloqueHistorial(historial));

    const charla = comentariosDeVisita(item.id_visita);
    if (charla.length) card.appendChild(bloqueComentarios(charla));

    // --- acciones ---
    card.appendChild(acciones(flujo, item));

    return card;
}

function contexto(flujo, item) {
    const caja = document.createElement('div');
    caja.className = 'datos revision-datos';

    const v = item.visita;
    caja.append(
        dato('Educador', v.educador),
        dato('Cliente', v.cliente),
        dato('Fecha', v.dia)
    );

    if (item.actividad) {
        const a = item.actividad;
        caja.append(
            dato('Área visitada', a.area_visitada),
            dato('Contacto', a.contacto?.nombre),
            dato('Materiales', String((a.materiales || []).length))
        );
    } else {
        caja.append(
            dato('Horario', `${v.hora_inicio || '—'}–${v.hora_fin || '—'}`),
            dato('Sectores', String((v.sectores || []).length))
        );
        if (flujo.clave === 'retrasos') {
            caja.appendChild(dato('Retraso', `${minutosDeRetraso(v)} min`));
        }
    }
    return caja;
}

function bloqueHistorial(historial) {
    const caja = document.createElement('details');
    caja.className = 'historial';

    const s = document.createElement('summary');
    s.textContent = `Revisado ${historial.length} ${historial.length === 1 ? 'vez' : 'veces'} antes`;
    caja.appendChild(s);

    historial.slice().reverse().forEach(r => {
        const item = document.createElement('div');
        item.className = 'historial-item';

        const linea = document.createElement('p');
        const punto = document.createElement('span');
        punto.className = `dot st-${tono(r.resultado)}`;
        const etq = document.createElement('span');
        etq.textContent = ` ${ETIQUETAS_RESULTADO[r.resultado] || r.resultado}`;
        linea.append(punto, etq);

        const meta = document.createElement('p');
        meta.className = 'historial-meta';
        meta.textContent = `${r.revisor || r.revisor_correo || 'Sin revisor'} · ${fecha(r.momento)}`;

        item.append(linea, meta);

        if (r.observaciones) {
            const obs = document.createElement('p');
            obs.className = 'coment-txt';
            obs.textContent = r.observaciones;
            item.appendChild(obs);
        }
        caja.appendChild(item);
    });
    return caja;
}

function bloqueComentarios(charla) {
    const caja = document.createElement('details');
    caja.className = 'historial';

    const s = document.createElement('summary');
    s.textContent = `${charla.length} comentario${charla.length === 1 ? '' : 's'} en la visita`;
    caja.appendChild(s);

    charla.forEach(c => {
        const item = document.createElement('div');
        item.className = 'historial-item';
        const meta = document.createElement('p');
        meta.className = 'historial-meta';
        meta.textContent = `${c.usuario || 'Sin autor'} · ${fecha(c.momento)}`;
        const txt = document.createElement('p');
        txt.className = 'coment-txt';
        txt.textContent = c.texto;
        item.append(meta, txt);
        caja.appendChild(item);
    });
    return caja;
}

function tono(resultado) {
    return {
        [RESULTADOS.APROBADO]: 'completa',
        [RESULTADOS.RECHAZADO]: 'sin-registrar',
        [RESULTADOS.CORRECCION]: 'faltan-evidencias'
    }[resultado] || 'neutra';
}

function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
}

// ---------- acciones ----------

function acciones(flujo, item) {
    const caja = document.createElement('div');
    caja.className = 'revision-acciones';

    const obs = document.createElement('textarea');
    obs.className = 'inp hilo-area';
    obs.rows = 2;
    obs.placeholder = 'Observaciones…';

    const fila = document.createElement('div');
    fila.className = 'revision-botones';

    const aviso = document.createElement('span');
    aviso.className = 'pista';

    const mandar = (resultado) => {
        const r = revisar({
            flujo: flujo.clave,
            ambito: flujo.ambito,
            idAmbito: item.id_ambito,
            idVisita: item.id_visita,
            resultado,
            observaciones: obs.value
        });
        if (!r.ok) {
            aviso.textContent = r.error;
            obs.focus();
            return;
        }
        alToast(`${ETIQUETAS_RESULTADO[resultado]} · ${item.titulo}`, {
            estado: resultado === RESULTADOS.APROBADO ? 'completa' : 'programada'
        });
        alCambiar();
        pintar();     // el elemento sale de la cola
    };

    const botones = [
        [RESULTADOS.APROBADO, '✓ Aprobar', 'btn btn-principal'],
        [RESULTADOS.CORRECCION, '↺ Requiere corrección', 'btn-txt'],
        [RESULTADOS.RECHAZADO, '✕ Rechazar', 'btn-txt peligro']
    ];

    botones.forEach(([resultado, etiqueta, clase]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = clase;
        b.textContent = etiqueta;
        b.addEventListener('click', () => mandar(resultado));
        fila.appendChild(b);
    });

    // Aprobar sin escribir nada es válido; rechazar no. Se dice antes de que lo intenten.
    const nota = document.createElement('p');
    nota.className = 'ayuda';
    nota.textContent = 'Rechazar o pedir corrección exige explicar qué hay que arreglar.';

    caja.append(obs, aviso, fila, nota);
    return caja;
}
