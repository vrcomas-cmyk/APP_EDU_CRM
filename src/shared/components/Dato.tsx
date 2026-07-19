/**
 * Una etiqueta y su valor.
 *
 * Estaba copiado idéntico en visitas, sectores y actividades, y el módulo de revisión iba a
 * ser la cuarta copia. Es la pieza más pequeña de la app y por eso mismo la que peor tolera
 * divergir: si un día una copia deja de marcar los vacíos, la misma pantalla muestra dos
 * convenciones distintas para «no hay dato» y deja de poder leerse de un vistazo.
 *
 * El vacío se pinta como «—» y NO como una celda en blanco: en blanco no se distingue un dato
 * que falta de uno que nadie pidió.
 */

export function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string }) {
    return (
        <div className="dato">
            <span className="dato-lbl">{etiqueta}</span>
            <span className={'dato-val' + (valor ? '' : ' es-vacio')}>{valor || '—'}</span>
        </div>
    );
}
