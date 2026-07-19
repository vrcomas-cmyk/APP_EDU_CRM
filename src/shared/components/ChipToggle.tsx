/**
 * Un chip que se enciende y se apaga.
 *
 * Lleva `aria-pressed` y no `checked`: es un botón con estado, no una casilla dentro de un
 * formulario. Para quien usa lector de pantalla la diferencia es que se anuncia como
 * «alternado», que es justo lo que hace.
 */

interface Props {
    etiqueta: string;
    activo: boolean;
    onCambiar: (activo: boolean) => void;
}

export function ChipToggle({ etiqueta, activo, onCambiar }: Props) {
    return (
        <button
            type="button"
            className={'chip' + (activo ? ' on' : '')}
            aria-pressed={activo}
            onClick={() => onCambiar(!activo)}
        >
            {etiqueta}
        </button>
    );
}
