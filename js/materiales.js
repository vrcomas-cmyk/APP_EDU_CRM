/**
 * Ventana propia para capturar un material.
 *
 * Es una decisión consciente: meter esto dentro del formulario de la actividad la volvería un
 * formulario largo, que es justo lo que hay que evitar de pie en un pasillo.
 *
 * El buscador solo ofrece materiales del SECTOR en curso. El educador está trabajando GASAS:
 * ofrecerle guantes es ruido que lo hace equivocarse.
 *
 * No sabe dónde se guarda el material: recibe `onAgregar` y le entrega el registro ya validado.
 */

import { nuevoId } from './storage.js';
import { unidades, buscarMateriales } from './catalogos.js';
import { envolver, resaltar, cabeceraModal, marcarError, cerrarConEscape } from './campos.js';

/**
 * @param host      dónde colgar el modal (el drawer, para que quede dentro de su stacking context)
 * @param sector    nombre del sector; acota el catálogo
 * @param onAgregar recibe { id, material, cantidad, unidad, origen }
 */
export function abrirModalMaterial({ host, sector, onAgregar, alToast = () => {} }) {
    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja';

    let soltarEscape = () => {};
    const cerrar = () => { modal.remove(); soltarEscape(); };
    const head = cabeceraModal('Agregar material', sector, cerrar);

    const body = document.createElement('div');
    body.className = 'modal-body';

    let elegido = null;

    // --- paso 1: buscar ---
    const busq = document.createElement('div');
    busq.className = 'campo';
    const bl = document.createElement('label');
    bl.className = 'campo-lbl';
    bl.textContent = 'Material';
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'inp';
    inp.placeholder = 'Escribe para buscar…';
    inp.autocomplete = 'off';
    bl.appendChild(inp);
    const res = document.createElement('div');
    res.className = 'mat-res';
    busq.append(bl, res);

    // --- paso 2: los datos, que solo aparecen al elegir ---
    const detalle = document.createElement('div');
    detalle.className = 'mat-detalle';
    detalle.hidden = true;

    const cantidad = document.createElement('input');
    cantidad.type = 'number';
    cantidad.min = '0';
    cantidad.step = 'any';
    cantidad.className = 'inp mono';
    cantidad.placeholder = '0';

    const unidad = document.createElement('select');
    unidad.className = 'inp';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Unidad…';
    unidad.appendChild(vacio);
    unidades().forEach(u => {
        const o = document.createElement('option');
        o.value = u; o.textContent = u;
        unidad.appendChild(o);
    });

    const origen = document.createElement('input');
    origen.type = 'text';
    origen.className = 'inp';
    origen.placeholder = '4500123456 o Juan Pérez';

    const guardar = document.createElement('button');
    guardar.type = 'button';
    guardar.className = 'btn btn-principal';
    guardar.textContent = 'Guardar material';

    const campoCantidad = envolver('Cantidad', cantidad);
    const campoUnidad = envolver('Unidad de medida', unidad);
    const campoOrigen = envolver('Origen del material', origen,
        'Folio SAP de mercancía sin cargo, o quién te lo entregó');

    const pintarRes = () => {
        const encontrados = buscarMateriales(sector, inp.value);
        res.innerHTML = '';

        if (encontrados.length === 0) {
            const p = document.createElement('p');
            p.className = 'ayuda';
            p.textContent = inp.value.trim()
                ? `Ningún material de ${sector} coincide.`
                : `No hay materiales de ${sector} en el catálogo.`;
            res.appendChild(p);
            return;
        }

        encontrados.forEach(m => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'mat-opt' + (elegido?.material === m.material ? ' is-sel' : '');
            // Solo "Material y Nombre": nada más, para no ensuciar la lista.
            b.append(...resaltar(m.material, inp.value.trim()));
            b.addEventListener('click', () => {
                elegido = m;
                inp.value = m.material;
                detalle.hidden = false;
                pintarRes();
                cantidad.focus();
            });
            res.appendChild(b);
        });
    };

    inp.addEventListener('input', () => { elegido = null; detalle.hidden = true; pintarRes(); });

    guardar.addEventListener('click', () => {
        if (!elegido) return alToast('Elige un material de la lista.', { estado: 'sin-registrar' });

        if (!cantidad.value || Number(cantidad.value) <= 0) {
            return marcarError(campoCantidad, 'Indica cuánto entregaste.');
        }
        if (!unidad.value) {
            return marcarError(campoUnidad, 'Elige la unidad de medida.');
        }

        onAgregar({
            id: nuevoId('m'),
            material: elegido.material,
            cantidad: cantidad.value,
            unidad: unidad.value,
            origen: origen.value.trim()
        });
        cerrar();
    });

    detalle.append(campoCantidad, campoUnidad, campoOrigen, guardar);

    body.append(busq, detalle);
    caja.append(head, body);
    modal.appendChild(caja);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    soltarEscape = cerrarConEscape(modal, cerrar);

    host.appendChild(modal);
    pintarRes();
    inp.focus();
}
