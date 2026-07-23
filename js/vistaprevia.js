/**
 * Vista previa de evidencias.
 *
 * Nadie debería descargar un archivo para saber si sirve. Quien revisa veinte evidencias no
 * va a abrir veinte pestañas ni llenar su carpeta de descargas: si eso es lo que cuesta
 * revisar, la revisión no ocurre.
 *
 *   IMAGEN   miniatura en la tarjeta, ampliada al tocarla
 *   PDF      primera página como portada, apertura completa al tocarla
 *   VIDEO    miniatura del primer fotograma, reproducción al tocarla
 *
 * ── De dónde sale el archivo ─────────────────────────────────────────────────────────
 *
 * De IndexedDB si todavía no sube (y entonces la miniatura es instantánea y funciona sin
 * señal), o de Drive si ya subió. La distinción la resuelve `urlEvidencia` en datos.js, que
 * es también el punto por el que entrará Cloudflare R2 sin tocar esta pantalla.
 *
 * ── Por qué el PDF no se rasteriza ───────────────────────────────────────────────────
 *
 * Dibujar la primera página de un PDF de verdad exige pdf.js, que son ~350 KB de JavaScript
 * y esta app no tiene build ni dependencias. Para un educador en 3G eso es más caro que el
 * problema que resuelve, así que la portada del PDF es el visor nativo del navegador dentro
 * de un <object>: mismo resultado —se ve la primera página sin descargar— sin sumar peso.
 */

import { leerArchivo } from './storage.js';
import { urlEvidencia } from './datos.js';

const esImagen = (mime) => String(mime || '').startsWith('image/');
const esPDF = (mime) => String(mime || '') === 'application/pdf';
const esVideo = (mime) => String(mime || '').startsWith('video/');

/**
 * Miniatura de la evidencia de una actividad. Devuelve null si no hay nada que mostrar,
 * para que quien la llame decida qué poner en su lugar.
 *
 * Carga perezosa: se resuelve el blob DESPUÉS de devolver el nodo. Con veinte evidencias en
 * pantalla, esperar a las veinte antes de pintar dejaría la lista en blanco varios segundos.
 */
export function miniaturaEvidencia(actividad) {
    const fuente = urlEvidencia(actividad);
    if (!fuente) return null;

    const caja = document.createElement('button');
    caja.type = 'button';
    caja.className = 'evid-mini';
    caja.setAttribute('aria-label', 'Ver evidencia');

    const marca = document.createElement('span');
    marca.className = 'evid-mini-carga';
    marca.textContent = '…';
    caja.appendChild(marca);

    resolver(fuente).then(({ url, urlMiniatura, urlVisor, mime, revocar }) => {
        if (!url) {
            marca.textContent = '⚠';
            marca.title = 'No se pudo cargar la evidencia';
            return;
        }
        caja.innerHTML = '';
        caja.appendChild(cuerpoMiniatura(urlMiniatura, mime));
        caja.addEventListener('click', () => abrirVisor(url, mime, actividad, urlVisor));
        // El objectURL vive mientras viva la miniatura; el visor crea el suyo.
        caja._revocar = revocar;
    });

    return caja;
}

function cuerpoMiniatura(url, mime) {
    if (esImagen(mime)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Evidencia';
        img.loading = 'lazy';       // fuera de pantalla no se descarga
        img.decoding = 'async';
        return img;
    }

    if (esVideo(mime)) {
        const v = document.createElement('video');
        v.src = url;
        v.muted = true;
        v.preload = 'metadata';     // solo el primer fotograma, no el archivo entero
        v.playsInline = true;
        return v;
    }

    if (esPDF(mime)) {
        const marca = document.createElement('span');
        marca.className = 'evid-mini-doc';
        marca.textContent = 'PDF';
        return marca;
    }

    const otro = document.createElement('span');
    otro.className = 'evid-mini-doc';
    otro.textContent = 'archivo';
    return otro;
}

/**
 * Resuelve la fuente a una URL utilizable.
 *
 * El archivo local se sirve desde IndexedDB con un objectURL —instantáneo y sin red—; el
 * remoto se deja a Drive. `revocar` libera la memoria del objectURL: sin eso, una lista larga
 * de evidencias se va acumulando en memoria hasta que la pestaña se vuelve lenta.
 */
async function resolver(fuente) {
    if (fuente.tipo === 'remota') {
        // `urlMiniatura`/`urlVisor` embebibles; `url` es la original de Drive, para
        // "Abrir aparte". Un archivo remoto sin id reconocible (formato inesperado) cae a
        // usar `url` en los tres — no se ve mejor, pero tampoco se rompe.
        return {
            url: fuente.url,
            urlMiniatura: fuente.urlMiniatura || fuente.url,
            urlVisor: fuente.urlVisor || fuente.url,
            mime: fuente.mime,
            revocar: () => {}
        };
    }
    try {
        const blob = await leerArchivo(fuente.id);
        if (!blob) return { url: null };
        const url = URL.createObjectURL(blob);
        return {
            url, urlMiniatura: url, urlVisor: url,
            mime: blob.type || fuente.mime,
            revocar: () => URL.revokeObjectURL(url)
        };
    } catch (err) {
        console.error('No se pudo leer la evidencia local:', err);
        return { url: null };
    }
}

// ---------- visor ----------

/**
 * Ampliada. Un modal propio, encima de todo, que se cierra con Escape, clic fuera o la ✕.
 *
 * `urlVisor` (si se pasa) es la que se incrusta en el cuerpo del visor; `url` sigue siendo la
 * original de Drive, para "Abrir aparte" — la página real de Drive, con su descarga y su
 * propio zoom, que sigue siendo mejor que cualquier cosa que se pueda ofrecer aquí dentro.
 */
export function abrirVisor(url, mime, actividad, urlVisor = url) {
    const modal = document.createElement('div');
    modal.className = 'visor';

    const caja = document.createElement('div');
    caja.className = 'visor-caja';

    const head = document.createElement('div');
    head.className = 'visor-head';

    const titulo = document.createElement('span');
    titulo.className = 'visor-titulo';
    titulo.textContent = actividad?.evidencia?.nombre || 'Evidencia';

    const acciones = document.createElement('div');
    acciones.className = 'visor-acciones';

    // Abrir aparte sigue disponible: para un PDF largo el visor nativo a pantalla completa
    // es mejor que cualquier cosa que se pueda hacer aquí dentro.
    if (String(url).startsWith('http')) {
        const externo = document.createElement('a');
        externo.className = 'btn-txt';
        externo.href = url;
        externo.target = '_blank';
        externo.rel = 'noopener';
        externo.textContent = 'Abrir aparte';
        acciones.appendChild(externo);
    }

    const cerrarBtn = document.createElement('button');
    cerrarBtn.type = 'button';
    cerrarBtn.className = 'icon-btn';
    cerrarBtn.setAttribute('aria-label', 'Cerrar');
    cerrarBtn.textContent = '✕';
    acciones.appendChild(cerrarBtn);

    head.append(titulo, acciones);

    const cuerpo = document.createElement('div');
    cuerpo.className = 'visor-cuerpo';
    cuerpo.appendChild(cuerpoVisor(urlVisor, mime));

    caja.append(head, cuerpo);
    modal.appendChild(caja);

    const cerrar = () => {
        modal.remove();
        document.removeEventListener('keydown', alEscape);
    };
    function alEscape(e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();       // no cerrar también el drawer de atrás
        cerrar();
    }

    cerrarBtn.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', alEscape);

    document.body.appendChild(modal);
    return cerrar;
}

function cuerpoVisor(url, mime) {
    if (esImagen(mime)) {
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Evidencia';
        return img;
    }

    if (esVideo(mime)) {
        const v = document.createElement('video');
        v.src = url;
        v.controls = true;
        v.playsInline = true;
        v.autoplay = true;
        return v;
    }

    if (esPDF(mime)) {
        // Remoto: `url` aquí es la página de visor embebible de Drive
        // (`/file/d/ID/preview`), NO el PDF crudo — Drive la sirve para vivir dentro de un
        // <iframe>, y un <object type="application/pdf"> fallaría porque lo que llega es
        // HTML, no bytes de PDF. Local (`blob:`): sí son los bytes crudos del archivo, y ahí
        // el <object> con el visor nativo del navegador es lo correcto.
        if (String(url).startsWith('blob:')) {
            const obj = document.createElement('object');
            obj.data = url;
            obj.type = 'application/pdf';

            const alterno = document.createElement('p');
            alterno.className = 'ayuda';
            alterno.textContent = 'Este navegador no puede mostrar el PDF aquí. Usa "Abrir aparte".';
            obj.appendChild(alterno);
            return obj;
        }

        const marco = document.createElement('iframe');
        marco.src = url;
        marco.className = 'visor-pdf';
        marco.title = 'Vista previa del PDF';
        return marco;
    }

    const p = document.createElement('p');
    p.className = 'ayuda';
    p.textContent = 'No hay vista previa para este tipo de archivo.';
    return p;
}
