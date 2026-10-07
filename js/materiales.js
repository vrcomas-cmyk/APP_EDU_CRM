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
import {
    unidades, buscarMateriales, configuracionCampos, MODOS, reglasCaptura, problemaDeOrigen
} from './catalogos.js';
import { envolver, resaltar, cabeceraModal, marcarError, cerrarConEscape } from './campos.js';

/**
 * @param host      dónde colgar el modal (el drawer, para que quede dentro de su stacking context)
 * @param sector    nombre del sector —o lista de nombres, en "Subir actividad"—; acota el catálogo
 * @param tipo      tipo de la actividad: Administración decide por tipo qué pide el material
 *                  (cantidad, unidad, origen). Sin tipo rigen los defaults.
 * @param onAgregar recibe { id, material, cantidad, unidad, origen }
 */
export function abrirModalMaterial({ host, sector, tipo, onAgregar, alToast = () => {} }) {
    const nombreSector = [].concat(sector ?? []).join(', ');
    const config = configuracionCampos(tipo);
    const visible = (id) => config[id] !== MODOS.OCULTO;
    const obligatorio = (id) => config[id] === MODOS.OBLIGATORIO;
    const rotulo = (texto, id) => (obligatorio(id) ? `${texto} *` : texto);

    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja';

    let soltarEscape = () => {};
    const cerrar = () => { modal.remove(); soltarEscape(); };
    const head = cabeceraModal('Agregar material', nombreSector, cerrar);

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

    const campoCantidad = envolver(rotulo('Cantidad', 'material_cantidad'), cantidad);
    const campoUnidad = envolver(rotulo('Unidad de medida', 'material_unidad'), unidad);
    const reglas = reglasCaptura();
    const campoOrigen = envolver(rotulo('Origen del material', 'material_origen'), origen,
        'Folio SAP de mercancía sin cargo, o quién te lo entregó. '
        + `Si es un folio: al menos ${reglas.origen_min_digitos} dígitos; si es texto: al menos ${reglas.origen_min_caracteres} caracteres.`);

    const pintarRes = () => {
        const encontrados = buscarMateriales(sector, inp.value);
        res.hidden = false;
        res.innerHTML = '';

        if (encontrados.length === 0) {
            const p = document.createElement('p');
            p.className = 'ayuda';
            p.textContent = inp.value.trim()
                ? `Ningún material de ${nombreSector} coincide.`
                : `No hay materiales de ${nombreSector} en el catálogo.`;
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
                // Ya se eligió: la lista se cierra. Volver a pintarla (`pintarRes`) buscaba por
                // el nombre completo y devolvía el elegido más lo que se le parece, así que
                // las sugerencias nunca desaparecían.
                res.innerHTML = '';
                res.hidden = true;
                cantidad.focus();
            });
            res.appendChild(b);
        });
    };

    inp.addEventListener('input', () => { elegido = null; detalle.hidden = true; pintarRes(); });

    guardar.addEventListener('click', () => {
        if (!elegido) return alToast('Elige un material de la lista.', { estado: 'sin-registrar' });

        // Lo que se pide lo decide Administración por tipo de actividad. Una cantidad escrita
        // siempre debe ser válida, sea o no obligatoria: un "-3" no es un dato opcional.
        if (visible('material_cantidad')) {
            const vacia = !cantidad.value;
            if (obligatorio('material_cantidad') && (vacia || Number(cantidad.value) <= 0)) {
                return marcarError(campoCantidad, 'Indica cuánto entregaste.');
            }
            if (!vacia && Number(cantidad.value) <= 0) {
                return marcarError(campoCantidad, 'La cantidad debe ser mayor que cero.');
            }
        }
        if (visible('material_unidad') && obligatorio('material_unidad') && !unidad.value) {
            return marcarError(campoUnidad, 'Elige la unidad de medida.');
        }
        if (visible('material_origen') && obligatorio('material_origen') && !origen.value.trim()) {
            return marcarError(campoOrigen, 'Indica el origen del material.');
        }
        // Aunque el campo sea opcional, lo que se escribe tiene que tener forma de origen: un "1"
        // o un "NA" no es un folio ni un nombre, y después nadie puede rastrear la mercancía.
        if (visible('material_origen')) {
            const problema = problemaDeOrigen(origen.value, reglas);
            if (problema) return marcarError(campoOrigen, problema);
        }

        onAgregar({
            id: nuevoId('m'),
            // Cuándo se capturó (fecha de registro): no es la fecha de la visita ni del documento.
            creado: new Date().toISOString(),
            material: elegido.material,
            // Un campo oculto no se captura: nada de valores que el usuario nunca vio.
            cantidad: visible('material_cantidad') ? cantidad.value : '',
            unidad: visible('material_unidad') ? unidad.value : '',
            origen: visible('material_origen') ? origen.value.trim() : ''
        });
        cerrar();
    });

    // Los ocultos no se pintan; el botón queda siempre, también si no se pide ningún dato.
    if (visible('material_cantidad')) detalle.append(campoCantidad);
    if (visible('material_unidad')) detalle.append(campoUnidad);
    if (visible('material_origen')) detalle.append(campoOrigen);
    detalle.append(guardar);

    body.append(busq, detalle);
    caja.append(head, body);
    modal.appendChild(caja);
    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });

    soltarEscape = cerrarConEscape(modal, cerrar);

    host.appendChild(modal);
    pintarRes();
    inp.focus();
}
