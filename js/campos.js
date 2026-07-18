/**
 * Primitivas de formulario compartidas.
 *
 * Vivían dentro de drawer.js cuando el drawer era el único que capturaba. Ahora la actividad
 * y el material tienen ventana propia, y los tres tienen que verse igual: un campo que se ve
 * distinto según desde dónde se abrió hace dudar de si es el mismo campo.
 *
 * Ninguna de estas funciones sabe qué se está capturando ni dónde se guarda. Reciben el valor
 * y devuelven el nodo; quien las llama decide qué hacer con el cambio.
 */

/** Etiqueta + control + ayuda opcional. La unidad mínima de un formulario. */
export function envolver(etiqueta, control, ayuda) {
    const campo = document.createElement('div');
    campo.className = 'campo';

    const l = document.createElement('label');
    l.className = 'campo-lbl';
    l.textContent = etiqueta;
    l.appendChild(control);
    campo.appendChild(l);

    if (ayuda) {
        const a = document.createElement('p');
        a.className = 'ayuda';
        a.textContent = ayuda;
        campo.appendChild(a);
    }
    return campo;
}

export function campoTexto(etiqueta, valor, placeholder, onCambio, { mono = false, ayuda = null } = {}) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp' + (mono ? ' mono' : '');
    inp.value = valor || '';
    inp.placeholder = placeholder;
    inp.addEventListener('input', () => onCambio(inp.value));
    return envolver(etiqueta, inp, ayuda);
}

/**
 * Select con opción vacía. `extra` conserva un valor que ya no está en el catálogo: borrarlo
 * de la lista no debe borrarlo del registro que lo usó.
 */
export function selectSimple(etiqueta, opciones, valor, onCambio, extra = null) {
    const sel = document.createElement('select');
    sel.className = 'inp';

    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Elige…';
    sel.appendChild(vacio);

    opciones.forEach(o => {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o;
        if (o === valor) op.selected = true;
        sel.appendChild(op);
    });

    if (extra) {
        const op = document.createElement('option');
        op.value = valor;
        op.textContent = extra;
        op.selected = true;
        sel.appendChild(op);
    }

    sel.addEventListener('change', () => onCambio(sel.value));
    return envolver(etiqueta, sel);
}

/**
 * Marca un campo como inválido y le cuelga el motivo.
 *
 * El mensaje va PEGADO al campo, no en un toast: un toast se va solo y obliga a recordar cuál
 * de seis campos era. Se limpia en cuanto el usuario toca el campo — seguir en rojo mientras
 * ya lo está corrigiendo es regañar por algo que se está resolviendo.
 */
export function marcarError(campo, mensaje) {
    if (!campo) return;
    campo.classList.add('es-error');

    if (!campo.querySelector('.campo-error')) {
        const p = document.createElement('p');
        p.className = 'campo-error';
        p.textContent = mensaje;
        campo.appendChild(p);
    }

    const control = campo.querySelector('.inp');
    if (!control) return;
    control.setAttribute('aria-invalid', 'true');
    control.addEventListener('input', () => limpiarError(campo), { once: true });
    control.addEventListener('change', () => limpiarError(campo), { once: true });
}

export function limpiarError(campo) {
    campo.classList.remove('es-error');
    campo.querySelector('.campo-error')?.remove();
    campo.querySelector('.inp')?.removeAttribute('aria-invalid');
}

/**
 * Resalta la coincidencia sin innerHTML.
 *
 * Marca cada PALABRA por separado, no la cadena entera: el buscador empareja palabras sueltas
 * y en cualquier orden, así que "gasa 10x10" encuentra "GASA SIMPLE 10X10 CM" — pero un
 * indexOf literal no hallaría nada ahí y la lista se vería sin resaltar, como si no hubiera
 * entendido la búsqueda.
 */
export function resaltar(texto, q) {
    const palabras = (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return [document.createTextNode(texto)];

    // Se buscan los tramos a marcar y se fusionan los que se toquen o solapen.
    const bajo = texto.toLowerCase();
    const tramos = [];
    palabras.forEach(p => {
        let i = bajo.indexOf(p);
        while (i !== -1) {
            tramos.push([i, i + p.length]);
            i = bajo.indexOf(p, i + p.length);
        }
    });
    if (tramos.length === 0) return [document.createTextNode(texto)];

    tramos.sort((a, b) => a[0] - b[0]);
    const unidos = [tramos[0]];
    for (const [ini, fin] of tramos.slice(1)) {
        const ultimo = unidos[unidos.length - 1];
        if (ini <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], fin);
        else unidos.push([ini, fin]);
    }

    const nodos = [];
    let cursor = 0;
    for (const [ini, fin] of unidos) {
        if (ini > cursor) nodos.push(document.createTextNode(texto.slice(cursor, ini)));
        const mark = document.createElement('mark');
        mark.textContent = texto.slice(ini, fin);
        nodos.push(mark);
        cursor = fin;
    }
    if (cursor < texto.length) nodos.push(document.createTextNode(texto.slice(cursor)));
    return nodos;
}

/** Dato de solo lectura: etiqueta arriba, valor abajo. Nunca un input deshabilitado. */
export function dato(etiqueta, valor) {
    const caja = document.createElement('div');
    caja.className = 'dato';

    const l = document.createElement('span');
    l.className = 'dato-lbl';
    l.textContent = etiqueta;

    const v = document.createElement('span');
    v.className = 'dato-val';
    if (valor) {
        v.textContent = valor;
    } else {
        v.textContent = '—';
        v.classList.add('es-vacio');
    }

    caja.append(l, v);
    return caja;
}

/**
 * Escape cierra SOLO la ventana de encima. Devuelve la función para desconectarlo.
 *
 * Puede haber varias abiertas a la vez —un material sobre una actividad, sobre el drawer— y
 * todas escuchan en `document`. Ahí `stopPropagation` no sirve de nada: frena la subida por
 * el árbol, que en `document` ya terminó, pero no a los otros listeners del mismo nodo. Sin
 * esta comprobación, cerrar el material cerraría también la actividad de atrás y se perdería
 * de vista lo que se estaba capturando.
 */
export function cerrarConEscape(modal, onCerrar) {
    function alEscape(e) {
        if (e.key !== 'Escape' || !document.body.contains(modal)) return;

        const abiertos = modal.parentElement?.querySelectorAll(':scope > .modal') || [];
        if (abiertos[abiertos.length - 1] !== modal) return;   // hay otra encima

        e.stopPropagation();   // el drawer del fondo tampoco debe cerrarse
        onCerrar();
    }
    document.addEventListener('keydown', alEscape);
    return () => document.removeEventListener('keydown', alEscape);
}

/** Cabecera de una ventana propia: título, subtítulo y la ✕. */
export function cabeceraModal(titulo, subtitulo, onCerrar) {
    const head = document.createElement('div');
    head.className = 'modal-head';

    const izq = document.createElement('div');
    izq.className = 'drawer-head-txt';

    const h = document.createElement('h3');
    h.textContent = titulo;
    izq.appendChild(h);

    if (subtitulo) {
        const sub = document.createElement('span');
        sub.className = 'eyebrow';
        sub.textContent = subtitulo;
        izq.appendChild(sub);
    }

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'icon-btn';
    x.setAttribute('aria-label', 'Cerrar');
    x.textContent = '✕';
    x.addEventListener('click', onCerrar);

    head.append(izq, x);
    return head;
}
