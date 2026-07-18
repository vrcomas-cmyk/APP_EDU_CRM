/**
 * Drawer. Lateral en escritorio, bottom-sheet a altura completa en móvil. Nunca modal
 * centrado: al agendar la pregunta real es "¿dónde cabe esto?", y un modal tapa la respuesta.
 *
 * Dos niveles que se empujan:
 *   VISITA    capturarla (borrador) o ver una ya guardada (congelada, con check-in/out).
 *   SECTOR    sus datos ya sellados y la lista de sus actividades. Solo en visitas guardadas.
 *
 * El SECTOR, la ACTIVIDAD y el MATERIAL no se capturan aquí: cada uno abre su ventana propia
 * (sector.js, actividad.js, materiales.js). El drawer los lista y los cuenta.
 *
 * ── Las dos vidas de la visita ───────────────────────────────────────────────────────
 *
 *   BORRADOR   Nada existe todavía. Fecha y horario nacen VACÍOS —un valor por defecto se
 *              acepta sin leerlo— y el botón Guardar no se habilita hasta que estén los siete
 *              obligatorios, sectores incluidos. Cerrar sin guardar descarta.
 *
 *   GUARDADA   Cliente, hospital, educador, fecha y horario la identifican, así que se
 *              congelan; sus sectores se sellan en el mismo acto. Para moverla está
 *              Reagendar, que deja historial: editarlos en silencio borraría el rastro.
 *              Lo que sigue abierto son las acciones — check-in/out, agregar sector,
 *              registrar actividades — nunca la edición de lo ya afirmado.
 */

import {
    leerVisitas, leerCatalogo, agregarVisita, actualizarVisita, obtenerVisita,
    eliminarVisita, nuevoId, historialHospitales
} from './storage.js';
import {
    buscarSolapes, saludDe, estadoDe, detalleEstado, ESTADOS,
    duracionTexto, permanenciaTexto, tieneCheckIn, tieneCheckOut,
    estadoSector, etiquetaSector, estaGuardada
} from './estado.js';
import { requiereEvidencia } from './catalogos.js';
import {
    iniciarVisita, finalizarVisita, reagendarVisita, cancelarVisita, reactivarVisita,
    bloqueoParaActividades, puedeIniciar
} from './visita.js';
import { registrar, TIPOS } from './eventos.js';
import { abrirActividad } from './actividad.js';
import { abrirSector } from './sector.js';
import { envolver, resaltar, dato } from './campos.js';
import { hiloComentarios, pastillaComentarios, AMBITOS } from './hilo.js';
import { historicoDeHospital } from './comentarios.js';
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
    scrim.addEventListener('click', () => cerrar());

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

/**
 * Nueva visita, siempre como BORRADOR: no existe para nadie hasta que se guarde.
 *
 * Fecha y horario llegan vacíos a propósito. Antes se sembraban con hoy y 09:00, y una visita
 * quedaba registrada con una fecha que nadie eligió — abrir el formulario sin querer bastaba
 * para ensuciar el calendario. Un campo vacío obliga a decidir; uno prellenado se acepta sin
 * leerlo.
 *
 * La excepción es arrastrar sobre el calendario: ahí el gesto YA eligió día y horas, así que
 * llegan puestas. Eso no es un valor por defecto, es lo que el usuario acaba de señalar.
 */
export function abrirNuevaVisita({ dia = '', hora_inicio = '', hora_fin = '' } = {}) {
    const sesion = sesionActual();
    const visita = agregarVisita({
        id: nuevoId('v'),
        educador: sesion?.nombre || '', educador_correo: sesion?.correo || '',
        cliente: '', hospital: '',
        dia, hora_inicio, hora_fin,
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

/**
 * Cerrar sin guardar DESCARTA el borrador.
 *
 * Es deliberado y es lo contrario de lo que hace la actividad, que sí conserva su borrador.
 * La diferencia es que la actividad cuelga de una visita que ya existe y se ve en su lista;
 * una visita a medias no colgaría de nada. Guardarla la pondría en el calendario como una cita
 * real que nadie confirmó, y no guardarla pero conservarla la volvería invisible: trabajo
 * atrapado en un registro que ya no aparece por ningún lado.
 *
 * Si hay algo escrito se pregunta antes; un clic de más no debe costar la captura.
 */
function cerrar() {
    const visita = obtenerVisita(visitaId);
    if (visita?.borrador) {
        const tieneAlgo = !!(visita.cliente?.trim() || visita.hospital?.trim()
            || visita.dia || (visita.sectores || []).length);

        if (tieneAlgo
            && !confirm('Esta visita no se ha guardado.\n\n¿Descartarla? Lo capturado se pierde.')) {
            return;
        }
        eliminarVisita(visita.id);
    }

    el.raiz.hidden = true;
    document.body.style.overflow = '';
    visitaId = null;
    sectorId = null;
    alCambiar();
}

// ---------- guardado ----------

/** Lo que la visita exige para poder existir. Devuelve [] cuando ya se puede guardar. */
function faltaParaGuardar(visita) {
    const falta = [];
    if (!(visita.educador || '').trim()) falta.push('Educador');
    if (!(visita.cliente || '').trim()) falta.push('Cliente');
    if (!(visita.hospital || '').trim()) falta.push('Hospital');
    if (!visita.dia) falta.push('Fecha');
    if (!visita.hora_inicio) falta.push('Hora de inicio');
    if (!visita.hora_fin) falta.push('Hora de término');
    if (!(visita.sectores || []).length) falta.push('Al menos un sector');
    return falta;
}

/**
 * Aquí nace la visita. Se valida, se le quita el borrador y se sellan sus sectores de paso:
 * a partir de este clic, objetivo, origen y solicitado_por dejan de editarse.
 */
function guardarVisita() {
    const visita = obtenerVisita(visitaId);
    if (!visita) return;

    const falta = faltaParaGuardar(visita);
    if (falta.length > 0) {
        return alToast(`Falta ${falta.join(' · ')}.`, { estado: 'sin-registrar', ms: 6000 });
    }

    const sesion = sesionActual();
    const sello = { momento: new Date().toISOString(), usuario: sesion?.nombre || '' };

    const guardada = actualizarVisita(visitaId, v => {
        delete v.borrador;
        (v.sectores || []).forEach(s => { if (!s.guardado) s.guardado = { ...sello }; });
    });

    registrarProgramada(guardada);
    alToast('Visita guardada. Sus sectores quedan registrados y ya no se editan.',
        { estado: 'completa', ms: 5000 });
    alCambiar();
    pintar();
}

function registrarProgramada(visita) {
    registrar(TIPOS.VISITA_PROGRAMADA, visita, {
        dia: visita.dia, hora_inicio: visita.hora_inicio, hora_fin: visita.hora_fin,
        sectores: (visita.sectores || []).map(s => s.nombre).join(', ')
    });
}

/**
 * Guarda el cambio en el borrador. NO lo convierte en visita: eso solo lo hace Guardar visita.
 * El autoguardado es una red contra perder lo escrito, no un registro.
 */
function editar(mutador, { repintar = false } = {}) {
    actualizarVisita(visitaId, mutador);
    marcarGuardado();
    alCambiar();
    if (repintar) pintar();
    else refrescarPie();
}

/**
 * Repinta SOLO el pie. Escribir el nombre del cliente puede ser lo último que faltaba para
 * poder guardar, así que el botón tiene que reaccionar tecla a tecla — pero repintar el panel
 * entero en cada letra sacaría el cursor del campo en el que se está escribiendo.
 */
function refrescarPie() {
    if (sectorId) return;
    const visita = obtenerVisita(visitaId);
    if (!visita?.borrador) return;
    el.panel.querySelector('.drawer-foot')?.replaceWith(pie(visita));
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
    x.addEventListener('click', () => cerrar());

    head.append(izq, x);
    return head;
}

function cuerpoVisita(visita) {
    const body = document.createElement('div');
    body.className = 'drawer-body';

    if (visita.borrador) {
        body.append(campoEducador(visita), campoCliente(visita), campoHospital(visita),
                    campoFecha(visita), campoHoras(visita));
        const antecedentes = bloqueHistorico(visita);
        if (antecedentes) body.appendChild(antecedentes);
    } else {
        if (estadoDe(visita) === ESTADOS.CANCELADA) body.appendChild(avisoCancelada(visita));
        else body.appendChild(bloqueCheck(visita));

        body.appendChild(panelInformacion(visita));
        body.appendChild(bloqueComentarios(visita));

        if (reagendando) body.appendChild(bloqueReagendar(visita));
        if ((visita.reagendas || []).length) body.appendChild(historialReagendas(visita));
    }

    body.appendChild(listaSectores(visita));
    return body;
}

/**
 * Panel de información: lo que identifica a la visita, en frío.
 *
 * Nunca lleva botón de editar, y no porque se haya olvidado: cliente, hospital, educador,
 * fecha y horario son lo que la visita AFIRMA. Cambiarlos en silencio la convertiría en otra
 * visita conservando su historial —su check-in, sus actividades— que ya no le corresponde.
 * Para moverla está Reagendar; para lo demás, una visita nueva.
 */
function panelInformacion(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo panel-info';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Información de la visita';
    caja.appendChild(lbl);

    const datos = document.createElement('div');
    datos.className = 'datos';
    datos.append(
        dato('Educador', visita.educador),
        dato('Cliente', visita.cliente),
        dato('Hospital', visita.hospital),
        dato('Fecha', etiquetaDiaLarga(visita.dia)),
        dato('Horario', `${visita.hora_inicio}–${visita.hora_fin} · ${duracionTexto(visita)}`),
        dato('Sectores', String((visita.sectores || []).length))
    );
    caja.appendChild(datos);

    const nota = document.createElement('p');
    nota.className = 'ayuda';
    nota.textContent = 'Estos datos identifican la visita y no se editan. Usa Reagendar o Cancelar.';
    caja.appendChild(nota);

    return caja;
}

/** Conversación de la visita. Se agrega, nunca se corrige. */
function bloqueComentarios(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Comentarios';
    caja.appendChild(lbl);

    caja.appendChild(hiloComentarios({
        ambito: AMBITOS.VISITA,
        idAmbito: visita.id,
        visita,
        alToast
    }));
    return caja;
}

/**
 * Lo que ya se dijo de este hospital, mientras se programa la visita.
 *
 * Un hospital con observaciones repetidas es contexto que hoy se pierde entre visitas: lo
 * escribe quien fue en marzo y lo necesita quien va en julio, que suele ser otra persona.
 * Aparece durante la CAPTURA, no después: leerlo cuando ya estás en el hospital llega tarde.
 */
function bloqueHistorico(visita) {
    const previos = historicoDeHospital(visita.hospital, { excluirVisita: visita.id, limite: 3 });
    if (previos.length === 0) return null;

    const caja = document.createElement('div');
    caja.className = 'historico';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = `Antes se dijo de ${visita.hospital}`;
    caja.appendChild(lbl);

    previos.forEach(c => {
        const item = document.createElement('div');
        item.className = 'coment';

        const meta = document.createElement('div');
        meta.className = 'coment-meta';
        const quien = document.createElement('span');
        quien.className = 'coment-autor';
        quien.textContent = c.usuario || 'Sin autor';
        const cuando = document.createElement('span');
        cuando.className = 'coment-fecha mono';
        cuando.textContent = new Date(c.momento).toLocaleDateString('es-MX', {
            day: '2-digit', month: 'short', year: '2-digit'
        });
        meta.append(quien, cuando);

        const txt = document.createElement('p');
        txt.className = 'coment-txt';
        txt.textContent = c.texto;

        item.append(meta, txt);
        caja.appendChild(item);
    });

    return caja;
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
        p.textContent = visita.borrador
            ? 'Una visita necesita al menos un sector. Agrega los que vas a trabajar.'
            : 'Esta visita no tiene sectores.';
        caja.appendChild(p);
    }

    const lista = document.createElement('div');
    lista.className = 'sectores';
    visita.sectores.forEach(s => lista.appendChild(tarjetaSector(visita, s)));
    caja.appendChild(lista);

    // Un solo botón en vez de la pared de chips del catálogo: la elección vive en su ventana.
    if (estadoDe(visita) !== ESTADOS.CANCELADA) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn-dashed';
        add.textContent = '+ Agregar sector';
        add.addEventListener('click', () => abrirVentanaSector(null));
        caja.appendChild(add);
    }
    return caja;
}

/**
 * Abre la ventana de sectores. En una visita ya guardada, lo que se capture ahí se sella al
 * cerrarla: la visita ya existe, así que un sector nuevo nace definitivo en vez de esperar a
 * un "Guardar visita" que ya ocurrió.
 */
function abrirVentanaSector(sectorId) {
    const eraBorrador = !!obtenerVisita(visitaId)?.borrador;

    abrirSector({
        host: el.raiz,
        visitaId,
        sectorId,
        alToast,
        alCambiar: () => { alCambiar(); pintar(); },
        alCerrar: () => {
            if (eraBorrador) return;
            const sesion = sesionActual();
            const sello = { momento: new Date().toISOString(), usuario: sesion?.nombre || '' };
            actualizarVisita(visitaId, v => {
                (v.sectores || []).forEach(s => { if (!s.guardado) s.guardado = { ...sello }; });
            });
            alCambiar();
            pintar();
        }
    });
}

/** Lo que un sector lleva acumulado. Se calcula una vez y lo usan la tarjeta y la cabecera. */
function resumenSector(sector) {
    const actividades = sector.actividades || [];
    return {
        actividades: actividades.length,
        borradores: actividades.filter(a => !estaGuardada(a)).length,
        materiales: actividades.reduce((n, a) => n + (a.materiales || []).length, 0),
        evidenciasPendientes: actividades
            .filter(a => requiereEvidencia(a) && a.evidencia?.estado !== 'subida').length
    };
}

/**
 * Tarjeta de sector. Muestra de un vistazo todo lo que se querría saber antes de entrar:
 * qué se buscaba, quién lo pidió, y cuánto se lleva registrado. Los contadores importan más
 * que el detalle — desde afuera la pregunta es "¿me falta algo aquí?", no "¿qué dice?".
 */
function tarjetaSector(visita, sector) {
    const est = estadoSector(visita, sector);
    const r = resumenSector(sector);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sector-card';
    card.dataset.sector = sector.id;
    card.dataset.estado = est;

    // --- cabecera: nombre + estado ---
    const head = document.createElement('span');
    head.className = 'sector-card-head';

    const nombre = document.createElement('span');
    nombre.className = 'sector-card-nombre';
    nombre.textContent = sector.nombre;

    const chip = document.createElement('span');
    chip.className = `sector-estado es-${est}`;
    chip.textContent = etiquetaSector(est);

    const flecha = document.createElement('span');
    flecha.className = 'sector-fila-flecha';
    flecha.textContent = '›';

    head.append(nombre, chip, flecha);

    // --- objetivo, origen y quién lo pidió ---
    const cuerpo = document.createElement('span');
    cuerpo.className = 'sector-card-cuerpo';

    const objetivo = document.createElement('span');
    objetivo.className = 'sector-card-objetivo';
    objetivo.textContent = sector.objetivo || 'Sin objetivo';
    if (!sector.objetivo) objetivo.classList.add('es-vacio');
    cuerpo.appendChild(objetivo);

    const procedencia = [
        (sector.origen || []).join(', '),
        sector.solicitado_por ? `Pidió: ${sector.solicitado_por}` : ''
    ].filter(Boolean).join(' · ');
    if (procedencia) {
        const p = document.createElement('span');
        p.className = 'sector-card-origen';
        p.textContent = procedencia;
        cuerpo.appendChild(p);
    }

    // --- contadores ---
    const meta = document.createElement('span');
    meta.className = 'sector-card-meta';

    meta.appendChild(contador(r.actividades, r.actividades === 1 ? 'actividad' : 'actividades'));
    if (r.materiales > 0) {
        meta.appendChild(contador(r.materiales, r.materiales === 1 ? 'material' : 'materiales'));
    }
    if (r.borradores > 0) {
        const b = document.createElement('span');
        b.className = 'pill st-programada';
        b.textContent = `${r.borradores} sin guardar`;
        meta.appendChild(b);
    }
    if (r.evidenciasPendientes > 0) {
        const p = document.createElement('span');
        p.className = 'pill st-faltan-evidencias';
        p.textContent = `${r.evidenciasPendientes} evid.`;
        meta.appendChild(p);
    }
    const charla = pastillaComentarios(AMBITOS.SECTOR, sector.id);
    if (charla) meta.appendChild(charla);

    card.append(head, cuerpo, meta);

    // Mientras la visita es borrador el sector todavía se corrige, y eso pasa en su ventana.
    // Ya guardada, entrar al sector es entrar a sus actividades: no hay nada que editar.
    card.addEventListener('click', () => {
        if (visita.borrador) abrirVentanaSector(sector.id);
        else { sectorId = sector.id; pintar(); }
    });
    return card;
}

function contador(n, etiqueta) {
    const c = document.createElement('span');
    c.className = 'sector-cuenta';
    c.textContent = `${n} ${etiqueta}`;
    return c;
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
    x.addEventListener('click', () => cerrar());

    head.append(volver, izq, x);
    return head;
}

/**
 * El sector, ya sellado. Solo se llega aquí desde una visita guardada —mientras es borrador,
 * el sector se corrige en su ventana— así que no hay nada editable: objetivo, origen y quién
 * lo pidió son parte de lo que la visita afirmó al guardarse.
 *
 * Lo único que sigue abierto son las actividades, que es justo lo que se viene a hacer aquí.
 */
function cuerpoSector(visita, sector) {
    const body = document.createElement('div');
    body.className = 'drawer-body';

    const info = document.createElement('div');
    info.className = 'campo panel-info';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Sector registrado';
    info.appendChild(lbl);

    const datos = document.createElement('div');
    datos.className = 'datos';
    datos.append(
        dato('Objetivo', sector.objetivo),
        dato('Origen de la actividad', (sector.origen || []).join(', ')),
        dato('Solicitado por', sector.solicitado_por)
    );
    info.appendChild(datos);

    const nota = document.createElement('p');
    nota.className = 'ayuda';
    nota.textContent = 'Estos datos se registraron al guardar la visita y no se editan.';
    info.appendChild(nota);

    body.append(info, bloqueActividades(visita, sector));
    return body;
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

    sector.actividades.forEach((act, i) => caja.appendChild(filaActividad(sector, act, i + 1)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-principal btn-registrar';
    add.textContent = '+ Registrar actividad';
    add.addEventListener('click', () => abrirVentanaActividad(sector, null));
    caja.appendChild(add);

    return caja;
}

/** El drawer no captura actividades: las abre. Una a la vez, en su propia ventana. */
function abrirVentanaActividad(sector, actividadId) {
    abrirActividad({
        host: el.raiz,
        visitaId,
        sectorId: sector.id,
        actividadId,
        alCambiar: () => { alCambiar(); pintar(); },
        alToast
    });
}

/**
 * Una actividad en la lista del sector: qué fue, con quién, y en qué estado quedó.
 *
 * Es una fila y no una tarjeta desplegada porque desde aquí no se edita nada — solo se decide
 * cuál abrir. El detalle completo vive en su ventana.
 */
function filaActividad(sector, act, numero) {
    const guardada = estaGuardada(act);
    const debeEvidencia = requiereEvidencia(act);

    const fila = document.createElement('button');
    fila.type = 'button';
    fila.className = 'act-fila' + (guardada ? '' : ' es-borrador');
    fila.dataset.actividad = act.id;

    const n = document.createElement('span');
    n.className = 'act-n';
    n.textContent = numero;

    const txt = document.createElement('span');
    txt.className = 'act-fila-txt';

    const titulo = document.createElement('span');
    titulo.className = 'act-fila-titulo';
    titulo.textContent = act.tipo || 'Sin tipo';
    if (!act.tipo) titulo.classList.add('es-vacio');

    const sub = document.createElement('span');
    sub.className = 'act-fila-sub';
    sub.textContent = [
        act.area_visitada,
        (act.contacto?.nombre || '').trim(),
        (act.materiales || []).length ? `${act.materiales.length} mat.` : ''
    ].filter(Boolean).join(' · ') || 'Sin capturar';

    txt.append(titulo, sub);

    const meta = document.createElement('span');
    meta.className = 'act-fila-meta';

    if (!guardada) {
        const b = document.createElement('span');
        b.className = 'pill st-programada';
        b.textContent = 'Borrador';
        meta.appendChild(b);
    } else if (debeEvidencia && act.evidencia?.estado !== 'subida') {
        const e = document.createElement('span');
        e.className = 'pill st-faltan-evidencias';
        e.textContent = act.evidencia?.estado === 'local' ? 'Evid. en cola' : 'Falta evidencia';
        meta.appendChild(e);
    } else {
        const ok = document.createElement('span');
        ok.className = 'pill st-completa';
        ok.textContent = '✓ Completa';
        meta.appendChild(ok);
    }

    const flecha = document.createElement('span');
    flecha.className = 'sector-fila-flecha';
    flecha.textContent = '›';

    fila.append(n, txt, meta, flecha);
    fila.addEventListener('click', () => abrirVentanaActividad(sector, act.id));
    return fila;
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

    if (sectorId) {
        const volver = document.createElement('button');
        volver.type = 'button';
        volver.className = 'btn';
        volver.textContent = '\u2039 Volver a la visita';
        volver.addEventListener('click', () => { sectorId = null; pintar(); });

        const spacer = document.createElement('span');
        spacer.style.flex = '1';
        foot.append(spacer, volver);
        return foot;
    }

    // Un borrador no tiene "Listo": tiene Guardar. Y el botón dice qué falta en vez de
    // quedarse gris sin explicar por qué, que es la peor versión de un botón deshabilitado.
    if (visita.borrador) return pieBorradorVisita(visita, foot);

    const saving = document.createElement('span');
    saving.className = 'saving';
    const led = document.createElement('span');
    led.className = 'led';
    const txt = document.createElement('span');
    txt.className = 'saving-txt';
    txt.textContent = 'Guardado local';
    saving.append(led, txt);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    foot.append(saving, spacer);

    {
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
    listo.addEventListener('click', () => cerrar());
    foot.appendChild(listo);

    return foot;
}

/**
 * Pie del borrador: qué falta, descartar y guardar.
 *
 * El botón se queda deshabilitado hasta que no falte nada —esa es la regla— pero al lado
 * siempre se lee la lista de lo que impide guardar. Un botón gris sin motivo se interpreta
 * como que la app está rota.
 */
function pieBorradorVisita(visita, foot) {
    const falta = faltaParaGuardar(visita);

    const pista = document.createElement('span');
    pista.className = 'pista';
    if (falta.length === 0) {
        pista.textContent = 'Listo para guardar.';
        pista.classList.add('es-ok');
    } else {
        pista.textContent = `Falta ${falta.join(' \u00b7 ')}`;
    }

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const descartar = document.createElement('button');
    descartar.type = 'button';
    descartar.className = 'btn-txt peligro';
    descartar.textContent = 'Descartar';
    descartar.addEventListener('click', () => cerrar());

    const guardar = document.createElement('button');
    guardar.type = 'button';
    guardar.className = 'btn btn-principal';
    guardar.textContent = 'Guardar visita';
    guardar.disabled = falta.length > 0;
    if (falta.length > 0) guardar.title = `Falta: ${falta.join(', ')}`;
    guardar.addEventListener('click', guardarVisita);

    foot.append(pista, spacer, descartar, guardar);
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
            origen: [...(s.origen || [])], solicitado_por: s.solicitado_por || '',
            actividades: []
        })),
        sincronizado: false,
        borrador: true
    });
    cerrar();
    abrir(nueva.id);
}

// ---------- campos ----------

/**
 * El educador no se elige: es quien tiene la sesión abierta. Se muestra —el spec lo pide como
 * obligatorio y hay que poder verlo— pero como dato, no como campo: dejar escribir aquí
 * permitiría registrar una visita a nombre de otra persona.
 */
function campoEducador(visita) {
    const caja = document.createElement('div');
    caja.className = 'campo';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = 'Educador';
    caja.appendChild(lbl);

    if ((visita.educador || '').trim()) {
        const v = document.createElement('p');
        v.className = 'dato-val';
        v.textContent = visita.educador;
        caja.appendChild(v);
    } else {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = 'No se pudo leer tu nombre de la sesión. Vuelve a entrar antes de agendar.';
        caja.appendChild(p);
    }
    return caja;
}

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
