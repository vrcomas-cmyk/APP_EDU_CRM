/**
 * Marcador de carga: barras con brillo en lugar de un "Cargando…" en texto. Ocupa el espacio que
 * tendrá el contenido, así la pantalla no salta cuando llegan los datos. El brillo se apaga con
 * `prefers-reduced-motion`.
 */

interface Props {
    /** Cuántas filas dibujar. */
    filas?: number;
    /** Una barra corta arriba, para vistas que arrancan con título. */
    conTitulo?: boolean;
    /** Lo que se anuncia a lectores de pantalla. */
    etiqueta?: string;
}

export function Esqueleto({ filas = 4, conTitulo = false, etiqueta = 'Cargando' }: Props) {
    return (
        <div className="esqueleto" role="status" aria-live="polite" aria-label={etiqueta}>
            {conTitulo && <div className="esqueleto-fila es-titulo" />}
            {Array.from({ length: filas }, (_, i) => <div className="esqueleto-fila" key={i} />)}
        </div>
    );
}
