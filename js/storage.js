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
const VERSION_MODELO = 2;

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

export function evidenciasPendientes(visitas = leerVisitas()) {
    return todasLasActividades(visitas)
        .filter(({ actividad }) => !actividad.evidencia || actividad.evidencia.estado !== 'subida');
}

// ---------- IndexedDB (archivos de evidencia) ----------

let dbPromesa = null;

function abrirDB() {
    if (dbPromesa) return dbPromesa;

    dbPromesa = new Promise((resolve, reject) => {
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
 * El formato viejo era una fila plana por sector:
 *   { id, educador, cliente, fecha, sector, objetivo, actividad, sincronizado }
 * El nuevo es un árbol visita -> sectores -> actividades.
 *
 * La bandera `sincronizado` se respeta en vez de forzarla:
 *  - Lo que YA subió se deja como sincronizado para no reenviarlo.
 *  - Lo que nunca subió (se capturó offline) se deja pendiente, o se perdería: sus datos
 *    no están en ninguna hoja.
 * Una visita agrupa varias filas viejas, así que solo cuenta como sincronizada si TODAS
 * sus filas lo estaban.
 */
export function migrarSiHaceFalta() {
    if (Number(localStorage.getItem(CLAVE_VERSION_MODELO)) >= VERSION_MODELO) return null;

    const crudo = localStorage.getItem(CLAVE_VISITAS);
    if (!crudo) {
        localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));
        return null;
    }

    let viejas;
    try {
        viejas = JSON.parse(crudo);
    } catch (err) {
        console.error('Visitas ilegibles, no se migra nada:', err);
        return null;
    }

    if (!Array.isArray(viejas) || viejas.length === 0 || esFormatoNuevo(viejas[0])) {
        localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));
        return null;
    }

    localStorage.setItem(CLAVE_BACKUP, crudo);

    const porVisita = new Map();

    viejas.forEach(fila => {
        const clave = [fila.educador, fila.cliente, fila.fecha].join('||');

        if (!porVisita.has(clave)) {
            porVisita.set(clave, {
                id: nuevoId('v'),
                educador: fila.educador || '',
                educador_correo: fila.educador_correo || '',
                cliente: fila.cliente || '',
                fecha: fila.fecha || '',
                estado: 'completada',
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
                evidencia: { estado: 'subida', nombre: '', mime: '', url: '' }
            });
        }
    });

    const migradas = Array.from(porVisita.values());
    guardarVisitas(migradas);
    localStorage.setItem(CLAVE_VERSION_MODELO, String(VERSION_MODELO));

    console.log(`Migradas ${viejas.length} filas planas a ${migradas.length} visitas.`);
    return { filasViejas: viejas.length, visitas: migradas.length };
}

function esFormatoNuevo(visita) {
    return visita && Array.isArray(visita.sectores);
}
