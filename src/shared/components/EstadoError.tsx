/**
 * "No se pudo cargar". Una sola forma para todas las pantallas que piden datos al servidor:
 * un mensaje en lenguaje humano, el detalle técnico aparte (para quien lo necesite reportar) y,
 * si hay cómo, la salida: "Reintentar". Antes cada pantalla pegaba el texto crudo del error
 * detrás de "No se pudo cargar:".
 */

interface Props {
    /** Texto crudo del error; se muestra como detalle, no como el mensaje principal. */
    detalle?: string;
    /** Qué no se pudo cargar, para el mensaje ("los flujos", "el histórico"). */
    queCargaba?: string;
    onReintentar?: () => void;
}

export function EstadoError({ detalle, queCargaba, onReintentar }: Props) {
    return (
        <div className="campo es-error" role="alert">
            <p className="ayuda">
                {queCargaba ? `No pudimos cargar ${queCargaba}.` : 'No pudimos cargar esta información.'}
                {' '}Revisa tu conexión e inténtalo de nuevo.
            </p>
            {detalle && <p className="ayuda estado-error-detalle">Detalle: {detalle}</p>}
            {onReintentar && (
                <button type="button" className="btn-txt" onClick={onReintentar}>Reintentar</button>
            )}
        </div>
    );
}
