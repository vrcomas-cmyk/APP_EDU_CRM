/**
 * Hilo de comentarios reutilizable.
 *
 * Lo hospedan la visita, el sector, la actividad y la evidencia. Se ve igual en los cuatro
 * porque es la misma conversación: cambiar la forma según dónde cuelga haría dudar de si son
 * lo mismo.
 *
 * Un comentario ya escrito se pinta en frío, sin controles: no hay botón de editar ni de
 * borrar, porque no hay a qué llamarlo. Lo único que se ofrece es escribir el siguiente.
 */

import { comentariosDe, comentar, AMBITOS } from './comentarios.js';
import { puede } from './permisos.js';

export { AMBITOS };

/**
 * @param ambito    uno de AMBITOS
 * @param idAmbito  id de la entidad comentada
 * @param visita    da cliente/hospital al comentario, para el histórico por hospital
 */
export function hiloComentarios({ ambito, idAmbito, visita, alToast = () => {}, compacto = false }) {
    const caja = document.createElement('div');
    caja.className = 'hilo' + (compacto ? ' es-compacto' : '');

    if (!puede('comentarios', 'leer')) return caja;

    const lista = document.createElement('div');
    lista.className = 'hilo-lista';
    caja.appendChild(lista);

    const pintarLista = () => {
        lista.innerHTML = '';
        const comentarios = comentariosDe(ambito, idAmbito);

        if (comentarios.length === 0) {
            const p = document.createElement('p');
            p.className = 'ayuda';
            p.textContent = 'Sin comentarios.';
            lista.appendChild(p);
            return;
        }
        comentarios.forEach(c => lista.appendChild(burbuja(c)));
    };

    pintarLista();

    if (puede('comentarios', 'crear')) {
        caja.appendChild(redactor(ambito, idAmbito, visita, alToast, pintarLista));
    }

    return caja;
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

function redactor(ambito, idAmbito, visita, alToast, alEnviar) {
    const caja = document.createElement('div');
    caja.className = 'hilo-nuevo';

    const area = document.createElement('textarea');
    area.className = 'inp hilo-area';
    area.rows = 2;
    area.placeholder = 'Escribe un comentario…';

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
