/**
 * Gráfica de dona: identidad de categoría (qué sector, qué tipo de actividad), no magnitud
 * en el tiempo — para eso está `Barras`. Es la única gráfica de esta app con color categórico;
 * en todo lo demás el color se reserva al ESTADO (`--st-*`), nunca a "categoría" — ver la nota
 * en `style.css`.
 *
 * Reglas que sigue (guía de dataviz):
 *  - Máximo 6 rebanadas + "Otros": pasado ahí, categorías vecinas se confunden de un vistazo,
 *    y una novena categoría no tiene tono validado que ponerle.
 *  - La leyenda SIEMPRE está — es el canal de identidad confiable; nunca solo el color— y
 *    hace de "vista de tabla": nombre, valor y % en texto (nunca el texto en el color de la
 *    serie, eso es ilegible para el amarillo/aqua sobre superficie clara).
 *  - Separación entre rebanadas con un hueco angular, no un borde dibujado.
 */

export interface RebanadaDona {
    nombre: string;
    valor: number;
}

interface Props {
    datos: RebanadaDona[];
    /** Cuántas rebanadas propias como máximo; el resto se funde en "Otros". */
    tope?: number;
    tam?: number;
}

const PALETA = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)',
                 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)'];

function polar(cx: number, cy: number, r: number, angGrados: number) {
    const rad = ((angGrados - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** Arco de dona (anillo), de `desde` a `hasta` grados, con un hueco fijo en cada extremo. */
function trazoArco(cx: number, cy: number, rExt: number, rInt: number, desde: number, hasta: number) {
    const grande = hasta - desde > 180 ? 1 : 0;
    const a = polar(cx, cy, rExt, desde);
    const b = polar(cx, cy, rExt, hasta);
    const c = polar(cx, cy, rInt, hasta);
    const d = polar(cx, cy, rInt, desde);
    return [
        `M ${a.x} ${a.y}`,
        `A ${rExt} ${rExt} 0 ${grande} 1 ${b.x} ${b.y}`,
        `L ${c.x} ${c.y}`,
        `A ${rInt} ${rInt} 0 ${grande} 0 ${d.x} ${d.y}`,
        'Z'
    ].join(' ');
}

export function Dona({ datos, tope = 6, tam = 160 }: Props) {
    const ordenados = [...datos].sort((a, b) => b.valor - a.valor);
    const top = ordenados.slice(0, tope);
    const resto = ordenados.slice(tope).reduce((n, d) => n + d.valor, 0);
    const rebanadas = resto > 0 ? [...top, { nombre: 'Otros', valor: resto }] : top;

    const total = rebanadas.reduce((n, d) => n + d.valor, 0);

    if (total === 0) {
        return <p className="ayuda">Sin datos para esta selección.</p>;
    }

    const cx = tam / 2, cy = tam / 2;
    const rExt = tam / 2 - 4, rInt = rExt * 0.6;
    const HUECO = 1.4; // grados de separación angular entre rebanadas — el "surface gap" del anillo

    let acumulado = 0;
    const arcos = rebanadas.map((r, i) => {
        const proporcion = r.valor / total;
        const desde = acumulado * 360 + (proporcion > 0 ? HUECO / 2 : 0);
        acumulado += proporcion;
        const hasta = acumulado * 360 - (proporcion > 0 ? HUECO / 2 : 0);
        const color = r.nombre === 'Otros' ? 'var(--cat-otros)' : PALETA[i % PALETA.length];
        return { ...r, proporcion, color, d: trazoArco(cx, cy, rExt, rInt, Math.max(desde, 0), Math.max(hasta, desde)) };
    });

    return (
        <div className="dona-wrap">
            <svg
                className="dona-svg" width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`}
                role="img" aria-label={`Reparto: ${rebanadas.map(r => `${r.nombre} ${Math.round(r.valor / total * 100)}%`).join(', ')}`}
            >
                {arcos.map(a => (
                    a.proporcion > 0 ? <path key={a.nombre} d={a.d} fill={a.color} /> : null
                ))}
                <text x={cx} y={cy - 4} textAnchor="middle" className="dona-total-n">{total}</text>
                <text x={cx} y={cy + 14} textAnchor="middle" className="dona-total-lbl">total</text>
            </svg>

            {/* La leyenda es la vista de tabla: nombre, valor y % en texto — nunca el color solo. */}
            <ul className="dona-leyenda">
                {arcos.map(a => (
                    <li className="dona-item" key={a.nombre}>
                        <span className="dona-swatch" style={{ background: a.color }} aria-hidden="true" />
                        <span className="dona-nombre" title={a.nombre}>{a.nombre}</span>
                        <span className="dona-valor mono">{a.valor} · {Math.round(a.proporcion * 100)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
