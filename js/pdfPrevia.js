/**
 * Vista previa de PDF dibujada por la propia app (pdf.js), no por el navegador.
 *
 * Por qué no un `<iframe>` o `<object>` con el PDF: los navegadores de teléfono (Android, iOS)
 * no pintan un PDF dentro de un iframe —muestran un recuadro con el nombre del archivo y un botón,
 * o nada— y en escritorio depende de que el visor de PDF del navegador esté habilitado. La
 * evidencia se revisa justo desde el teléfono, así que "a veces se ve" no sirve. Aquí el PDF se
 * dibuja en un `<canvas>`: se ve igual en cualquier navegador.
 *
 * La librería pesa ~1 MB, así que se carga SOLO la primera vez que hay un PDF que mostrar.
 * Cualquier fallo se propaga como excepción: quien llama decide el respaldo (el iframe de antes y
 * el enlace "Abrir aparte"), de modo que nunca se queda sin salida.
 */

let libreria = null;

function cargarLibreria() {
    if (!libreria) {
        libreria = Promise.all([
            import('pdfjs-dist/legacy/build/pdf.min.mjs'),
            import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
        ]).then(([lib, worker]) => {
            lib.GlobalWorkerOptions.workerSrc = worker.default;
            return lib;
        }).catch((err) => {
            libreria = null;      // se reintenta la próxima vez
            throw err;
        });
    }
    return libreria;
}

export async function abrirPDF(url) {
    const lib = await cargarLibreria();
    return lib.getDocument({ url }).promise;
}

/** Dibuja la página `n` de `doc` en un canvas de `ancho` píxeles CSS de ancho. */
export async function dibujarPagina(doc, n, ancho) {
    const pagina = await doc.getPage(n);
    const base = pagina.getViewport({ scale: 1 });
    // Nítido en pantallas de alta densidad, sin pasarse: un canvas enorme agota la memoria del teléfono.
    const densidad = Math.min(window.devicePixelRatio || 1, 2);
    const vista = pagina.getViewport({ scale: (ancho / base.width) * densidad });

    const lienzo = document.createElement('canvas');
    lienzo.width = Math.floor(vista.width);
    lienzo.height = Math.floor(vista.height);
    lienzo.style.width = '100%';
    lienzo.style.height = 'auto';
    lienzo.style.display = 'block';

    await pagina.render({ canvasContext: lienzo.getContext('2d'), viewport: vista }).promise;
    return lienzo;
}

// ---------- miniaturas: de a pocas y solo las que se ven ----------

const MAX_SIMULTANEAS = 2;
let activas = 0;
const cola = [];

function siguiente() {
    while (activas < MAX_SIMULTANEAS && cola.length) {
        const tarea = cola.shift();
        activas++;
        tarea().finally(() => { activas--; siguiente(); });
    }
}

function encolar(trabajo) {
    return new Promise((resolve, reject) => {
        cola.push(() => trabajo().then(resolve, reject));
        siguiente();
    });
}

/** Primera página del PDF como canvas (para la miniatura). */
export function miniaturaPDF(url, ancho = 160) {
    return encolar(async () => {
        const doc = await abrirPDF(url);
        try {
            return await dibujarPagina(doc, 1, ancho);
        } finally {
            doc.destroy();
        }
    });
}

/** Ejecuta `fn` cuando el elemento entra en pantalla (o ya, si el navegador no sabe observar). */
export function cuandoSeVea(elemento, fn) {
    if (typeof IntersectionObserver === 'undefined') { fn(); return; }
    const obs = new IntersectionObserver((entradas) => {
        if (entradas.some(e => e.isIntersecting)) { obs.disconnect(); fn(); }
    }, { rootMargin: '200px' });
    obs.observe(elemento);
}

// ---------- visor: todas las páginas, una debajo de otra ----------

const MAX_PAGINAS = 40;

/**
 * Llena `contenedor` con las páginas del PDF. Las páginas se dibujan en orden y se pueden ir
 * leyendo mientras llegan las siguientes. Devuelve una función para liberar el documento.
 */
export async function pintarPDFEn(contenedor, url) {
    const doc = await abrirPDF(url);
    const total = Math.min(doc.numPages, MAX_PAGINAS);
    const ancho = Math.min(contenedor.clientWidth || 800, 1000);

    contenedor.textContent = '';
    const pila = document.createElement('div');
    pila.className = 'visor-pdf-paginas';
    pila.style.cssText = 'display:flex;flex-direction:column;gap:10px;width:100%;max-width:1000px;margin:0 auto';
    contenedor.appendChild(pila);

    // La primera se espera: si falla, se lanza y quien llama usa su respaldo. Las demás no.
    pila.appendChild(await dibujarPagina(doc, 1, ancho));

    (async () => {
        for (let n = 2; n <= total; n++) {
            try { pila.appendChild(await dibujarPagina(doc, n, ancho)); } catch { break; }
        }
        if (doc.numPages > total) {
            const nota = document.createElement('p');
            nota.className = 'ayuda';
            nota.textContent = `Se muestran las primeras ${total} de ${doc.numPages} páginas. Usa "Abrir aparte" para ver todo.`;
            pila.appendChild(nota);
        }
    })();

    return () => doc.destroy();
}

// ---------- tipo de archivo cuando el servidor no lo dijo ----------

/**
 * Deduce el tipo mirando los primeros bytes. Hay evidencias sin `mime` ni extensión reconocible
 * (las que llegan por el espejo del equipo), y sin tipo no se sabe cómo mostrarlas.
 */
export async function detectarMime(url) {
    try {
        const r = await fetch(url, { headers: { Range: 'bytes=0-11' } });
        const b = new Uint8Array(await r.arrayBuffer()).subarray(0, 12);
        const txt = String.fromCharCode(...b.subarray(0, 5));
        if (txt.startsWith('%PDF')) return 'application/pdf';
        if (b[0] === 0xFF && b[1] === 0xD8) return 'image/jpeg';
        if (b[0] === 0x89 && txt.slice(1, 4) === 'PNG') return 'image/png';
        if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'image/webp';
        if (txt.startsWith('GIF8')) return 'image/gif';
    } catch { /* sin red o sin permiso: queda sin tipo */ }
    return '';
}
