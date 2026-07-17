/**
 * Evidencias: una imagen o PDF por actividad, cuando su tipo la exige.
 *
 * Es obligatoria pero puede subirse mucho después —hoy, mañana o en un mes—, así que nunca
 * bloquea el guardado: se modela como deuda y se arrastra hasta que hay señal.
 *
 *   pendiente  sin archivo todavía
 *   local      el archivo está en el teléfono, falta señal
 *   subida     ya está en Drive, con su URL
 *
 * Esos dos primeros son problemas distintos y piden acciones distintas: uno necesita cámara,
 * el otro necesita internet. Por eso el punto va relleno o hueco.
 */

import { leerVisitas, guardarVisitas, guardarArchivo, borrarArchivo } from './storage.js';
import { subirEvidencia } from './sync.js';
import { registrar, TIPOS } from './eventos.js';

const LADO_MAX = 1600;
const CALIDAD_JPEG = 0.8;
const LIMITE_PDF = 10 * 1024 * 1024;

export const TIPOS_ACEPTADOS = 'image/*,application/pdf';

// ---------- adjuntar ----------

/** Guarda el archivo localmente y marca 'local'. No sube nada: de eso se encarga la cola. */
export async function adjuntarEvidencia(idActividad, archivo) {
    if (!archivo) return null;

    const esPDF = archivo.type === 'application/pdf';
    if (!esPDF && !archivo.type.startsWith('image/')) {
        throw new Error('Solo se acepta una imagen o un PDF.');
    }
    if (esPDF && archivo.size > LIMITE_PDF) {
        const mb = (archivo.size / 1024 / 1024).toFixed(1);
        throw new Error(`El PDF pesa ${mb} MB y el límite es 10. Usa uno más ligero.`);
    }

    // Una foto de celular pesa varios MB; sin recomprimir no sube con mala señal, que es
    // justo la condición en la que se va a usar.
    const blob = esPDF ? archivo : await comprimirImagen(archivo);
    await guardarArchivo(idActividad, blob);

    const nombre = nombreDeArchivo(archivo, esPDF);
    const visita = escribirEvidencia(idActividad, {
        estado: 'local',
        nombre,
        mime: blob.type,
        url: ''
    });
    if (visita) registrar(TIPOS.EVIDENCIA, visita, { id_actividad: idActividad, nombre });
    return blob;
}

export async function quitarEvidencia(idActividad) {
    await borrarArchivo(idActividad).catch(() => {});
    escribirEvidencia(idActividad, { estado: 'pendiente', nombre: '', mime: '', url: '' });
}

export { subirEvidencia };

function nombreDeArchivo(archivo, esPDF) {
    if (esPDF) return archivo.name || 'evidencia.pdf';
    const base = (archivo.name || 'evidencia').replace(/\.[^.]+$/, '');
    return `${base}.jpg`;   // se recomprimió a JPEG, la extensión debe decir la verdad
}

/** Escribe la evidencia en el árbol y marca la visita para re-sincronizar. Devuelve la visita tocada. */
function escribirEvidencia(idActividad, evidencia) {
    const visitas = leerVisitas();
    for (const visita of visitas) {
        for (const sector of visita.sectores || []) {
            const actividad = (sector.actividades || []).find(a => a.id === idActividad);
            if (!actividad) continue;

            actividad.evidencia = evidencia;
            visita.sincronizado = false;
            guardarVisitas(visitas);
            return visita;
        }
    }
    return null;
}

/** Redimensiona a LADO_MAX el lado largo y reencoda a JPEG. De ~4MB a ~200KB. */
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
                'image/jpeg', CALIDAD_JPEG
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('No se pudo leer la imagen. Prueba con otra foto.'));
        };
        img.src = url;
    });
}

// ---------- control reutilizable ----------

/**
 * El control de evidencia de una actividad. Lo usa el drawer y (más adelante) la bandeja.
 * `alCambiar` repinta a quien lo hospeda; `alToast` avisa sin usar alert().
 */
export function controlEvidencia(actividad, { alCambiar = () => {}, alToast = () => {} } = {}) {
    const caja = document.createElement('div');
    caja.className = 'evid';

    const ev = actividad.evidencia || { estado: 'pendiente' };

    if (ev.estado === 'subida') {
        const ok = document.createElement('span');
        ok.className = 'pill st-completa';
        ok.style.setProperty('--st', 'var(--st-done)');
        ok.style.setProperty('--st-bg', 'var(--st-done-bg)');
        ok.textContent = '☁ Subida';
        caja.appendChild(ok);

        if (ev.url) {
            const ver = document.createElement('a');
            ver.className = 'btn-txt';
            ver.href = ev.url;
            ver.target = '_blank';
            ver.rel = 'noopener';
            ver.textContent = 'Ver';
            caja.appendChild(ver);
        }
        return caja;
    }

    if (ev.estado === 'local') {
        const listo = document.createElement('span');
        listo.className = 'pill st-faltan-evidencias';
        listo.textContent = `📎 ${ev.nombre || 'archivo'}`;

        const subir = document.createElement('button');
        subir.type = 'button';
        subir.className = 'btn-txt';
        subir.textContent = navigator.onLine ? 'Subir ahora' : 'Espera señal';
        subir.disabled = !navigator.onLine;
        subir.addEventListener('click', async () => {
            subir.disabled = true;
            subir.textContent = 'Subiendo…';
            try {
                await subirEvidencia(actividad.id);
                alToast('Evidencia subida.', { estado: 'completa' });
            } catch (err) {
                console.error(err);
                alToast(`No se pudo subir: ${err.message}`, { estado: 'sin-registrar' });
            }
            alCambiar();
        });

        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'btn-txt peligro';
        quitar.textContent = 'Quitar';
        quitar.addEventListener('click', async () => {
            await quitarEvidencia(actividad.id);
            alCambiar();
        });

        caja.append(listo, subir, quitar);
        return caja;
    }

    caja.appendChild(selectorArchivo(actividad, alCambiar, alToast));
    return caja;
}

function selectorArchivo(actividad, alCambiar, alToast) {
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

        etiqueta.textContent = '⏳ Procesando…';
        try {
            await adjuntarEvidencia(actividad.id, archivo);
        } catch (err) {
            console.error(err);
            alToast(err.message, { estado: 'sin-registrar' });
        }
        alCambiar();
    });

    etiqueta.appendChild(input);
    return etiqueta;
}
