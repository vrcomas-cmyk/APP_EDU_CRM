/**
 * Botón que pide confirmación en línea ("¿Descartar? Sí / No") en vez de `window.confirm()`.
 *
 * `confirm()` no se muestra en la app instalada (PWA): ahí el diálogo nunca aparece y la acción
 * se cancela o se ejecuta sin preguntar, según el navegador. La pregunta en línea funciona igual
 * en todas partes y no bloquea la página.
 */

import { useState } from 'react';

interface Props {
    etiqueta: string;
    pregunta: string;
    onConfirmar: () => void;
    clase?: string;
    disabled?: boolean;
}

export function BotonConfirmar({ etiqueta, pregunta, onConfirmar, clase = 'btn-txt', disabled }: Props) {
    const [pidiendo, setPidiendo] = useState(false);

    if (!pidiendo) {
        return (
            <button
                type="button" className={clase} disabled={disabled}
                onClick={(ev) => { ev.stopPropagation(); setPidiendo(true); }}
            >
                {etiqueta}
            </button>
        );
    }

    return (
        <span className="confirmar-inline" role="group" aria-label={pregunta} onClick={(ev) => ev.stopPropagation()}>
            <span className="ayuda">{pregunta}</span>
            <button type="button" className="btn-txt peligro" autoFocus
                    onClick={() => { setPidiendo(false); onConfirmar(); }}>
                Sí
            </button>
            <button type="button" className="btn-txt" onClick={() => setPidiendo(false)}>No</button>
        </span>
    );
}
