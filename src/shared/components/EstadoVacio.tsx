/**
 * "No hay nada aquí". Una sola forma para todas las pantallas (antes eran tres: `.empty`,
 * `.vacio-grande` y un `<p class="ayuda">` suelto), con la misma jerarquía: título, una línea que
 * explica por qué o qué hacer, y — si aplica — la acción para salir de ahí.
 */

import type { ReactNode } from 'react';

interface Props {
    titulo: string;
    texto?: ReactNode;
    /** Un carácter o emoji corto; decorativo. */
    icono?: string;
    /** Botón o enlace para salir del vacío ("Crear la primera…", "Quitar filtros"). */
    accion?: ReactNode;
}

export function EstadoVacio({ titulo, texto, icono, accion }: Props) {
    return (
        <div className="estado-vacio" role="status">
            {icono && <span className="estado-vacio-icono" aria-hidden="true">{icono}</span>}
            <strong className="estado-vacio-titulo">{titulo}</strong>
            {texto && <p className="estado-vacio-texto">{texto}</p>}
            {accion && <div className="estado-vacio-accion">{accion}</div>}
        </div>
    );
}
