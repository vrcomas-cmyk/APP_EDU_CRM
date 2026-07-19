/**
 * Los filtros del tablero.
 *
 * Van en UNA fila arriba de todo y afectan a cada número de la pantalla. Repetir un filtro por
 * gráfica dejaría dos cifras contradictorias visibles al mismo tiempo, y no habría forma de
 * saber cuál creer.
 */

import { useMemo } from 'react';
import { consultarVisitas, opcionesDeFiltro, etiquetaEstado, tieneEquipo, type Filtro } from '@core/puente';
import type { Visita } from '@core/tipos';

interface Props {
    filtro: Filtro;
    visitas: Visita[];
    onCambiar: (clave: keyof Filtro, valor: string) => void;
    onLimpiar: () => void;
}

export function BarraFiltros({ filtro, visitas, onCambiar, onLimpiar }: Props) {
    /**
     * Las opciones salen de TODO lo visible, no de lo ya filtrado.
     *
     * Si salieran del resultado, al elegir un hospital ese hospital sería la única opción de su
     * propia lista — y no habría forma de soltarlo salvo recargar.
     */
    const ops = useMemo(() => opcionesDeFiltro(consultarVisitas()), []);

    const activos = Object.values(filtro).filter(Boolean).length;

    return (
        <div className="filtros">
            {/* El filtro por educador solo tiene sentido para quien ve a más de una persona. */}
            {tieneEquipo() && (
                <Select etiqueta="Educador" clave="educador" opciones={ops.educadores}
                        filtro={filtro} onCambiar={onCambiar} />
            )}

            <Select etiqueta="Cliente" clave="cliente" opciones={ops.clientes}
                    filtro={filtro} onCambiar={onCambiar} />
            <Select etiqueta="Hospital" clave="hospital" opciones={ops.hospitales}
                    filtro={filtro} onCambiar={onCambiar} />
            <Select etiqueta="Sector" clave="sector" opciones={ops.sectores}
                    filtro={filtro} onCambiar={onCambiar} />
            <Select etiqueta="Tipo de actividad" clave="tipo_actividad" opciones={ops.tipos}
                    filtro={filtro} onCambiar={onCambiar} />
            <Select etiqueta="Estado" clave="estado" opciones={ops.estados}
                    formato={etiquetaEstado} filtro={filtro} onCambiar={onCambiar} />

            <Fecha etiqueta="Desde" clave="desde" filtro={filtro} onCambiar={onCambiar} />
            <Fecha etiqueta="Hasta" clave="hasta" filtro={filtro} onCambiar={onCambiar} />

            <div className="filtros-pie">
                <span className="sector-cuenta">
                    {visitas.length} visita{visitas.length === 1 ? '' : 's'} en el resultado
                </span>

                {activos > 0 && (
                    <button type="button" className="btn-txt" onClick={onLimpiar}>
                        Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                    </button>
                )}
            </div>
        </div>
    );
}

function Select({ etiqueta, clave, opciones, filtro, onCambiar, formato = (x: string) => x }: {
    etiqueta: string;
    clave: keyof Filtro;
    opciones: string[];
    filtro: Filtro;
    onCambiar: Props['onCambiar'];
    formato?: (v: string) => string;
}) {
    return (
        <label className="filtro">
            <span className="campo-lbl">{etiqueta}</span>
            <select
                className="inp"
                value={filtro[clave] || ''}
                onChange={(e) => onCambiar(clave, e.target.value)}
            >
                <option value="">Todos</option>
                {opciones.map(o => <option key={o} value={o}>{formato(o)}</option>)}
            </select>
        </label>
    );
}

function Fecha({ etiqueta, clave, filtro, onCambiar }: {
    etiqueta: string;
    clave: keyof Filtro;
    filtro: Filtro;
    onCambiar: Props['onCambiar'];
}) {
    return (
        <label className="filtro">
            <span className="campo-lbl">{etiqueta}</span>
            <input
                type="date" className="inp"
                value={filtro[clave] || ''}
                onChange={(e) => onCambiar(clave, e.target.value)}
            />
        </label>
    );
}
