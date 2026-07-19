/**
 * Las listas simples: orígenes, áreas, unidades y tipos de evidencia.
 *
 * Las cuatro se editan igual, así que hay un solo componente y una tabla de datos. Escribir
 * cuatro paneles casi idénticos es cómo se acaba con uno que valida distinto que los otros.
 */

import { useState } from 'react';
import type { BorradorCatalogo } from '@core/tipos';
import { LISTAS, type ClaveLista } from '../services/borrador';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
}

export function PanelListas({ borrador, cambiar }: Props) {
    return (
        <>
            {LISTAS.map(l => (
                <Lista
                    key={l.clave}
                    etiqueta={l.etiqueta}
                    ayuda={l.ayuda}
                    valores={borrador[l.clave]}
                    onCambiar={(valores) => cambiar(b => ({ ...b, [l.clave]: valores }))}
                />
            ))}
        </>
    );
}

interface ListaProps {
    etiqueta: string;
    ayuda: string;
    valores: string[];
    onCambiar: (valores: string[]) => void;
}

function Lista({ etiqueta, ayuda, valores, onCambiar }: ListaProps) {
    const [nuevo, setNuevo] = useState('');

    const agregar = () => {
        const v = nuevo.trim();
        // Un duplicado no se rechaza con un error: se ignora y se limpia el campo. Ya está en
        // la lista, que es lo que la persona quería.
        if (v && !valores.includes(v)) onCambiar([...valores, v]);
        setNuevo('');
    };

    return (
        <div className="campo">
            <span className="campo-lbl">{etiqueta}</span>
            <p className="ayuda">{ayuda}</p>

            <div className="chips">
                {valores.map((valor, i) => (
                    <span className="chip on admin-chip" key={valor}>
                        {valor}
                        <button
                            type="button"
                            aria-label={`Quitar ${valor}`}
                            onClick={() => onCambiar(valores.filter((_, j) => j !== i))}
                        >
                            ✕
                        </button>
                    </span>
                ))}
            </div>

            <input
                type="text"
                className="inp"
                aria-label={`Agregar a ${etiqueta}`}
                placeholder="Escribe y Enter para agregar…"
                value={nuevo}
                onChange={e => setNuevo(e.target.value)}
                onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    agregar();
                }}
                // Al salir del campo también se agrega: escribir y tocar «Guardar» sin pulsar
                // Enter perdía lo escrito en silencio, que es la peor forma de perderlo.
                onBlur={agregar}
            />
        </div>
    );
}
