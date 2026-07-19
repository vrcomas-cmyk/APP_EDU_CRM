/**
 * Una pestaña por flujo, con su contador.
 *
 * El número va en la pestaña porque es lo que decide por cuál empezar. Sin él hay que entrar
 * a cada una para descubrir cuál tiene trabajo.
 */

import type { FlujoRevision } from '@core/tipos';

interface Props {
    flujos: FlujoRevision[];
    activo: string | null;
    porFlujo: Record<string, number>;
    onElegir: (clave: string) => void;
}

export function PestanasFlujo({ flujos, activo, porFlujo, onElegir }: Props) {
    return (
        <div className="seg revision-tabs" role="group" aria-label="Flujos de revisión">
            {flujos.map(f => {
                const n = porFlujo[f.clave] || 0;

                return (
                    <button
                        key={f.clave}
                        type="button"
                        aria-pressed={f.clave === activo}
                        onClick={() => onElegir(f.clave)}
                    >
                        <span>{f.nombre}</span>
                        {n > 0 && <span className="tab-badge">{n}</span>}
                    </button>
                );
            })}
        </div>
    );
}
