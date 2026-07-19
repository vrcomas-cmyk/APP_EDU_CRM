/**
 * La bandeja de revisión.
 *
 * Una pestaña por flujo, y en cada una solo lo que falta por revisar. Quien entra a revisar
 * evidencias no debería tener que buscar cuáles, ni ver las que ya pasaron por sus manos: una
 * bandeja que no se vacía se deja de mirar.
 *
 * Deja de ser un modal y pasa a ser una vista, por el mismo motivo que el tablero: revisar no
 * es una interrupción de dos segundos, es a lo que alguien se sienta durante un rato.
 */

import { useState } from 'react';
import type { Avisar } from '@core/puente';
import { ChipToggle } from '@shared/components/ChipToggle';
import { plural } from '../services/formato';
import { agruparPendientes, SIN_AGRUPAR, type CriteriosAgrupacion } from '../services/agrupar';
import { useRevision } from '../hooks/useRevision';
import { PestanasFlujo } from './PestanasFlujo';
import { TarjetaPendiente } from './TarjetaPendiente';

interface Props {
    onCambio?: () => void;
    avisar?: Avisar;
}

export function Revision({ onCambio, avisar }: Props) {
    const { flujos, flujo, elegirFlujo, pendientes, porFlujo, total, enviar } =
        useRevision({ onCambio, avisar });

    // Vive aquí y no en el hook: es puramente cómo se PINTA la misma cola, no qué hay en ella.
    // Sobrevive a cambiar de pestaña de flujo porque el componente no se desmonta al hacerlo.
    const [criterios, setCriterios] = useState<CriteriosAgrupacion>(SIN_AGRUPAR);
    const grupos = agruparPendientes(pendientes, criterios);

    return (
        <div className="vista vista-revision">
            <header className="vista-head">
                <h2>Revisión</h2>
                <p className="eyebrow">
                    {total === 0 ? 'Nada pendiente' : `${plural(total, 'elemento', 'elementos')} por revisar`}
                </p>
            </header>

            {/* Con un solo flujo las pestañas no eligen nada. */}
            {flujos.length > 1 && (
                <PestanasFlujo
                    flujos={flujos}
                    activo={flujo?.clave ?? null}
                    porFlujo={porFlujo}
                    onElegir={elegirFlujo}
                />
            )}

            {!flujo ? <SinFlujos /> : (
                <div className="panel-body">
                    {flujo.descripcion && <p className="ayuda">{flujo.descripcion}</p>}

                    {pendientes.length > 0 && (
                        <div className="revision-agrupar chips" role="group" aria-label="Agrupar la cola">
                            <ChipToggle
                                etiqueta="Agrupar por educador"
                                activo={criterios.educador}
                                onCambiar={v => setCriterios(c => ({ ...c, educador: v }))}
                            />
                            <ChipToggle
                                etiqueta="Agrupar por semana"
                                activo={criterios.semana}
                                onCambiar={v => setCriterios(c => ({ ...c, semana: v }))}
                            />
                        </div>
                    )}

                    {pendientes.length === 0 ? <AlDia nombre={flujo.nombre} /> : (
                        <div className="revision-grupos">
                            {grupos.map(grupo => (
                                <div key={grupo.clave} className="revision-grupo">
                                    {grupo.etiqueta && (
                                        <p className="revision-grupo-titulo">
                                            {grupo.etiqueta} <span className="tab-badge">{grupo.items.length}</span>
                                        </p>
                                    )}
                                    <div className="revision-lista">
                                        {grupo.items.map(item => (
                                            // La clave lleva el flujo: el mismo elemento puede
                                            // estar en la cola de dos flujos, y sin él React
                                            // reutilizaría la tarjeta —con sus observaciones a
                                            // medio escribir— al cambiar de pestaña.
                                            <TarjetaPendiente
                                                key={`${flujo.clave}:${item.id_ambito}`}
                                                flujo={flujo}
                                                item={item}
                                                onEnviar={(r, obs) => enviar(item, r, obs)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function AlDia({ nombre }: { nombre: string }) {
    return (
        <div className="vacio-grande">
            <p className="vacio-titulo">Al día</p>
            <p className="ayuda">No hay nada pendiente en «{nombre}».</p>
        </div>
    );
}

/**
 * Sin permiso en ningún flujo el riel ni siquiera ofrece el módulo, así que esto solo se ve si
 * el perfil cambió con la vista abierta. Es preferible a una pantalla en blanco.
 */
function SinFlujos() {
    return (
        <div className="vacio-grande">
            <p className="vacio-titulo">Nada que revisar</p>
            <p className="ayuda">Tu perfil no tiene flujos de revisión asignados.</p>
        </div>
    );
}
