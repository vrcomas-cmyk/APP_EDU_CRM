/**
 * Las tres formas de medida del tablero. Comparten renglón porque comparten pregunta:
 * "¿cuánto de esto, comparado con qué?".
 *
 * ── Por qué NO hay barra apilada ─────────────────────────────────────────────────────
 *
 * Los cuatro colores de estado de esta app se separan ΔE 4.2 en deuteranopía en el par
 * rojo/verde. En segmentos pegados, sin separación ni nombre, una parte de los usuarios
 * simplemente no podría leerlos. Con cada estado en su renglón y su nombre escrito, el color
 * solo refuerza lo que el texto ya dice.
 */

import type { ReactNode } from 'react';

export interface Medida {
    nombre: string;
    valor: number;
    /** Tono de la paleta de salud. Sin él, la barra usa la tinta neutra. */
    tono?: string;
    /** Punto hueco: nada ha ocurrido todavía. */
    hueco?: boolean;
}

interface Props {
    medidas: Medida[];
    /** Contra qué se compara. `total` da porcentajes; `max` da magnitud relativa. */
    modo: 'porcentaje' | 'magnitud';
    pie?: string;
    vacio?: ReactNode;
}

export function Medidas({ medidas, modo, pie, vacio }: Props) {
    const suma = medidas.reduce((n, m) => n + m.valor, 0);
    const maximo = Math.max(...medidas.map(m => m.valor), 0);

    // Sin datos, un cero dividido daría NaN%; y una fila de barras vacías no dice nada que el
    // texto no diga mejor.
    if (modo === 'porcentaje' && suma === 0 && vacio) {
        return <div className="medidas">{vacio}</div>;
    }

    const referencia = modo === 'porcentaje' ? (suma || 1) : (maximo || 1);

    return (
        <div className="medidas">
            {medidas.map(m => {
                const proporcion = (m.valor / referencia) * 100;

                return (
                    <div className="medida" key={m.nombre}>
                        <span className="medida-lbl" title={m.nombre}>
                            {m.tono && (
                                <span
                                    className={`dot st-${m.tono}` + (m.hueco ? ' hollow' : '')}
                                    aria-hidden="true"
                                />
                            )}
                            <span>{m.nombre}</span>
                        </span>

                        <span className="medida-barra">
                            <span
                                className={m.tono ? `medida-fill st-${m.tono}` : 'medida-fill es-tinta'}
                                style={{ width: `${proporcion}%` }}
                            />
                        </span>

                        {/* El valor va al final de la barra: leerlo no debe costar un viaje a un eje. */}
                        <span className="medida-val mono">
                            {modo === 'porcentaje'
                                ? `${m.valor} · ${Math.round(proporcion)}%`
                                : redondear(m.valor)}
                        </span>
                    </div>
                );
            })}

            {pie && <p className="ayuda">{pie}</p>}
        </div>
    );
}

export function redondear(n: number): number {
    return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

/**
 * Barras horizontales, una serie, una tinta.
 *
 * Horizontales porque las etiquetas son nombres largos —"GASAS Y APÓSITOS", razones sociales
 * de hospital— y en vertical habría que girarlas, que es la forma más segura de que nadie las
 * lea.
 */
export function Barras({ datos, unidad }: { datos: Array<[string, number]>; unidad: string }) {
    return (
        <Medidas
            modo="magnitud"
            medidas={datos.map(([nombre, valor]) => ({ nombre, valor }))}
            pie={`En ${unidad}. Se muestran los ${datos.length} más altos.`}
        />
    );
}
