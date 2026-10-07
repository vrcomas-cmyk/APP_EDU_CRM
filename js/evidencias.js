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
import { configuracionCampos, fechaDocumentoEnEvidencia, fechaDocumentoFaltante, MODOS } from './catalogos.js';
import { campoFechaDD, cabeceraModal, cerrarConEscape } from './campos.js';
import { fechaCorta } from './fechas.js';

const LADO_MAX = 1600;
const CALIDAD_JPEG = 0.8;
const LIMITE_PDF = 10 * 1024 * 1024;

export const TIPOS_ACEPTADOS = 'image/*,application/pdf';

// ---------- adjuntar ----------

/**
 * Guarda el archivo localmente y marca 'local'. No sube nada: de eso se encarga la cola.
 *
 * `fecha_documento` ('YYYY-MM-DD') es la fecha del documento que se adjunta: con la evidencia
 * obligatoria se pregunta AQUÍ y no al capturar la actividad (ver `fechaDocumentoEnEvidencia`).
 */
export async function adjuntarEvidencia(idActividad, archivo, { fecha_documento } = {}) {
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
        url: '',
        // Cuándo se adjuntó: es la fecha de REGISTRO, distinta de la del documento y de la visita.
        adjuntada: new Date().toISOString(),
        // Un archivo nuevo empieza limpio: el error de la subida anterior ya no aplica.
        ultimo_error: undefined, intentos: undefined, ultimo_intento: undefined
    }, { fecha_documento });
    if (visita) registrar(TIPOS.EVIDENCIA, visita, { id_actividad: idActividad, nombre });
    return blob;
}

export async function quitarEvidencia(idActividad) {
    await borrarArchivo(idActividad).catch(() => {});
    escribirEvidencia(idActividad, {
        estado: 'pendiente', nombre: '', mime: '', url: '', adjuntada: undefined,
        ultimo_error: undefined, intentos: undefined, ultimo_intento: undefined
    }, { limpiarFecha: true });
}

/** Fija (o corrige) la fecha del documento de una actividad cuyo archivo ya se adjuntó. */
export function fijarFechaDocumento(idActividad, fecha) {
    const visita = escribirEvidencia(idActividad, {}, { fecha_documento: fecha });
    return Boolean(visita);
}

export { subirEvidencia };

function nombreDeArchivo(archivo, esPDF) {
    if (esPDF) return archivo.name || 'evidencia.pdf';
    const base = (archivo.name || 'evidencia').replace(/\.[^.]+$/, '');
    return `${base}.jpg`;   // se recomprimió a JPEG, la extensión debe decir la verdad
}

/**
 * Escribe la evidencia en el árbol y marca la visita para re-sincronizar. Devuelve la visita tocada.
 *
 * Se FUSIONA con lo que ya había: antes se reemplazaba el objeto entero y se perdía el "Tipo de
 * evidencia" que la persona eligió en el formulario de la actividad.
 */
function escribirEvidencia(idActividad, evidencia, { fecha_documento, limpiarFecha = false } = {}) {
    const visitas = leerVisitas();
    for (const visita of visitas) {
        for (const sector of visita.sectores || []) {
            const actividad = (sector.actividades || []).find(a => a.id === idActividad);
            if (!actividad) continue;

            actividad.evidencia = { ...actividad.evidencia, ...evidencia };
            if (fecha_documento) actividad.fecha_documento = fecha_documento;
            // Quitar el archivo quita la fecha SOLO si se había preguntado con él: si venía del
            // formulario de la actividad, es un dato de la actividad y no del archivo.
            if (limpiarFecha && fechaDocumentoEnEvidencia(actividad.tipo)) delete actividad.fecha_documento;
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

    // Ya adjunta (en cola o subida) y con la fecha del documento por preguntar: se muestra la que
    // hay, o se pide la que falta (p. ej. un archivo adjuntado antes de que esto existiera).
    const agregarFecha = () => {
        const etiqueta = etiquetaFechaDocumento(actividad);
        if (etiqueta) caja.appendChild(etiqueta);
        else if (fechaDocumentoFaltante(actividad)) caja.appendChild(editorFechaFaltante(actividad, alCambiar, alToast));
    };

    if (ev.estado === 'subida') {
        const ok = document.createElement('span');
        ok.className = 'pill st-completa';
        ok.style.setProperty('--st', 'var(--st-done)');
        ok.style.setProperty('--st-bg', 'var(--st-done-bg)');
        ok.textContent = '☁ Subida';
        caja.appendChild(ok);
        agregarFecha();
        // Sin enlace "Ver" a Drive: quien monta este control ya pone al lado la miniatura de
        // `vistaprevia.js` (`miniaturaEvidencia`), que abre el visor DENTRO de la app —imagen,
        // PDF o video embebido, con "Abrir aparte" como opción secundaria en ese visor, no como
        // la única vía. Repetir un enlace que saca de la app aquí era el mismo archivo, dos
        // caminos, y el peor de los dos.
        return caja;
    }

    if (ev.estado === 'local') {
        const listo = document.createElement('span');
        listo.className = 'pill st-faltan-evidencias';
        listo.textContent = `📎 ${ev.nombre || 'archivo'}`;

        const subir = document.createElement('button');
        subir.type = 'button';
        subir.className = 'btn-txt';
        // Sin la fecha del documento (obligatoria) la evidencia no sube: ni sola ni a la fuerza.
        const esperaFecha = fechaDocumentoFaltante(actividad);
        subir.textContent = esperaFecha ? 'Falta la fecha' : (navigator.onLine ? 'Subir ahora' : 'Espera señal');
        subir.disabled = esperaFecha || !navigator.onLine;
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
        agregarFecha();
        return caja;
    }

    caja.appendChild(selectorArchivo(actividad, alCambiar, alToast));
    return caja;
}

/**
 * La misma información que `controlEvidencia`, pero sin ningún botón: para quien mira la
 * actividad de otra persona. `escribirEvidencia` escribe directo a `localStorage` (no pasa por
 * el guardián de `visitasRepo.actualizarVisita`) precisamente porque nació pensando solo en la
 * propia captura; sin esta vista aparte, cualquiera que abriera la actividad de alguien más
 * vería los mismos botones de "Subir"/"Quitar" y podría creer que funcionaron.
 */
export function vistaEvidencia(actividad) {
    const caja = document.createElement('div');
    caja.className = 'evid';

    const ev = actividad.evidencia || { estado: 'pendiente' };

    if (ev.estado === 'subida') {
        const ok = document.createElement('span');
        ok.className = 'pill st-completa';
        ok.textContent = '☁ Subida';
        caja.appendChild(ok);
        const fecha = etiquetaFechaDocumento(actividad);
        if (fecha) caja.appendChild(fecha);
        // Mismo motivo que en controlEvidencia(): la miniatura de al lado ya abre el visor
        // in-app; un enlace aparte aquí solo duplicaba la salida hacia afuera de la app.
        return caja;
    }

    const pendiente = document.createElement('span');
    pendiente.className = 'pill st-faltan-evidencias';
    pendiente.textContent = ev.estado === 'local' ? '📎 En cola por subir' : 'Sin evidencia todavía';
    caja.appendChild(pendiente);
    const fecha = etiquetaFechaDocumento(actividad);
    if (fecha) caja.appendChild(fecha);
    return caja;
}

/** "Doc. dd/mm/aaaa", si la fecha del documento se pregunta con el archivo y ya se tiene. */
function etiquetaFechaDocumento(actividad) {
    if (!fechaDocumentoEnEvidencia(actividad.tipo) || !actividad.fecha_documento) return null;
    const e = document.createElement('span');
    e.className = 'evid-fecha';
    e.textContent = `Doc. ${fechaCorta(actividad.fecha_documento)}`;
    return e;
}

/**
 * Ventana emergente para la fecha del documento.
 *
 * Es una VENTANA y no un campo en línea a propósito: un campo más en un formulario se pasaba por
 * alto y la evidencia quedaba sin fecha. Una ventana no se puede ignorar sin decidir algo.
 *
 *   alElegir(fecha)   la persona la capturó
 *   alPosponer()      "Poner la fecha después" (solo al adjuntar un archivo nuevo)
 *   alCancelar()      cerró sin decidir (Escape, fuera de la ventana o "Cancelar")
 */
function abrirDialogoFecha({ subtitulo = '', obligatoria, soloFecha = false, alElegir, alPosponer, alCancelar }) {
    const raiz = document.createElement('div');
    raiz.className = 'dialogo-raiz';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja es-fecha';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-label', 'Fecha del documento');

    let soltarEscape = () => {};
    const cerrar = () => { soltarEscape(); raiz.remove(); };
    const cancelar = () => { cerrar(); alCancelar?.(); };

    const cuerpo = document.createElement('div');
    cuerpo.className = 'modal-body';

    const pregunta = document.createElement('span');
    pregunta.className = 'campo-lbl';
    pregunta.textContent = obligatoria ? '¿De qué fecha es el documento? *' : '¿De qué fecha es el documento?';

    const ayuda = document.createElement('p');
    ayuda.className = 'ayuda';
    ayuda.textContent = 'Es la fecha que trae el documento, no la de hoy ni la de la visita.';

    let elegida = '';
    const confirmar = document.createElement('button');
    confirmar.type = 'button';
    confirmar.className = 'btn btn-principal';
    confirmar.textContent = soloFecha ? 'Guardar fecha' : 'Adjuntar';
    confirmar.disabled = true;
    confirmar.addEventListener('click', () => { if (!elegida) return; cerrar(); alElegir(elegida); });

    const campo = campoFechaDD('', (v) => { elegida = v; confirmar.disabled = !v; });

    cuerpo.append(pregunta, campo, ayuda);

    if (obligatoria && !soloFecha) {
        const aviso = document.createElement('p');
        aviso.className = 'dialogo-aviso';
        aviso.textContent = 'Si la dejas para después, la evidencia queda guardada en este dispositivo pero NO se sube '
            + 'hasta que captures la fecha. Te lo recordamos en Avisos.';
        cuerpo.appendChild(aviso);
    }

    const pie = document.createElement('div');
    pie.className = 'modal-foot';
    const espacio = document.createElement('span');
    espacio.style.flex = '1';

    const posponer = document.createElement('button');
    posponer.type = 'button';
    posponer.className = 'btn-txt';
    posponer.textContent = soloFecha ? 'Después' : 'Poner la fecha después';
    posponer.addEventListener('click', () => { cerrar(); if (alPosponer) alPosponer(); else alCancelar?.(); });

    const cancelarBtn = document.createElement('button');
    cancelarBtn.type = 'button';
    cancelarBtn.className = 'btn-txt';
    cancelarBtn.textContent = 'Cancelar';
    cancelarBtn.addEventListener('click', cancelar);

    pie.append(espacio);
    if (!soloFecha) pie.append(cancelarBtn);
    pie.append(posponer, confirmar);
    cuerpo.appendChild(pie);

    caja.append(cabeceraModal('Fecha del documento', subtitulo, cancelar), cuerpo);
    modal.appendChild(caja);
    modal.addEventListener('click', (e) => { if (e.target === modal) cancelar(); });
    raiz.appendChild(modal);
    soltarEscape = cerrarConEscape(modal, cancelar);

    document.body.appendChild(raiz);
    caja.querySelector('input[type="date"]')?.focus({ preventScroll: true });
    return { cerrar };
}

/**
 * Pide la fecha del documento de una evidencia YA adjunta (la que se dejó para después, o un archivo
 * anterior a este paso). Al capturarla, la evidencia que esperaba ya puede subirse.
 */
export function pedirFechaDocumento(actividad, { alCambiar = () => {}, alToast = () => {} } = {}) {
    return abrirDialogoFecha({
        subtitulo: actividad.evidencia?.nombre || actividad.tipo || '',
        obligatoria: true,
        soloFecha: true,
        alElegir: (fecha) => {
            if (fijarFechaDocumento(actividad.id, fecha)) {
                alToast('Fecha del documento guardada: la evidencia ya puede subirse.', { estado: 'completa' });
            } else {
                alToast('No se pudo guardar la fecha.', { estado: 'sin-registrar' });
            }
            alCambiar();
        }
    });
}

/**
 * El aviso en la propia evidencia: resaltado, para que no se pase por alto. Dice qué falta y qué
 * pasa mientras tanto (la evidencia no se sube) y abre la ventana para ponerla.
 */
function editorFechaFaltante(actividad, alCambiar, alToast) {
    const caja = document.createElement('div');
    caja.className = 'evid-fecha-falta es-alerta';
    caja.setAttribute('role', 'status');

    const aviso = document.createElement('span');
    aviso.className = 'evid-fecha-falta-txt';
    aviso.textContent = actividad.evidencia?.estado === 'local'
        ? 'Falta la fecha del documento: la evidencia no se subirá hasta que la captures.'
        : 'Falta la fecha del documento.';

    const poner = document.createElement('button');
    poner.type = 'button';
    poner.className = 'btn btn-principal';
    poner.textContent = 'Poner la fecha';
    poner.addEventListener('click', () => pedirFechaDocumento(actividad, { alCambiar, alToast }));

    caja.append(aviso, poner);
    return caja;
}

function selectorArchivo(actividad, alCambiar, alToast) {
    const conFecha = fechaDocumentoEnEvidencia(actividad.tipo);
    const fechaObligatoria = configuracionCampos(actividad.tipo).fecha_documento === MODOS.OBLIGATORIO;

    const raiz = document.createElement('div');
    raiz.className = 'evid-adjuntar';

    const etiqueta = document.createElement('label');
    etiqueta.className = 'btn-archivo';
    etiqueta.textContent = '📷 Agregar evidencia';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = TIPOS_ACEPTADOS;
    // Sin `capture`: con él, Android fuerza abrir la cámara y quita la opción de elegir una
    // foto ya tomada de la galería o un PDF del almacenamiento, aunque `accept` los permita.
    // Sin `capture` el mismo diálogo ofrece cámara y archivos, con la cámara a un toque.
    input.hidden = true;

    async function adjuntar(archivo, fecha, pospuesta = false) {
        etiqueta.textContent = '⏳ Procesando…';
        try {
            await adjuntarEvidencia(actividad.id, archivo, { fecha_documento: fecha });
            if (pospuesta && fechaObligatoria) {
                alToast(
                    'Quedó pendiente la fecha del documento: la evidencia no se sube hasta que la captures. Lo verás en Avisos.',
                    { estado: 'sin-registrar' }
                );
            }
        } catch (err) {
            console.error(err);
            alToast(err.message, { estado: 'sin-registrar' });
        }
        alCambiar();
    }

    input.addEventListener('change', async () => {
        const archivo = input.files && input.files[0];
        if (!archivo) return;

        if (!conFecha) { await adjuntar(archivo); return; }

        // El archivo ya está elegido y a la vista: es el momento de preguntar su fecha.
        abrirDialogoFecha({
            subtitulo: archivo.name || 'archivo',
            obligatoria: fechaObligatoria,
            alElegir: (fecha) => adjuntar(archivo, fecha),
            alPosponer: () => adjuntar(archivo, undefined, true),
            alCancelar: () => { input.value = ''; }
        });
    });

    etiqueta.appendChild(input);
    raiz.appendChild(etiqueta);
    return raiz;
}
