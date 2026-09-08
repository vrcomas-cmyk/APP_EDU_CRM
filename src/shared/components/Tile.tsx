/** Un número con etiqueta, para resúmenes tipo "Pendientes"/"Hoy" — Mi Día y Supervisión
 *  comparten esta misma lectura de un vistazo, así que viven de un solo sitio. */
export function Tile({ etiqueta, valor, nota }: { etiqueta: string; valor: number; nota?: string }) {
    return (
        <div className="tile">
            <span className="tile-lbl">{etiqueta}</span>
            <span className="tile-val">{valor}</span>
            {nota && <span className="tile-nota">{nota}</span>}
        </div>
    );
}
