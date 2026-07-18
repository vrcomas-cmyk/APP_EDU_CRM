/**
 * Comentarios sobre visitas, sectores, actividades y evidencias.
 *
 * Un comentario NUNCA se edita ni se borra. Es el mismo principio que el resto de la
 * plataforma: lo que se puede reescribir en silencio deja de servir para entender qué pasó.
 * Si alguien se equivocó, escribe otro comentario — la conversación queda completa, en orden,
 * y se lee como lo que fue.
 *
 * ── Comentarios históricos ───────────────────────────────────────────────────────────
 *
 * Un hospital con observaciones repetidas es información que se pierde entre visitas: la
 * escribe quien fue en marzo y la necesita quien va en julio, que probablemente es otra
 * persona. Por eso cada comentario guarda su hospital y su cliente, y al programar una visita
 * se ofrecen los de ese hospital. Desnormalizar aquí es deliberado: es lo que permite
 * responder "¿qué se ha dicho de este hospital?" sin recorrer el árbol de todas las visitas.
 *
 * ── Almacenamiento ───────────────────────────────────────────────────────────────────
 *
 * localStorage, en modo append, y suben con la sincronización como los eventos. Viven aparte
 * del árbol de visitas a propósito: cuelgan de cuatro entidades distintas, y meterlos dentro
 * obligaría a recorrer el árbol entero para responder cualquier pregunta sobre ellos.
 */

import { nuevoId } from './storage.js';
import { sesionActual } from './auth.js';
import { puede } from './permisos.js';

const CLAVE = 'comentarios';
const MAX_LOCALES = 3000;

export const AMBITOS = {
    VISITA: 'visita',
    SECTOR: 'sector',
    ACTIVIDAD: 'actividad',
    EVIDENCIA: 'evidencia'
};

// ---------- lectura ----------

export function leerComentarios() {
    try {
        const crudo = localStorage.getItem(CLAVE);
        return crudo ? JSON.parse(crudo) : [];
    } catch (err) {
        console.error('Comentarios ilegibles:', err);
        return [];
    }
}

function persistir(lista) {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
}

/** Del más viejo al más nuevo: una conversación se lee en el orden en que ocurrió. */
export function comentariosDe(ambito, idAmbito) {
    if (!idAmbito || !puede('comentarios', 'leer')) return [];
    return leerComentarios()
        .filter(c => c.ambito === ambito && c.id_ambito === idAmbito)
        .sort((a, b) => String(a.momento).localeCompare(String(b.momento)));
}

/** Todo lo dicho sobre una visita, de cualquier ámbito. Para la vista de revisión. */
export function comentariosDeVisita(idVisita) {
    if (!idVisita || !puede('comentarios', 'leer')) return [];
    return leerComentarios()
        .filter(c => c.id_visita === idVisita)
        .sort((a, b) => String(a.momento).localeCompare(String(b.momento)));
}

/**
 * Lo que se ha dicho antes de este hospital, de lo más reciente hacia atrás.
 *
 * Excluye la visita en curso: al programar, lo que interesa es el antecedente, no lo que uno
 * mismo acaba de escribir.
 */
export function historicoDeHospital(hospital, { excluirVisita = null, limite = 5 } = {}) {
    const clave = String(hospital || '').trim().toLowerCase();
    if (!clave || !puede('comentarios', 'leer')) return [];

    return leerComentarios()
        .filter(c => String(c.hospital || '').trim().toLowerCase() === clave)
        .filter(c => !excluirVisita || c.id_visita !== excluirVisita)
        .sort((a, b) => String(b.momento).localeCompare(String(a.momento)))
        .slice(0, limite);
}

export function cuantosComentarios(ambito, idAmbito) {
    return comentariosDe(ambito, idAmbito).length;
}

// ---------- escritura ----------

/**
 * Agrega un comentario. Devuelve { ok, error } como el resto de acciones de negocio.
 *
 * El autor y el momento los pone la app, no el formulario: son parte de lo que el comentario
 * prueba, y un campo editable ahí no probaría nada.
 */
export function comentar({ ambito, idAmbito, texto, visita }) {
    if (!puede('comentarios', 'crear')) {
        return { ok: false, error: 'No tienes permiso para comentar.' };
    }
    const limpio = String(texto || '').trim();
    if (!limpio) return { ok: false, error: 'El comentario está vacío.' };
    if (!ambito || !idAmbito) return { ok: false, error: 'Falta a qué se refiere el comentario.' };

    const sesion = sesionActual();
    const comentario = {
        id: nuevoId('c'),
        ambito,
        id_ambito: idAmbito,
        id_visita: visita?.id || '',
        cliente: visita?.cliente || '',
        hospital: visita?.hospital || '',
        texto: limpio,
        usuario: sesion?.nombre || '',
        usuario_correo: sesion?.correo || '',
        momento: new Date().toISOString(),
        sincronizado: false
    };

    const lista = leerComentarios();
    lista.push(comentario);

    // Se podan los más viejos YA SINCRONIZADOS. Los pendientes nunca se tiran: son los
    // únicos que no existen en ningún otro lado.
    if (lista.length > MAX_LOCALES) {
        const pendientes = lista.filter(c => !c.sincronizado);
        const subidos = lista.filter(c => c.sincronizado);
        const conservar = Math.max(0, MAX_LOCALES - pendientes.length);
        persistir([...subidos.slice(-conservar), ...pendientes]);
    } else {
        persistir(lista);
    }

    return { ok: true, comentario };
}

// ---------- sincronización ----------

export function comentariosPendientes() {
    return leerComentarios().filter(c => !c.sincronizado);
}

export function marcarSincronizados(ids) {
    const set = new Set(ids);
    const lista = leerComentarios();
    lista.forEach(c => { if (set.has(c.id)) c.sincronizado = true; });
    persistir(lista);
}
