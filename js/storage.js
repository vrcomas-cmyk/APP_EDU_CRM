/**
 * Persistencia local.
 *
 * localStorage: visitas y catálogo (texto, poco volumen).
 * IndexedDB:    archivos de evidencia (Blobs). No caben en localStorage — el catálogo
 *               de ~11.5k clientes ya ocupa buena parte del límite de ~5MB, y base64
 *               infla los archivos otro ~33%.
 */

const CLAVE_VISITAS = 'visitas';
const CLAVE_CATALOGO = 'datosPWA';
const CLAVE_BACKUP = 'visitas_backup_v1';
const CLAVE_VERSION_MODELO = 'modelo_version';
const VERSION_MODELO = 6;
const CLAVE_ESTRATEGIAS = 'pdt_estrategias';

/**
 * Modelo v6.
 *
 * v4 separó el CICLO DE VIDA (un dato: programada → en-proceso → finalizada, o cancelada)
 * de la SALUD del registro (un cálculo: rojo/azul/verde, y solo después del check-in).
 * El estado es una cadena a propósito: agregar uno nuevo no debe obligar a tocar la lógica.
 *
 * v5 agrega el SELLO de guardado a la actividad. Una actividad nace como borrador —todo
 * editable, nada definitivo— y al guardarse queda sellada con quién, cuándo y desde dónde.
 * A partir de ahí es un hecho histórico y ya no se edita: solo admite acciones (evidencia).
 * El sello es la única fuente de verdad del bloqueo; no hay un flag "bloqueada" aparte que
 * pudiera contradecirlo.
 *
 * v6 sube el mismo principio un nivel: la VISITA también nace como borrador. Antes se creaba
 * ya registrada, con la fecha de hoy y un horario por defecto, y bastaba con abrirla sin
 * querer para dejar una visita real en el calendario. Ahora nada existe hasta Guardar visita,
 * y ahí se sellan de paso sus sectores — que a partir de ese momento tampoco se editan.
 *
 * visita = {
 *   id, educador, educador_correo, cliente, hospital,
 *   dia: '2026-07-15', hora_inicio: '09:00', hora_fin: '11:00',
 *   estado: 'programada' | 'en-proceso' | 'finalizada' | 'cancelada',
 *
 *   check_in:  { momento: ISO, lat, lng, precision_m, direccion, usuario, dispositivo },
 *   check_out: { momento: ISO, lat, lng, precision_m, direccion, usuario },
 *   // Ambos son inmutables una vez escritos: son el hecho de haber estado ahí.
 *
 *   reagendas: [{ momento, usuario, motivo, antes: {dia,hora_inicio,hora_fin}, despues: {...} }],
 *   motivo_cancelacion,
 *
 *   borrador: true,                                  // visita en captura; se borra al Guardar
 *
 *   sectores: [{
 *     id, nombre, objetivo, origen: [], solicitado_por,
 *     guardado: { momento, usuario },              // sello del sector; sin él, todavía editable
 *     actividades: [{
 *       id, tipo, area_visitada, creada,
 *       guardada: { momento, usuario, usuario_correo, dispositivo },  // sin él, es borrador
 *       contacto: { nombre, cargo, servicio },     // uno POR ACTIVIDAD, no por visita
 *       materiales: [{ id, material, cantidad, unidad, origen }],
 *       evidencia: { estado, nombre, mime, url }   // se puede cargar DESPUÉS del sello
 *     }]
 *   }],
 *   sincronizado: false
 * }
 */
export const DURACION_POR_DEFECTO_H = 1;

const DB_NOMBRE = 'visitas-db';
const DB_VERSION = 1;
const STORE_EVIDENCIAS = 'evidencias';

// ---------- ids ----------

export function nuevoId(prefijo) {
    const aleatorio = (crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefijo}-${aleatorio}`;
}

// ---------- visitas ----------

export function leerVisitas() {
    try {
        const crudo = localStorage.getItem(CLAVE_VISITAS);
        return crudo ? JSON.parse(crudo) : [];
    } catch (err) {
        console.error('No se pudieron leer las visitas:', err);
        return [];
    }
}

export function guardarVisitas(visitas) {
    localStorage.setItem(CLAVE_VISITAS, JSON.stringify(visitas));
}

export function obtenerVisita(id) {
    return leerVisitas().find(v => v.id === id) || null;
}

/**
 * Aplica un cambio sobre una visita y la marca como pendiente de sincronizar.
 * Todo edit pasa por aquí: si el dirty flag se olvida, el cambio nunca sube.
 */
export function actualizarVisita(id, mutador) {
    const visitas = leerVisitas();
    const visita = visitas.find(v => v.id === id);
    if (!visita) return null;

    mutador(visita);
    visita.sincronizado = false;
    guardarVisitas(visitas);
    return visita;
}

export function agregarVisita(visita) {
    const visitas = leerVisitas();
    visitas.push(visita);
    guardarVisitas(visitas);
    return visita;
}

export function eliminarVisita(id) {
    guardarVisitas(leerVisitas().filter(v => v.id !== id));
}

// ---------- estrategias ----------
//
// Cliente × Sector × Grupo de Artículo: qué plan se va a trabajar ahí. Cualquier educador o
// gerente la escribe o la corrige —no hay dueño único, como sí lo hay en una visita—, así que
// no lleva "sello" ni se congela: es una referencia viva que se actualiza en el sitio.

export function leerEstrategias() {
    try {
        const crudo = localStorage.getItem(CLAVE_ESTRATEGIAS);
        const lista = crudo ? JSON.parse(crudo) : [];
        // `productos` era texto libre de uno solo; una estrategia guardada en el teléfono
        // ANTES de este cambio todavía lo trae como string. Se envuelve en un arreglo de un
        // elemento al leerla, para no perder lo ya escrito.
        return lista.map(e => (
            typeof e.productos === 'string'
                ? { ...e, productos: e.productos.trim() ? [e.productos.trim()] : [] }
                : e
        ));
    } catch (err) {
        console.error('No se pudieron leer las estrategias:', err);
        return [];
    }
}

export function guardarEstrategias(estrategias) {
    localStorage.setItem(CLAVE_ESTRATEGIAS, JSON.stringify(estrategias));
}

export function upsertEstrategia(estrategia) {
    const lista = leerEstrategias();
    const i = lista.findIndex(e => e.id === estrategia.id);
    if (i === -1) lista.push(estrategia); else lista[i] = estrategia;
    guardarEstrategias(lista);
    return estrategia;
}

export function eliminarEstrategia(id) {
    guardarEstrategias(leerEstrategias().filter(e => e.id !== id));
}

/**
 * Mezcla lo que trajo el servidor con lo que hay en el teléfono.
 *
 * El servidor manda: es la referencia compartida por todo el equipo. La única excepción es lo
 * que este mismo dispositivo editó y todavía no ha subido —`sincronizado === false`—, porque
 * eso el servidor ni siquiera lo vio todavía; pisarlo con la versión vieja lo borraría.
 */
export function fusionarEstrategiasEquipo(remotas) {
    const locales = leerEstrategias();
    const pendientes = locales.filter(e => e.sincronizado === false);
    const idsPendientes = new Set(pendientes.map(e => e.id));

    const delServidor = remotas
        .filter(r => !idsPendientes.has(r.id))
        .map(r => ({ ...r, sincronizado: true }));

    guardarEstrategias([...delServidor, ...pendientes]);
}

// ---------- catálogo ----------

export function leerCatalogo() {
    try {
        const crudo = localStorage.getItem(CLAVE_CATALOGO);
        return crudo ? JSON.parse(crudo) : null;
    } catch (err) {
        console.error('No se pudo leer el catálogo:', err);
        return null;
    }
}

export function guardarCatalogo(datos) {
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(datos));
}

// ---------- recorridos ----------

/** Aplana el árbol a [{visita, sector, actividad}] — útil para pendientes y sync. */
export function todasLasActividades(visitas = leerVisitas()) {
    const salida = [];
    visitas.forEach(visita => {
        (visita.sectores || []).forEach(sector => {
            (sector.actividades || []).forEach(actividad => {
                salida.push({ visita, sector, actividad });
            });
        });
    });
    return salida;
}

/** Actividades con archivo local esperando señal. La deuda con reglas vive en estado.js. */
export function evidenciasLocales(visitas = leerVisitas()) {
    return todasLasActividades(visitas)
        .filter(({ actividad }) => actividad.evidencia?.estado === 'local');
}

/**
 * Hospitales ya escritos, del más usado al menos.
 *
 * El hospital es texto libre por decisión de producto, y su costo es que "Hosp. Ángeles" y
 * "H. Angeles" se vuelvan dos. Sugerir lo ya escrito no lo impide, pero hace que la
 * escritura converja sola sin obligar a configurar un catálogo.
 */
export function historialHospitales(visitas = leerVisitas()) {
    return historialDeCampo('hospital', visitas);
}

/**
 * Valores ya escritos en un campo de texto libre de la visita, del más usado al menos.
 * Generaliza `historialHospitales`: mismo problema para "zona" y "gerente_marca" —texto
 * libre que conviene sugerir para que converja solo, sin ser un catálogo cerrado.
 */
export function historialDeCampo(campo, visitas = leerVisitas()) {
    const cuenta = new Map();
    visitas.forEach(v => {
        const valor = String(v[campo] || '').trim();
        if (valor) cuenta.set(valor, (cuenta.get(valor) || 0) + 1);
    });
    return Array.from(cuenta.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([valor]) => valor);
}

// ---------- IndexedDB (archivos de evidencia) ----------

let dbPromesa = null;

function abrirDB() {
    if (dbPromesa) return dbPromesa;

    const promesa = new Promise((resolve, reject) => {
        if (!('indexedDB' in globalThis) || !globalThis.indexedDB) {
            reject(new Error('IndexedDB no disponible'));
            return;
        }

        const solicitud = indexedDB.open(DB_NOMBRE, DB_VERSION);
        solicitud.onupgradeneeded = () => {
            const db = solicitud.result;
            if (!db.objectStoreNames.contains(STORE_EVIDENCIAS)) {
                db.createObjectStore(STORE_EVIDENCIAS);
            }
        };
        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    });

    // No memorizar el fallo: si el primer intento falla (arranque, cuota, modo privado),
    // guardar la promesa rechazada dejaría las evidencias inservibles el resto de la sesión
    // aunque IndexedDB ya estuviera disponible.
    promesa.catch(() => { dbPromesa = null; });

    dbPromesa = promesa;
    return dbPromesa;
}

function transaccion(modo, operacion) {
    return abrirDB().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_EVIDENCIAS, modo);
        const solicitud = operacion(tx.objectStore(STORE_EVIDENCIAS));
        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    }));
}

export function guardarArchivo(idActividad, blob) {
    return transaccion('readwrite', store => store.put(blob, idActividad));
}

export function leerArchivo(idActividad) {
    return transaccion('readonly', store => store.get(idActividad));
}

export function borrarArchivo(idActividad) {
    return transaccion('readwrite', store => store.delete(idActividad));
}

// ---------- migración ----------

/**
 * Migración por saltos. Cada navegador puede venir de una versión distinta, así que se
 * detecta la forma del dato en vez de confiar solo en el número guardado (los primeros
 * usuarios nunca tuvieron `modelo_version`).
 *
 *   v1  filas planas   { fecha, sector, actividad, ... }  -> una fila por sector
 *   v2  árbol          { fecha, sectores: [{ actividades }] }
 *   v3  árbol + rango  { dia, hora_inicio, hora_fin, hospital, ... }
 *   v4  estado como dato + contacto/materiales por actividad
 *   v5  sello de guardado en cada actividad (borrador -> hecho histórico)
 *   v6  la visita nace como borrador; al guardarla se sellan sus sectores
 */
export function migrarSiHaceFalta() {
    if (Number(localStorage.getItem(CLAVE_VERSION_MODELO)) >= VERSION_MODELO) return null;

    const crudo = localStorage.getItem(CLAVE_VISITAS);
    if (!crudo) {
        localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));
        return null;
    }

    let datos;
    try {
        datos = JSON.parse(crudo);
    } catch (err) {
        console.error('Visitas ilegibles, no se migra nada:', err);
        return null;
    }

    if (!Array.isArray(datos) || datos.length === 0) {
        localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));
        return null;
    }

    const desde = versionDe(datos[0]);
    if (desde === VERSION_MODELO) {
        localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));
        return null;
    }

    // Se respalda lo que había ANTES de tocar nada, con la versión de la que venía.
    localStorage.setItem(`${CLAVE_BACKUP}${desde}`, crudo);

    const filasV1 = desde === 1 ? datos.length : 0;
    let visitas = desde === 1 ? migrarV1aV2(datos) : datos;
    if (desde <= 2) visitas = visitas.map(migrarV2aV3);
    if (desde <= 3) visitas = visitas.map(migrarV3aV4);
    if (desde <= 4) visitas = visitas.map(migrarV4aV5);
    visitas = visitas.map(migrarV5aV6);

    guardarVisitas(visitas);
    localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));

    console.log(`Migradas ${visitas.length} visitas de v${desde} a v${VERSION_MODELO}.`);
    return { desde, visitas: visitas.length, filasV1 };
}

function versionDe(visita) {
    if (!visita || !Array.isArray(visita.sectores)) return 1;   // fila plana
    if (visita.dia === undefined) return 2;                     // árbol con `fecha`
    if (visita.estado === undefined) return 3;                  // v3: el estado se derivaba
    // v5 sella cada actividad. Una visita sin actividades no permite distinguir v4 de v5 por
    // su contenido, pero tampoco hay nada que sellar: se da por migrada.
    const actividades = (visita.sectores || []).flatMap(s => s.actividades || []);
    if (actividades.some(a => !a.guardada)) return 4;
    // v6 sella los sectores. Un borrador no cuenta: sus sectores siguen siendo editables a
    // propósito, así que la falta de sello ahí es el estado correcto, no una versión vieja.
    if (!visita.borrador && (visita.sectores || []).some(s => !s.guardado)) return 5;
    return 6;
}

/**
 * v1 -> v2: agrupa las filas planas del mismo cliente/fecha/educador en una visita.
 *
 * `sincronizado` se respeta en vez de forzarlo: lo que ya subió no se reenvía, y lo que
 * nunca subió (capturado offline) queda pendiente o se perdería, porque sus datos no están
 * en ninguna hoja. Una visita agrupa varias filas, así que solo cuenta como sincronizada
 * si TODAS lo estaban.
 */
function migrarV1aV2(filas) {
    const porVisita = new Map();

    filas.forEach(fila => {
        const clave = [fila.educador, fila.cliente, fila.fecha].join('||');

        if (!porVisita.has(clave)) {
            porVisita.set(clave, {
                id: nuevoId('v'),
                educador: fila.educador || '',
                educador_correo: fila.educador_correo || '',
                cliente: fila.cliente || '',
                fecha: fila.fecha || '',
                sectores: [],
                sincronizado: true,
                migrada: true
            });
        }

        const visita = porVisita.get(clave);
        visita.sincronizado = visita.sincronizado && fila.sincronizado === true;

        const nombreSector = fila.sector || 'Sin sector';
        let sector = visita.sectores.find(s => s.nombre === nombreSector);
        if (!sector) {
            sector = { id: nuevoId('s'), nombre: nombreSector, objetivo: fila.objetivo || '', actividades: [] };
            visita.sectores.push(sector);
        }

        if (fila.actividad) {
            sector.actividades.push({
                id: nuevoId('a'),
                texto: fila.actividad,
                creada: fila.fecha || '',
                // Los datos viejos no conocían el concepto de evidencia. Marcarlas como
                // pendientes llenaría la bandeja de deuda imposible de saldar.
                evidencia: { estado: 'subida', nombre: '', mime: '', url: '' }
            });
        }
    });

    return Array.from(porVisita.values());
}

/**
 * v2 -> v3: parte `fecha` en día + rango y siembra los campos nuevos.
 * No se conoce la duración real de lo ya capturado, así que se asume una hora y se marca
 * `duracion_estimada` para no presentar un dato inventado como si fuera medido.
 */
function migrarV2aV3(visita) {
    const fecha = visita.fecha || '';
    const dia = fecha.slice(0, 10);
    const horaInicio = fecha.slice(11, 16) || '09:00';

    const nueva = {
        ...visita,
        dia,
        hora_inicio: horaInicio,
        hora_fin: sumarHoras(horaInicio, DURACION_POR_DEFECTO_H),
        duracion_estimada: true,
        hospital: visita.hospital || '',
        sectores: (visita.sectores || []).map(sector => ({
            ...sector,
            origen: sector.origen || [],
            solicitado_por: sector.solicitado_por || '',
            actividades: (sector.actividades || []).map(act => ({
                ...act,
                tipo: act.tipo || '',
                materiales: act.materiales || [],
                folio: act.folio || '',
                gerente: act.gerente || ''
            }))
        }))
    };

    // El estado ahora se deriva; conservarlo invitaría a que algo lo leyera por error.
    delete nueva.fecha;
    delete nueva.estado;
    return nueva;
}

/**
 * v3 -> v4: el estado deja de derivarse y pasa a ser un dato.
 *
 * Lo capturado antes de que existiera el check-in no puede inventarse uno: sería afirmar que
 * alguien estuvo en un lugar a una hora, y eso es justo lo que el check-in prueba. Así que
 * las visitas viejas con actividades se dan por finalizadas SIN check-in, y su color queda
 * neutro. Es menos bonito que fabricar el dato, pero es lo único honesto.
 */
function migrarV3aV4(visita) {
    const tieneActividades = (visita.sectores || [])
        .some(s => (s.actividades || []).length > 0);

    const nueva = {
        ...visita,
        estado: visita.cancelada ? 'cancelada' : (tieneActividades ? 'finalizada' : 'programada'),
        reagendas: visita.reagendas || [],
        sectores: (visita.sectores || []).map(sector => ({
            ...sector,
            actividades: (sector.actividades || []).map(act => ({
                ...act,
                area_visitada: act.area_visitada || '',
                contacto: act.contacto || { nombre: '', cargo: '', servicio: '' },
                // `materiales` era una lista de textos; ahora cada uno es un registro con
                // cantidad, unidad y origen. Lo viejo se conserva como nombre.
                materiales: (act.materiales || []).map(m =>
                    typeof m === 'string'
                        ? { id: nuevoId('m'), material: m, cantidad: '', unidad: '', origen: '' }
                        : m
                )
            }))
        }))
    };

    // `folio` y `gerente` vivían en la actividad; ahora el origen es de cada MATERIAL, que es
    // donde de verdad aplica. Si había algo, se arrastra al primer material para no perderlo.
    (nueva.sectores || []).forEach(s => (s.actividades || []).forEach(a => {
        const heredado = [a.folio, a.gerente].filter(Boolean).join(' · ');
        if (heredado && a.materiales.length) {
            a.materiales.forEach(m => { if (!m.origen) m.origen = heredado; });
        }
        delete a.folio;
        delete a.gerente;
        delete a.texto;          // el detalle libre se fue: el tipo + área + contacto lo dicen
    }));

    delete nueva.cancelada;      // ahora vive en `estado`

    delete nueva.duracion_estimada;
    return nueva;
}

/**
 * v4 -> v5: sella las actividades ya capturadas.
 *
 * Todo lo que existía antes de este cambio ya se registró y en su mayoría ya se sincronizó:
 * son hechos, no capturas a medias. Dejarlas como borrador las volvería editables justo
 * cuando la regla nueva dice lo contrario, y además las mostraría con un botón "Guardar" que
 * el educador no tiene por qué volver a presionar.
 *
 * El sello dice `migrada: true` y NO inventa dispositivo: no se sabe desde cuál se capturaron,
 * y rellenarlo con el de hoy sería afirmar algo falso sobre un registro histórico. El momento
 * se toma de `creada` cuando existe; si no, del día de la visita.
 */
function migrarV4aV5(visita) {
    return {
        ...visita,
        sectores: (visita.sectores || []).map(sector => ({
            ...sector,
            solicitado_por: sector.solicitado_por || '',
            actividades: (sector.actividades || []).map(act => {
                if (act.guardada) return act;
                const { borrador, ...resto } = act;
                return {
                    ...resto,
                    guardada: {
                        momento: act.creada || `${visita.dia}T00:00:00.000Z`,
                        usuario: visita.educador || '',
                        usuario_correo: visita.educador_correo || '',
                        dispositivo: '',
                        migrada: true
                    }
                };
            })
        }))
    };
}

/**
 * v5 -> v6: sella los sectores de las visitas que ya existían.
 *
 * Todas ellas se crearon cuando la visita nacía ya registrada, así que sus sectores son
 * definitivos por el mismo argumento que las actividades: ya se usaron, ya se sincronizaron
 * y en muchos casos ya tienen actividades colgando. Dejarlos sin sello los volvería editables
 * justo cuando la regla nueva dice lo contrario.
 *
 * El sello se marca `migrado` y no inventa un momento propio: se usa el de la visita.
 */
function migrarV5aV6(visita) {
    if (visita.borrador) return visita;

    return {
        ...visita,
        sectores: (visita.sectores || []).map(sector => sector.guardado ? sector : ({
            ...sector,
            solicitado_por: sector.solicitado_por || '',
            guardado: {
                momento: visita.dia ? `${visita.dia}T00:00:00.000Z` : '',
                usuario: visita.educador || '',
                migrado: true
            }
        }))
    };
}

/** 'HH:MM' + horas -> 'HH:MM', topado a 23:59 para no saltar de día. */
function sumarHoras(hora, horas) {
    const [hh, mm] = hora.split(':').map(Number);
    const total = Math.min((hh || 0) * 60 + (mm || 0) + horas * 60, 23 * 60 + 59);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
