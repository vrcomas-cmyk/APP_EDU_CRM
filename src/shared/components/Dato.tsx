/**
 * Una etiqueta y su valor.
 *
 * Estaba copiado idéntico en visitas, sectores y actividades, y el módulo de revisión iba a
 * ser la cuarta copia. Es la pieza más pequeña de la app y por eso mismo la que peor tolera
 * divergir: si un día una copia deja de marcar los vacíos, la misma pantalla muestra dos
 * convenciones distintas para «no hay dato» y deja de poder leerse de un vistazo.
 *
 * El vacío tiene DOS caras:
 *   - `undefined`/`null`/`''` → «no hay dato» se pinta como «—» plano, sin énfasis.
 *   - `cargando` (segundo parámetro opcional) → el dato todavía no llegó del espejo; se
 *     pinta el «—» con clase `es-cargando` (más tenue) para que un lector del dashboard
 *     distinga el nodo vacío del nodo que aún debiería llenarse. Confundirlos es el mismo
 *     error de UI que ya corregimos en el badge de la Navegación: cero NO significa
 *     "todavía no sé".
 */
export function Dato(
    { etiqueta, valor, cargando = false }: { etiqueta: string; valor?: string | null; cargando?: boolean }
) {
    const vacio = !valor;
    const clase = vacio ? (cargando ? 'es-cargando' : 'es-vacio') : '';
    return (
        <div className={'dato'}>
            <span className="dato-lbl">{etiqueta}</span>
            <span className={'dato-val ' + clase}>{vacio ? '—' : valor}</span>
        </div>
    );
}
