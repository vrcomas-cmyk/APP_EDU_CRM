/**
 * Cumplimiento por educador.
 *
 * Una TABLA y no barras porque son seis medidas por persona: seis gráficas obligarían a cruzar
 * la vista entre ellas para responder la única pregunta que importa aquí, que es "¿y este cómo
 * va?".
 *
 * La pregunta gerencial no es "¿cómo va el equipo?" sino "¿quién necesita ayuda?", y para eso
 * el promedio no sirve: esconde justo a quien se está quedando atrás.
 */

import { useMemo } from 'react';
import type { IndicadoresEducador } from '@core/tipos';

const COLUMNAS = ['Educador', 'Visitas', 'Realizadas', 'Cumpl.', 'Activ.',
                  'Evid. pend.', 'Reag.', 'Horas'];

export function TablaEducadores({ filas }: { filas: IndicadoresEducador[] }) {
    /**
     * Ordenada por CUMPLIMIENTO ascendente: quien va peor aparece primero. La pregunta
     * gerencial que este componente declara responder es "¿quién necesita ayuda?" — dejar el
     * orden que llegó (alfabético o de descarga) obliga a leer fila por fila para encontrarlo,
     * que es exactamente lo que un promedio ya esconde.
     */
    const ordenadas = useMemo(
        () => [...filas].sort((a, b) => a.cumplimiento - b.cumplimiento),
        [filas]
    );

    return (
        // La tabla desborda en móvil; el scroll vive en su propia caja para que la página
        // no se desplace en horizontal entera.
        <div className="tabla-scroll">
            <table className="tabla">
                <thead>
                    <tr>
                        {COLUMNAS.map((c, i) => (
                            <th key={c} className={i > 0 ? 'num' : undefined}>{c}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {ordenadas.map(e => (
                        <tr key={e.correo || e.nombre}>
                            <td title={e.correo || e.nombre}>{e.nombre}</td>
                            <td className="num mono">{e.visitas}</td>
                            <td className="num mono">{e.realizadas}</td>

                            {/* El color solo refuerza, nunca es la única señal — por eso el
                                número siempre lo acompaña, en esta columna y en las dos de
                                abajo. */}
                            <td className="num mono">
                                <span className={`dot st-${tonoCumplimiento(e.cumplimiento)}`} aria-hidden="true" />
                                <span> {e.cumplimiento}%</span>
                            </td>

                            <td className="num mono">{e.actividades}</td>
                            <td className="num mono">
                                {e.evidencias_pendientes > 0 && (
                                    <span className="dot st-faltan-evidencias" aria-hidden="true" />
                                )}
                                <span> {e.evidencias_pendientes}</span>
                            </td>
                            <td className="num mono">
                                {e.reagendaciones > 0 && <span className="dot st-programada" aria-hidden="true" />}
                                <span> {e.reagendaciones}</span>
                            </td>
                            <td className="num mono">{e.horas}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function tonoCumplimiento(pct: number): string {
    if (pct >= 90) return 'completa';
    if (pct >= 70) return 'faltan-evidencias';
    return 'sin-registrar';
}
