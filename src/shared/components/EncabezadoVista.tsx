/** Encabezado común de las vistas: título + descripción a la izquierda, acciones a la derecha. */

import type { ReactNode } from 'react';

interface Props {
    titulo: string;
    descripcion?: ReactNode;
    acciones?: ReactNode;
}

export function EncabezadoVista({ titulo, descripcion, acciones }: Props) {
    return (
        <header className="vista-encabezado">
            <div>
                <h2>{titulo}</h2>
                {descripcion && <p>{descripcion}</p>}
            </div>
            {acciones && <div className="vista-acciones">{acciones}</div>}
        </header>
    );
}
