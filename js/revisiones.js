/**
 * Flujos de revisión.
 *
 * Cada flujo es independiente y no sabe de los demás. Quien revisa que la foto se vea bien
 * no es quien juzga si la visita valió la pena: con una sola aprobación global, la primera
 * persona en llegar cerraría el registro y las otras ya no podrían opinar — o peor, una
 * "rechaza" y borra el visto bueno de otra sobre algo completamente distinto.
 *
 * Por eso el estado no vive en la visita: vive en la pareja (flujo, elemento).
 *
 * ── Append-only ──────────────────────────────────────────────────────────────────────
 *
 * Una revisión no se edita ni se borra. El estado vigente de un elemento en un flujo es su
 * revisión MÁS RECIENTE; las anteriores se conservan porque son las que cuentan la historia:
 * rechazado → corregido → aprobado dice algo que "aprobado" solo, no.
 *
 * ── Qué está pendiente ───────────────────────────────────────────────────────────────
 *
 * Un elemento está pendiente si nunca se revisó en ese flujo, o si su última revisión pidió
 * corrección. "Rechazado" NO vuelve a la cola: ya se decidió, y reaparecer obligaría a
 * volver a rechazar lo mismo cada vez.
 */

import { nuevoId } from './storage.js';
import { sesionActual } from './auth.js';
import { puede } from './permisos.js';
import { consultarVisitas } from './datos.js';
import { estadoDe, ESTADOS, tieneCheckIn, actividadesGuardadasDe } from './estado.js';
import { requiereEvidencia } from './catalogos.js';

const CLAVE_PENDIENTES = 'revisiones_pendientes';

export const RESULTADOS = {
    APROBADO: 'aprobado',
    RECHAZADO: 'rechazado',
    CORRECCION: 'correccion'
};

export const ETIQUETAS_RESULTADO = {
    [RESULTADOS.APROBADO]: 'Aprobado',
    [RESULTADOS.RECHAZADO]: 'Rechazado',
    [RESULTADOS.CORRECCION]: 'Requiere corrección'
};

/**
 * Flujos por defecto. Los reales llegan de la base de datos; estos existen para que el
 * módulo funcione antes de la primera sincronización y para no depender de la red para
 * saber qué se revisa.
 */
export const FLUJOS_POR_DEFECTO = [
    { clave: 'evidencia', nombre: 'Evidencias', ambito: 'actividad',
      permiso: 'evidencias.aprobar', orden: 1,
      descripcion: 'Que el archivo corresponda a la actividad y se vea legible.' },
    { clave: 'calidad_visita', nombre: 'Calidad de la visita', ambito: 'visita',
      permiso: 'visitas.calificar', orden: 2,
      descripcion: 'Si lo registrado justifica el tiempo invertido en el cliente.' },
    { clave: 'retrasos', nombre: 'Justificación de retrasos', ambito: 'visita',
      permiso: 'visitas.revisar', orden: 3,
      descripcion: 'Solo aparece cuando la llegada fue más de 15 minutos tarde.' },
    { clave: 'cumplimiento', nombre: 'Cumplimiento de actividades', ambito: 'visita',
      permiso: 'actividades.revisar', orden: 4,
      descripcion: 'Si se hizo lo que el sector se había propuesto como objetivo.' },
    { clave: 'documentacion', nombre: 'Calidad de la documentación', ambito: 'actividad',
      permiso: 'actividades.calificar', orden: 5,
      descripcion: 'Si el contacto, el área y los materiales están bien capturados.' }
];

const MINUTOS_DE_GRACIA = 15;

// ---------- estado en memoria ----------

let flujos = [...FLUJOS_POR_DEFECTO];
let revisiones = [];        // histórico traído del servidor
let cargadas = false;

export function ponerFlujos(lista) {
    if (Array.isArray(lista) && lista.length) flujos = lista;
}

export function ponerRevisiones(lista) {
    revisiones = Array.isArray(lista) ? lista : [];
    cargadas = true;
}

export function hayRevisionesCargadas() { return cargadas; }

export function olvidarRevisiones() {
    revisiones = [];
    cargadas = false;
    flujos = [...FLUJOS_POR_DEFECTO];
}

/** Solo los flujos en los que este usuario puede actuar. */
export function flujosDisponibles() {
    return flujos.filter(f => {
        const [modulo, accion] = String(f.permiso || '').split('.');
        return modulo && accion && puede(modulo, accion);
    });
}

export function todosLosFlujos() { return flujos; }

export function puedeRevisar() { return flujosDisponibles().length > 0; }

// ---------- historial y estado vigente ----------

/** Lo enviado que aún no sube se mezcla con lo del servidor: la cola no puede ser invisible. */
function todasLasRevisiones() {
    return [...revisiones, ...pendientesDeSubir()];
}

export function historialDe(flujo, idAmbito) {
    return todasLasRevisiones()
        .filter(r => r.flujo === flujo && r.id_ambito === idAmbito)
        .sort(porOrden);
}

/** Mismo criterio de desempate que el servidor: momento y, si empatan, el secuencial. */
function porOrden(a, b) {
    const d = String(a.momento || '').localeCompare(String(b.momento || ''));
    if (d !== 0) return d;
    return Number(a.seq || 0) - Number(b.seq || 0);
}

export function revisionVigente(flujo, idAmbito) {
    const h = historialDe(flujo, idAmbito);
    return h.length ? h[h.length - 1] : null;
}

/** Un elemento sigue en la cola si nunca se revisó o si se pidió corregirlo. */
export function estaPendiente(flujo, idAmbito) {
    const v = revisionVigente(flujo, idAmbito);
    return !v || v.resultado === RESULTADOS.CORRECCION;
}

// ---------- qué se puede revisar ----------

/**
 * Qué elementos entran a cada flujo.
 *
 * No todo es revisable siempre: pedir evidencia de una actividad cuyo tipo no la exige es
 * deuda imposible, y juzgar la calidad de una visita que aún no ocurre no significa nada.
 * Esta es la única lógica del módulo que sí vive en código —depende de la forma del árbol,
 * no de una preferencia— y por eso está en un solo lugar.
 */
function candidatosDe(flujo, visitas) {
    const salida = [];

    for (const v of visitas) {
        const estado = estadoDe(v);
        if (estado === ESTADOS.CANCELADA) continue;   // no ocurrió: no hay qué juzgar

        if (flujo.clave === 'retrasos') {
            if (!minutosDeRetraso(v)) continue;
            salida.push(elemento(flujo, v, v.id, tituloVisita(v), detalleRetraso(v)));
            continue;
        }

        if (flujo.ambito === 'visita') {
            // Solo lo que ya pasó. Una visita programada no tiene nada que revisar todavía.
            if (!tieneCheckIn(v)) continue;
            if (flujo.clave === 'cumplimiento' && actividadesGuardadasDe(v).length === 0) continue;
            salida.push(elemento(flujo, v, v.id, tituloVisita(v), resumenVisita(v)));
            continue;
        }

        // ámbito actividad
        for (const s of v.sectores || []) {
            for (const a of s.actividades || []) {
                if (!a.guardada) continue;            // un borrador no es un hecho

                if (flujo.clave === 'evidencia') {
                    // Sin archivo cargado no hay nada que mirar; el pendiente de SUBIRLA es
                    // deuda del educador, no trabajo del revisor.
                    if (a.evidencia?.estado !== 'subida') continue;
                    if (!requiereEvidencia(a)) continue;
                }

                salida.push(elemento(
                    flujo, v, a.id,
                    `${a.tipo || 'Sin tipo'} · ${s.nombre}`,
                    `${v.hospital || v.cliente || 'Sin hospital'} · ${v.dia || ''}`,
                    { actividad: a, sector: s }
                ));
            }
        }
    }
    return salida;
}

function elemento(flujo, visita, idAmbito, titulo, detalle, extra = {}) {
    return {
        flujo: flujo.clave,
        ambito: flujo.ambito,
        id_ambito: idAmbito,
        id_visita: visita.id,
        educador: visita.educador,
        educador_correo: visita.educador_correo,
        visita, titulo, detalle,
        ...extra
    };
}

function tituloVisita(v) {
    return `${v.hospital || 'Sin hospital'} · ${v.dia || ''}`;
}

function resumenVisita(v) {
    const n = actividadesGuardadasDe(v).length;
    return `${v.educador || 'Sin educador'} · ${n} actividad${n === 1 ? '' : 'es'}`;
}

/** Minutos de tardanza sobre la hora programada, o 0 si llegó a tiempo. */
export function minutosDeRetraso(v) {
    if (!tieneCheckIn(v) || !v.hora_inicio || !v.check_in?.momento) return 0;
    const llegada = new Date(v.check_in.momento);
    if (Number.isNaN(llegada.getTime())) return 0;

    const [hh, mm] = String(v.hora_inicio).split(':').map(Number);
    const tarde = (llegada.getHours() * 60 + llegada.getMinutes()) - ((hh || 0) * 60 + (mm || 0));
    return tarde > MINUTOS_DE_GRACIA ? tarde : 0;
}

function detalleRetraso(v) {
    const min = minutosDeRetraso(v);
    return `${v.educador || 'Sin educador'} · llegó ${min} min tarde (${v.hora_inicio} → ${horaDe(v.check_in?.momento)})`;
}

function horaDe(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
        : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- la cola ----------

/**
 * Lo pendiente de un flujo. `visitas` se pasa desde fuera para que el módulo de revisión
 * comparta los filtros globales del dashboard en vez de tener los suyos.
 */
export function pendientesDe(flujo, visitas = consultarVisitas()) {
    return candidatosDe(flujo, visitas).filter(c => estaPendiente(flujo.clave, c.id_ambito));
}

/** Cuántos pendientes tiene cada flujo. Alimenta las pestañas y el contador de la barra. */
export function conteoPendientes(visitas = consultarVisitas()) {
    const salida = {};
    let total = 0;
    for (const f of flujosDisponibles()) {
        const n = pendientesDe(f, visitas).length;
        salida[f.clave] = n;
        total += n;
    }
    return { porFlujo: salida, total };
}

/** Todo lo revisado de una visita, de cualquier flujo. Para mostrarlo dentro del drawer. */
export function revisionesDeVisita(idVisita) {
    return todasLasRevisiones()
        .filter(r => r.id_visita === idVisita)
        .sort(porOrden);
}

// ---------- registrar una revisión ----------

/**
 * Registra una revisión. Se guarda local y sube en la siguiente sincronización, igual que
 * todo lo demás: un revisor sin señal tiene que poder seguir trabajando.
 *
 * El revisor y el momento los pone la app; el servidor además REESCRIBE el revisor con la
 * identidad verificada, así que un cliente manipulado no puede firmar por otra persona.
 */
export function revisar({ flujo, ambito, idAmbito, idVisita, resultado, observaciones }) {
    const def = flujos.find(f => f.clave === flujo);
    if (!def) return { ok: false, error: 'Ese flujo de revisión no existe.' };

    const [modulo, accion] = String(def.permiso || '').split('.');
    if (!puede(modulo, accion)) {
        return { ok: false, error: 'No tienes permiso para revisar en este flujo.' };
    }
    if (!Object.values(RESULTADOS).includes(resultado)) {
        return { ok: false, error: 'Resultado no válido.' };
    }
    // Rechazar o pedir corrección sin decir por qué deja al educador sin nada que hacer.
    if (resultado !== RESULTADOS.APROBADO && !String(observaciones || '').trim()) {
        return { ok: false, error: 'Explica qué hay que corregir.' };
    }

    const sesion = sesionActual();
    const revision = {
        id: nuevoId('rv'),
        flujo, ambito, id_ambito: idAmbito, id_visita: idVisita,
        resultado,
        observaciones: String(observaciones || '').trim(),
        revisor: sesion?.nombre || '',
        revisor_correo: sesion?.correo || '',
        momento: new Date().toISOString(),
        // Lo local siempre gana el desempate contra lo ya sincronizado: es más nuevo.
        seq: Number.MAX_SAFE_INTEGER,
        sincronizado: false
    };

    const cola = pendientesDeSubir();
    cola.push(revision);
    guardarCola(cola);

    return { ok: true, revision };
}

// ---------- cola local ----------

export function pendientesDeSubir() {
    try {
        const crudo = localStorage.getItem(CLAVE_PENDIENTES);
        return crudo ? JSON.parse(crudo) : [];
    } catch (err) {
        console.error('Cola de revisiones ilegible:', err);
        return [];
    }
}

function guardarCola(lista) {
    localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(lista));
}

/** Se sacan de la cola al confirmarse: ya viven en el servidor. */
export function marcarSincronizadas(ids) {
    const set = new Set(ids);
    guardarCola(pendientesDeSubir().filter(r => !set.has(r.id)));
}
