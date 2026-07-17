/**
 * Evidencias: una imagen o PDF por actividad.
 *
 * Es obligatoria, pero puede subirse mucho después de registrar la actividad, así que
 * nunca bloquea el guardado: se modela como deuda pendiente y se arrastra hasta que hay
 * señal. Estados: 'pendiente' (sin archivo) -> 'local' (archivo en IndexedDB) -> 'subida'.
 */

import {
    leerVisitas, guardarVisitas, guardarArchivo, borrarArchivo,
    evidenciasPendientes, todasLasActividades
} from './storage.js';
import { subirEvidencia, subirEvidenciasPendientes } from './sync.js';
import { hora } from './fechas.js';

const LADO_MAX = 1600;
const CALIDAD_JPEG = 0.8;
const AVISO_TAMANO = 10 * 1024 * 1024;

export const TIPOS_ACEPTADOS = 'image/*,application/pdf';

// ---------- adjuntar ----------

/**
 * Guarda el archivo localmente y marca la actividad como 'local'.
 * No sube nada: eso lo hace la cola cuando hay conexión.
 */
export async function adjuntarEvidencia(idActividad, archivo) {
    if (!archivo) return null;

    const esPDF = archivo.type === 'application/pdf';
    if (!esPDF && !archivo.type.startsWith('image/')) {
        throw new Error('Solo se acepta una imagen o un PDF.');
    }
    if (esPDF && archivo.size > AVISO_TAMANO) {
        throw new Error('El PDF pesa más de 10MB y no va a subir bien. Usa uno más ligero.');
    }

    // Las fotos de celular pesan varios MB; sin recomprimir, subirlas con mala señal falla.
    const blob = esPDF ? archivo : await comprimirImagen(archivo);
    await guardarArchivo(idActividad, blob);

    actualizarEvidencia(idActividad, {
        estado: 'local',
        nombre: nombreDeArchivo(archivo, esPDF),
        mime: blob.type,
        url: ''
    });

    return blob;
}

export async function quitarEvidencia(idActividad) {
    await borrarArchivo(idActividad).catch(() => {});
    actualizarEvidencia(idActividad, { estado: 'pendiente', nombre: '', mime: '', url: '' });
}

function nombreDeArchivo(archivo, esPDF) {
    if (esPDF) return archivo.name || 'evidencia.pdf';
    const base = (archivo.name || 'evidencia').replace(/\.[^.]+$/, '');
    return `${base}.jpg`;
}

/** Escribe la evidencia en el árbol y marca la visita para re-sincronizar. */
function actualizarEvidencia(idActividad, evidencia) {
    const visitas = leerVisitas();

    for (const visita of visitas) {
        for (const sector of visita.sectores || []) {
            const actividad = (sector.actividades || []).find(a => a.id === idActividad);
            if (!actividad) continue;

            actividad.evidencia = evidencia;
            visita.sincronizado = false;
            guardarVisitas(visitas);
            return true;
        }
    }
    return false;
}

/** Redimensiona a LADO_MAX por el lado largo y reencoda a JPEG. Una foto de 4MB baja a ~200KB. */
function comprimirImagen(archivo) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            const escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));

            const lienzo = document.createElement('canvas');
            lienzo.width = Math.round(img.width * escala);
            lienzo.height = Math.round(img.height * escala);
            lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);

            lienzo.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('No se pudo procesar la imagen')),
                'image/jpeg',
                CALIDAD_JPEG
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No se pudo leer la imagen'));
        };
        img.src = url;
    });
}

// ---------- bandeja de pendientes ----------

export function contarPendientes() {
    return evidenciasPendientes().length;
}

export function renderPendientes(alCambiar) {
    const contenedor = document.getElementById('lista-pendientes');
    const btnSubirTodas = document.getElementById('btn-subir-todas');
    contenedor.innerHTML = '';

    const pendientes = evidenciasPendientes();
    const conArchivo = pendientes.filter(p => p.actividad.evidencia?.estado === 'local');
    btnSubirTodas.disabled = conArchivo.length === 0 || !navigator.onLine;
    btnSubirTodas.textContent = conArchivo.length === 0
        ? '☁️ No hay archivos por subir'
        : `☁️ Subir ${conArchivo.length} archivo${conArchivo.length > 1 ? 's' : ''}`;

    if (pendientes.length === 0) {
        const p = document.createElement('p');
        p.className = 'empty-state';
        p.textContent = '✅ Todas las actividades tienen su evidencia subida.';
        contenedor.appendChild(p);
        return;
    }

    pendientes.forEach(({ visita, sector, actividad }) => {
        contenedor.appendChild(tarjetaPendiente(visita, sector, actividad, alCambiar));
    });
}

function tarjetaPendiente(visita, sector, actividad, alCambiar) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'pendiente-item';

    const meta = document.createElement('p');
    meta.className = 'pendiente-meta';
    meta.textContent = `${visita.cliente} · ${sector.nombre} · ${visita.fecha.slice(0, 10)} ${hora(visita.fecha)}`;

    const texto = document.createElement('h4');
    texto.textContent = actividad.texto;

    tarjeta.append(meta, texto, controlEvidencia(actividad, alCambiar));
    return tarjeta;
}

/**
 * Control reutilizable: lo usa la bandeja de pendientes y la vista de detalle.
 * `alCambiar` se llama después de cada acción para que la vista se repinte.
 */
export function controlEvidencia(actividad, alCambiar = () => {}) {
    const caja = document.createElement('div');
    caja.className = 'evidencia-control';

    const evidencia = actividad.evidencia || { estado: 'pendiente' };

    if (evidencia.estado === 'subida') {
        const ok = document.createElement('span');
        ok.className = 'visita-estado is-synced';
        ok.textContent = '☁️ Evidencia subida';
        caja.appendChild(ok);

        if (evidencia.url) {
            const ver = document.createElement('a');
            ver.className = 'btn-link';
            ver.href = evidencia.url;
            ver.target = '_blank';
            ver.rel = 'noopener';
            ver.textContent = 'Ver';
            caja.appendChild(ver);
        }
        return caja;
    }

    if (evidencia.estado === 'local') {
        const listo = document.createElement('span');
        listo.className = 'visita-estado is-pending';
        listo.textContent = `📎 ${evidencia.nombre || 'archivo'} · sin subir`;

        const btnSubir = document.createElement('button');
        btnSubir.type = 'button';
        btnSubir.className = 'btn-link';
        btnSubir.textContent = 'Subir ahora';
        btnSubir.disabled = !navigator.onLine;
        btnSubir.addEventListener('click', async () => {
            btnSubir.disabled = true;
            btnSubir.textContent = 'Subiendo...';
            try {
                await subirEvidencia(actividad.id);
            } catch (err) {
                console.error(err);
                alert(`No se pudo subir: ${err.message}`);
            }
            alCambiar();
        });

        const btnQuitar = document.createElement('button');
        btnQuitar.type = 'button';
        btnQuitar.className = 'btn-link es-peligro';
        btnQuitar.textContent = 'Quitar';
        btnQuitar.addEventListener('click', async () => {
            await quitarEvidencia(actividad.id);
            alCambiar();
        });

        caja.append(listo, btnSubir, btnQuitar);
        return caja;
    }

    caja.appendChild(selectorArchivo(actividad, alCambiar));
    return caja;
}

function selectorArchivo(actividad, alCambiar) {
    const etiqueta = document.createElement('label');
    etiqueta.className = 'btn-archivo';
    etiqueta.textContent = '📷 Agregar evidencia';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TIPOS_ACEPTADOS;
    input.capture = 'environment';
    input.hidden = true;

    input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        if (!archivo) return;

        etiqueta.textContent = '⏳ Procesando...';
        try {
            await adjuntarEvidencia(actividad.id, archivo);
        } catch (err) {
            console.error(err);
            alert(err.message);
        }
        alCambiar();
    });

    etiqueta.appendChild(input);
    return etiqueta;
}

// ---------- cola ----------

export async function subirTodasLasPendientes() {
    const conArchivo = todasLasActividades()
        .filter(({ actividad }) => actividad.evidencia?.estado === 'local');
    if (conArchivo.length === 0) return { subidas: 0, fallidas: 0 };

    return subirEvidenciasPendientes();
}
