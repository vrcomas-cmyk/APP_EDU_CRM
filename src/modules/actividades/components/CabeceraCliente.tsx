/**
 * El cliente de la actividad que se está capturando, siempre a la vista.
 *
 * Subir una actividad lleva un rato —tipo, contacto, materiales, evidencia— y en un formulario
 * largo se pierde el hilo de A QUÉ cliente se le está registrando. Va fuera del área que se
 * desplaza (junto al encabezado de la ventana) y en tamaño grande: el número de cliente y la
 * razón social, con el hospital y el sector debajo.
 */

import { partirCliente } from '@shared/services/cliente';
import type { Visita } from '@core/tipos';

interface Props {
    visita: Visita;
    /** Sector de la actividad, si es una sola. En «Subir actividad» hay varios y no se muestra. */
    sector?: string;
}

export function CabeceraCliente({ visita, sector }: Props) {
    const { numero, nombre } = partirCliente(visita.cliente);
    const detalle = [visita.hospital, sector].filter(Boolean).join(' · ');

    if (!numero && !nombre) return null;

    return (
        <div className="cliente-fijo" role="note" aria-label="Cliente de esta actividad">
            {numero && <span className="cliente-fijo-num">{numero}</span>}
            <span className="cliente-fijo-nombre">{nombre || visita.cliente}</span>
            {detalle && <span className="cliente-fijo-meta">{detalle}</span>}
        </div>
    );
}
