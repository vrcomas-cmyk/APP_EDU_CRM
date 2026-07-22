/**
 * Hilo de comentarios reutilizable.
 *
 * Lo hospedan la visita, el sector, la actividad y la evidencia. Se ve igual en los cuatro
 * porque es la misma conversación: cambiar la forma según dónde cuelga haría dudar de si son
 * lo mismo.
 *
 * Un comentario ya escrito se pinta en frío, sin controles: no hay botón de editar ni de
 * borrar, porque no hay a qué llamarlo. Lo único que se ofrece es escribir el siguiente.
 *
 * ── Vista previa + ventana propia ────────────────────────────────────────────────────
 *
 * En línea solo se pintan los últimos 2 comentarios: un hilo de verdad crece sin límite y
 * pintarlo entero dentro de la actividad/sector/visita empuja el resto del formulario cada vez
 * más abajo hasta que la pantalla deja de servir para lo que se abrió a hacer. Leer y escribir
 * el resto pasa a una ventana propia (mismo patrón que el visor de evidencias), que se abre
 * bajo demanda y no cuando la actividad simplemente se dibuja.
 */

import { comentariosDe, comentar, AMBITOS } from './comentarios.js';
import { puede } from './permisos.js';

export { AMBITOS };

const VISIBLES_EN_PREVIA = 2;

/**
 * @param ambito    uno de AMBITOS
 * @param idAmbito  id de la entidad comentada
 * @param visita    da cliente/hospital al comentario, para el histórico por hospital
 */
export function hiloComentarios({ ambito, idAmbito, visita, alToast = () => {}, compacto = false }) {
    const caja = document.createElement('div');
    caja.className = 'hilo' + (compacto ? ' es-compacto' : '');

    if (!puede('comentarios', 'leer')) return caja;

    const previa = document.createElement('div');
    previa.className = 'hilo-previa';
    caja.appendChild(previa);

    const barra = document.createElement('div');
    barra.className = 'hilo-barra';
    caja.appendChild(barra);

    const puedeEscribir = puede('comentarios', 'crear');

    const pintar = () => {
        const comentarios = comentariosDe(ambito, idAmbito);
        pintarPrevia(previa, comentarios);
        pintarBarra(barra, comentarios, puedeEscribir, () => abrirVentanaHilo({
            ambito, idAmbito, visita, alToast, puedeEscribir, alCerrar: pintar
        }));
    };

    pintar();
    return caja;
}

function pintarPrevia(previa, comentarios) {
    previa.innerHTML = '';

    if (comentarios.length === 0) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = 'Sin comentarios.';
        previa.appendChild(p);
        return;
    }

    comentarios.slice(-VISIBLES_EN_PREVIA).forEach(c => previa.appendChild(burbuja(c)));
}

function pintarBarra(barra, comentarios, puedeEscribir, alAbrir) {
    barra.innerHTML = '';

    const restantes = comentarios.length - VISIBLES_EN_PREVIA;

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'btn-txt hilo-abrir';
    boton.textContent = comentarios.length === 0
        ? (puedeEscribir ? 'Comentar' : 'Ver comentarios')
        : restantes > 0
            ? `Ver los ${comentarios.length}${puedeEscribir ? ' · Comentar' : ''}`
            : puedeEscribir ? 'Ver y comentar' : 'Ver comentarios';
    boton.addEventListener('click', alAbrir);
    barra.appendChild(boton);
}

function burbuja(c) {
    const b = document.createElement('div');
    b.className = 'coment';

    const meta = document.createElement('div');
    meta.className = 'coment-meta';

    const quien = document.createElement('span');
    quien.className = 'coment-autor';
    quien.textContent = c.usuario || c.usuario_correo || 'Sin autor';

    const cuando = document.createElement('span');
    cuando.className = 'coment-fecha mono';
    cuando.textContent = new Date(c.momento).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    meta.append(quien, cuando);

    const texto = document.createElement('p');
    texto.className = 'coment-txt';
    texto.textContent = c.texto;    // textContent, no innerHTML: el texto lo escribe un usuario

    b.append(meta, texto);
    return b;
}

// ---------- ventana propia ----------

/**
 * El hilo completo, en una ventana encima de todo (mismo patrón que `abrirVisor` de
 * evidencias): posición fija y z-index alto, para no depender del contexto de apilado de
 * quien la abra, sea la visita, un sector o una actividad dentro de su propia ventana.
 */
function abrirVentanaHilo({ ambito, idAmbito, visita, alToast, puedeEscribir, alCerrar }) {
    const modal = document.createElement('div');
    modal.className = 'hilo-modal';

    const caja = document.createElement('div');
    caja.className = 'hilo-modal-caja';

    const head = document.createElement('div');
    head.className = 'modal-head';

    const headTxt = document.createElement('div');
    headTxt.className = 'drawer-head-txt';
    const titulo = document.createElement('h3');
    titulo.textContent = 'Comentarios';
    headTxt.appendChild(titulo);
    if (visita?.hospital || visita?.cliente) {
        const sub = document.createElement('span');
        sub.className = 'eyebrow';
        sub.textContent = visita.hospital || visita.cliente;
        headTxt.appendChild(sub);
    }

    const cerrarBtn = document.createElement('button');
    cerrarBtn.type = 'button';
    cerrarBtn.className = 'icon-btn';
    cerrarBtn.setAttribute('aria-label', 'Cerrar');
    cerrarBtn.textContent = '✕';

    head.append(headTxt, cerrarBtn);

    const lista = document.createElement('div');
    lista.className = 'hilo-lista';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'modal-body hilo-modal-body';
    cuerpo.appendChild(lista);

    const pintarLista = () => {
        lista.innerHTML = '';
        const comentarios = comentariosDe(ambito, idAmbito);

        if (comentarios.length === 0) {
            const p = document.createElement('p');
            p.className = 'ayuda';
            p.textContent = 'Sin comentarios todavía.';
            lista.appendChild(p);
            return;
        }
        comentarios.forEach(c => lista.appendChild(burbuja(c)));
        lista.scrollTop = lista.scrollHeight;
    };

    pintarLista();

    if (puedeEscribir) {
        cuerpo.appendChild(redactor(ambito, idAmbito, visita, alToast, () => {
            pintarLista();
            alCerrar();
        }));
    }

    caja.append(head, cuerpo);
    modal.appendChild(caja);

    const cerrar = () => {
        modal.remove();
        document.removeEventListener('keydown', alEscape);
        alCerrar();
    };
    function alEscape(e) {
        if (e.key !== 'Escape') return;
        e.stopPropagation();       // no cerrar también el drawer/ventana de atrás
        cerrar();
    }

    cerrarBtn.addEventListener('click', cerrar);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    document.addEventListener('keydown', alEscape);

    document.body.appendChild(modal);
    return cerrar;
}

function redactor(ambito, idAmbito, visita, alToast, alEnviar) {
    const caja = document.createElement('div');
    caja.className = 'hilo-nuevo';

    const area = document.createElement('textarea');
    area.className = 'inp hilo-area';
    area.rows = 2;
    area.placeholder = 'Escribe un comentario…';
    area.autofocus = true;

    const enviar = document.createElement('button');
    enviar.type = 'button';
    enviar.className = 'btn';
    enviar.textContent = 'Comentar';
    enviar.disabled = true;

    area.addEventListener('input', () => { enviar.disabled = !area.value.trim(); });

    // Ctrl/⌘+Enter envía. Enter solo salta de línea: un comentario suele ser más de un renglón
    // y perderlo a media escritura por tocar Enter sería el peor final posible.
    area.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); mandar(); }
    });
    enviar.addEventListener('click', mandar);

    function mandar() {
        const r = comentar({ ambito, idAmbito, texto: area.value, visita });
        if (!r.ok) return alToast(r.error, { estado: 'sin-registrar' });
        area.value = '';
        enviar.disabled = true;
        alEnviar();
        area.focus();
    }

    caja.append(area, enviar);
    return caja;
}

/**
 * Contador para colgar de una tarjeta. Devuelve null cuando no hay nada: una pastilla que
 * dice "0" ocupa el mismo espacio que una que informa, sin informar.
 */
export function pastillaComentarios(ambito, idAmbito) {
    const n = comentariosDe(ambito, idAmbito).length;
    if (n === 0) return null;

    const p = document.createElement('span');
    p.className = 'pill neutro';
    p.textContent = `${n} 💬`;
    return p;
}
