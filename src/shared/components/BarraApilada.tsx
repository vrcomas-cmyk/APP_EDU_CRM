/**
 * Barra apilada horizontal: una fila por grupo (educador, cliente…), segmentada por
 * categoría (sector) con la misma paleta categórica que `Dona` — incluida su regla de tope:
 * 6 categorías propias + "Otros", elegidas por total GLOBAL, no por fila. Si cada fila
 * eligiera su propio top-6, el mismo color significaría un sector distinto según a quién se
 * mire, que es exactamente el anti-patrón "el color no sigue a la entidad" de la guía de
 * dataviz — aquí la entidad es el SECTOR, así que su color es fijo en todas las filas.
 *
 * Ancho por barra en valor absoluto (no normalizado a 100%): una fila con más actividad se ve
 * más larga, que es justo la comparación que este tipo de tabla existe para mostrar.
 */

export interface FilaApilada {
    grupo: string;
    categoria: string;
    valor: number;
}

interface Props {
    filas: FilaApilada[];
    tope?: number;
}

const PALETA = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)',
                 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)', 'var(--cat-8)'];

export function BarraApilada({ filas, tope = 6 }: Props) {
    if (filas.length === 0) return <p className="ayuda">Sin datos para esta selección.</p>;

    // Top categorías por total GLOBAL — el mismo criterio para todas las filas.
    const totalPorCategoria = new Map<string, number>();
    for (const f of filas) totalPorCategoria.set(f.categoria, (totalPorCategoria.get(f.categoria) || 0) + f.valor);
    const topCategorias = [...totalPorCategoria.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, tope).map(([c]) => c);
    const colorDe = new Map(topCategorias.map((c, i) => [c, PALETA[i % PALETA.length]]));

    const grupos = new Map<string, Map<string, number>>();
    for (const f of filas) {
        if (!grupos.has(f.grupo)) grupos.set(f.grupo, new Map());
        const cat = colorDe.has(f.categoria) ? f.categoria : 'Otros';
        const m = grupos.get(f.grupo)!;
        m.set(cat, (m.get(cat) || 0) + f.valor);
    }

    const filasOrdenadas = [...grupos.entries()]
        .map(([grupo, porCat]) => ({
            grupo, total: [...porCat.values()].reduce((n, v) => n + v, 0), porCat
        }))
        .sort((a, b) => b.total - a.total);

    const maxTotal = Math.max(...filasOrdenadas.map(f => f.total), 1);
    const categoriasVisibles = [...topCategorias, ...(filas.some(f => !colorDe.has(f.categoria)) ? ['Otros'] : [])];

    return (
        <div className="apilada">
            <ul className="apilada-leyenda">
                {categoriasVisibles.map(c => (
                    <li key={c}>
                        <span className="dona-swatch" style={{ background: c === 'Otros' ? 'var(--cat-otros)' : colorDe.get(c) }} aria-hidden="true" />
                        <span>{c}</span>
                    </li>
                ))}
            </ul>

            <div className="apilada-filas">
                {filasOrdenadas.map(f => (
                    <div className="apilada-fila" key={f.grupo}>
                        <span className="apilada-nombre" title={f.grupo}>{f.grupo}</span>
                        <div className="apilada-barra" style={{ width: `${(f.total / maxTotal) * 100}%` }}>
                            {categoriasVisibles.map(c => {
                                const v = f.porCat.get(c);
                                if (!v) return null;
                                const pct = (v / f.total) * 100;
                                return (
                                    <span
                                        key={c}
                                        className="apilada-seg"
                                        style={{ width: `${pct}%`, background: c === 'Otros' ? 'var(--cat-otros)' : colorDe.get(c) }}
                                        title={`${c}: ${v}`}
                                    />
                                );
                            })}
                        </div>
                        <span className="apilada-total mono">{f.total}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
