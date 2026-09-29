/**
 * Caché local (IndexedDB) de lo que baja del equipo: visitas, flujos y revisiones.
 *
 * Es stale-while-revalidate: al abrir la app se pinta al instante lo último que se bajó, y en
 * paralelo se pide lo nuevo. Sin esto, cada arranque mostraba el calendario del equipo vacío
 * hasta que respondía el servidor (varios segundos en señal débil).
 *
 * IndexedDB y no localStorage: el catálogo (~11.5k clientes) ya se come la mayor parte de los
 * ~5 MB de localStorage, y `guardarConCuotaSegura` (storage.js) SACRIFICA el catálogo si otra
 * escritura no cabe — meter aquí visitas del equipo pondría en riesgo justo eso.
 *
 * Todo es mejor esfuerzo: si IndexedDB no está o falla, la app funciona igual, solo sin el
 * arranque instantáneo. Las claves llevan el correo, para que en un dispositivo compartido una
 * persona nunca arranque viendo el equipo de otra.
 */

const DB_NOMBRE = 'pdt-cache';
const STORE = 'equipo';

let dbPromesa = null;

function abrir() {
    if (dbPromesa) return dbPromesa;

    const promesa = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
        const solicitud = indexedDB.open(DB_NOMBRE, 1);
        solicitud.onupgradeneeded = () => {
            if (!solicitud.result.objectStoreNames.contains(STORE)) solicitud.result.createObjectStore(STORE);
        };
        solicitud.onsuccess = () => resolve(solicitud.result);
        solicitud.onerror = () => reject(solicitud.error);
    });
    // No memorizar el fallo: un primer intento fallido no debe inutilizar la caché toda la sesión.
    promesa.catch(() => { dbPromesa = null; });

    dbPromesa = promesa;
    return dbPromesa;
}

const clavePara = (correo, nombre) => `${String(correo || '').trim().toLowerCase()}:${nombre}`;

export async function guardarCache(correo, nombre, valor) {
    if (!correo) return;
    try {
        const db = await abrir();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ valor, guardado: Date.now() }, clavePara(correo, nombre));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn('No se pudo guardar la caché local:', err);
    }
}

/** El valor guardado, o `null` si no hay (o IndexedDB no responde). */
export async function leerCache(correo, nombre) {
    if (!correo) return null;
    try {
        const db = await abrir();
        const registro = await new Promise((resolve, reject) => {
            const solicitud = db.transaction(STORE, 'readonly').objectStore(STORE).get(clavePara(correo, nombre));
            solicitud.onsuccess = () => resolve(solicitud.result);
            solicitud.onerror = () => reject(solicitud.error);
        });
        return registro?.valor ?? null;
    } catch {
        return null;
    }
}

/** Al cerrar sesión: nada del equipo de esta persona debe quedarse en el dispositivo. */
export async function borrarCache(correo) {
    if (!correo) return;
    try {
        const db = await abrir();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const almacen = tx.objectStore(STORE);
            ['visitas', 'revisiones'].forEach(n => almacen.delete(clavePara(correo, n)));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* mejor esfuerzo */ }
}
