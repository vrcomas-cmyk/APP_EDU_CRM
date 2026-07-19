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

/**
 * Los veredictos posibles.
 *
 * Cada uno declara TODO lo que la app necesita saber de él, y ese es el punto: ningún sitio
 * pregunta "¿este es el aprobado?". Antes lo hacían nueve —el color, el estilo del botón, el
 * tono del aviso, si exige explicación, si saca el elemento de la cola— y cada criterio nuevo
 * obligaba a encontrarlos todos.
 *
 *   valor                 lo que se guarda; es lo único que viaja al servidor
 *   etiqueta              participio, para el historial: "Aprobado el 3 de julio"
 *   accion                imperativo, para el botón: "Aprobar"
 *   tono                  cromía de salud, la misma del calendario y el tablero
 *   estilo                peso visual del botón: principal | txt | peligro
 *   exige_observaciones   no se puede mandar sin explicar
 *   acepta                el trabajo se da por bueno
 *   cierra                saca el elemento de la cola; si es false, vuelve al educador
 *
 * `acepta` y `cierra` son ejes distintos y hacen falta los dos. "Rechazado" cierra la
 * revisión pero no acepta el trabajo; "requiere corrección" tampoco acepta y además no
 * cierra. Un "Parcial" futuro podría aceptar y cerrar. Colapsarlos en uno obligaría a volver
 * a preguntar por el valor concreto, que es lo que esto viene a quitar.
 *
 * `cierra` es la pieza que convierte esto en datos de verdad. Sin ella, "sigue pendiente"
 * seguiría siendo una comparación contra 'correccion' escrita en el código, y un flujo con
 * resultados propios no podría expresar "esto vuelve a quien lo hizo".
 */
export const RESULTADOS_POR_DEFECTO = [
    { valor: 'aprobado', etiqueta: 'Aprobado', accion: '✓ Aprobar',
      tono: 'completa', estilo: 'principal', acepta: true, cierra: true },

    // No cierra: pedir corrección devuelve el elemento a la cola para volver a mirarlo.
    { valor: 'correccion', etiqueta: 'Requiere corrección', accion: '↺ Requiere corrección',
      tono: 'faltan-evidencias', estilo: 'txt', exige_observaciones: true,
      acepta: false, cierra: false },

    { valor: 'rechazado', etiqueta: 'Rechazado', accion: '✕ Rechazar',
      tono: 'sin-registrar', estilo: 'peligro', exige_observaciones: true,
      acepta: false, cierra: true }
];

/**
 * Los resultados de un flujo: los suyos si los declara, y si no los tres de siempre.
 *
 * El respaldo no es cortesía: los flujos que ya existen en la base no traen `resultados`, y
 * sin él la bandeja se quedaría sin botones el día que se despliegue esto.
 */
export function resultadosDe(flujo) {
    const def = typeof flujo === 'string' ? flujos.find(f => f.clave === flujo) : flujo;
    const propios = def?.resultados;
    return Array.isArray(propios) && propios.length ? propios : RESULTADOS_POR_DEFECTO;
}

/** Un resultado concreto de un flujo, o `null` si ese flujo no lo admite. */
export function resultadoDe(flujo, valor) {
    return resultadosDe(flujo).find(r => r.valor === valor) || null;
}

/**
 * Atajos a los tres de siempre. Se conservan porque media app los nombra y porque siguen
 * siendo el vocabulario por defecto; lo que ya NO se hace es asumir que son los únicos.
 */
export const RESULTADOS = {
    APROBADO: 'aprobado',
    RECHAZADO: 'rechazado',
    CORRECCION: 'correccion'
};

export const ETIQUETAS_RESULTADO = Object.fromEntries(
    RESULTADOS_POR_DEFECTO.map(r => [r.valor, r.etiqueta])
);

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

/**
 * Un elemento sigue en la cola si nunca se revisó, o si el veredicto que tiene NO cierra.
 *
 * Lo decide el propio resultado y no una comparación contra 'correccion': así un flujo con
 * sus propios veredictos puede declarar cuáles devuelven el trabajo al educador.
 *
 * Un resultado que el flujo ya no reconoce —se renombró en la base, y en local quedó el
 * viejo— cuenta como pendiente. Es el lado seguro: revisar dos veces molesta, dar por bueno
 * lo que nadie aprobó, no.
 */
export function estaPendiente(flujo, idAmbito) {
    const v = revisionVigente(flujo, idAmbito);
    if (!v) return true;

    const def = resultadoDe(flujo, v.resultado);
    return !def || !def.cierra;
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
    // Se valida contra los resultados DE ESTE FLUJO, no contra una lista global: "efectiva"
    // puede ser válida en calidad de visita y no significar nada en evidencias.
    const defResultado = resultadoDe(def, resultado);
    if (!defResultado) {
        return { ok: false, error: 'Ese resultado no aplica a este flujo de revisión.' };
    }
    // Un veredicto que devuelve trabajo sin decir cuál deja al educador sabiendo que algo
    // está mal, pero no qué arreglar.
    if (defResultado.exige_observaciones && !String(observaciones || '').trim()) {
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
