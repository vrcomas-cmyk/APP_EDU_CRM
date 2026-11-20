/**
 * Filtro por periodo: atajos (Hoy, Esta semana, Este mes, Mes anterior, Todo) y un selector de
 * mes. Es una capa sobre el rango `desde`/`hasta` que cada pantalla ya tiene: elegir un periodo
 * solo escribe ese rango, y los campos de fecha de siempre siguen sirviendo para un rango libre.
 *
 * Los meses van en un `<select>` con su nombre («octubre 2026») y no en un `<input type="month">`:
 * ése se pinta en el orden del idioma del navegador, y las fechas de la app se leen siempre igual.
 */

import { useMemo } from 'react';
import {
    PERIODOS, rangoDePeriodo, periodoActivo, ultimosMeses, rangoDeMesTexto, mesDelRango,
    type ClavePeriodo
} from '../services/periodo';

interface Props {
    desde: string;
    hasta: string;
    /** Recibe el rango completo de una vez: dos cambios seguidos provocarían dos cargas. */
    onCambiar: (desde: string, hasta: string) => void;
    /** Cuántos meses ofrece el selector (por defecto 12). */
    meses?: number;
}

export function FiltroPeriodo({ desde, hasta, onCambiar, meses = 12 }: Props) {
    const activo = periodoActivo(desde, hasta);
    const mesActivo = mesDelRango(desde, hasta);
    const opcionesMes = useMemo(() => ultimosMeses(meses), [meses]);

    const elegir = (clave: ClavePeriodo) => {
        const r = rangoDePeriodo(clave);
        onCambiar(r.desde, r.hasta);
    };

    return (
        <div className="filtro-periodo" role="group" aria-label="Periodo">
            <div className="chips">
                {PERIODOS.map(p => (
                    <button
                        key={p.clave}
                        type="button"
                        className={'chip' + (activo === p.clave ? ' on' : '')}
                        aria-pressed={activo === p.clave}
                        onClick={() => elegir(p.clave)}
                    >
                        {p.etiqueta}
                    </button>
                ))}
            </div>

            <label className="filtro">
                <span className="campo-lbl">Mes</span>
                <select
                    className="inp"
                    value={mesActivo}
                    onChange={(e) => {
                        const r = rangoDeMesTexto(e.target.value);
                        if (r) onCambiar(r.desde, r.hasta);
                    }}
                >
                    <option value="">Elegir mes…</option>
                    {opcionesMes.map(m => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
            </label>
        </div>
    );
}
