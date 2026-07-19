/**
 * Los sectores no se escriben: se curan.
 *
 * La lista sale de la hoja de Materiales, que es también de donde salen los materiales que se
 * ofrecen dentro de cada sector. Dejar inventar nombres aquí produciría sectores cuyo buscador
 * de materiales sale siempre vacío, y eso es indiagnosticable desde un pasillo.
 */

import { sectoresDelCatalogo } from '@core/puente';
import type { BorradorCatalogo } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
}

export function PanelSectores({ borrador, cambiar }: Props) {
    const todos = sectoresDelCatalogo();
    const activos = todos.filter(s => !borrador.sectores_ocultos.includes(s)).length;

    return (
        <div className="campo">
            <span className="campo-lbl">Sectores que se ofrecen al agendar</span>

            <p className="ayuda">
                {todos.length
                    ? 'Salen de la hoja de Materiales y por eso no se escriben aquí: un sector '
                      + 'sin materiales detrás mostraría un buscador vacío. Apaga los que no '
                      + 'quieras ofrecer.'
                    : 'El catálogo de materiales no ha cargado todavía. Conéctate para verlo.'}
            </p>

            {todos.length > 0 && (
                <>
                    <p className="sector-cuenta">{activos} de {todos.length} activos</p>

                    <div className="chips">
                        {todos.map(nombre => (
                            <ChipToggle
                                key={nombre}
                                etiqueta={nombre}
                                activo={!borrador.sectores_ocultos.includes(nombre)}
                                onCambiar={(activo) => cambiar(b => ({
                                    ...b,
                                    // Se guarda lo OCULTO, no lo activo: así un sector nuevo en
                                    // Materiales aparece ofrecido sin que nadie lo encienda.
                                    sectores_ocultos: activo
                                        ? b.sectores_ocultos.filter(x => x !== nombre)
                                        : [...b.sectores_ocultos, nombre]
                                }))}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
