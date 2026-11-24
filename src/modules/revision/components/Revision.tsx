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

import { useMemo, useState } from 'react';
import { tieneEquipo, type Avisar, compararEs } from '@core/puente';
import { ChipToggle } from '@shared/components/ChipToggle';
import { ComboFiltro } from '@shared/components/ComboFiltro';
import { plural } from '../services/formato';
import { agruparPendientes, SIN_AGRUPAR, type CriteriosAgrupacion } from '../services/agrupar';
import { useRevision } from '../hooks/useRevision';
import { PestanasFlujo } from './PestanasFlujo';
import { TarjetaPendiente } from './TarjetaPendiente';
import { TarjetaHistorial } from './TarjetaHistorial';
import { SolicitudesEliminacion } from './SolicitudesEliminacion';
import { EstadoVacio } from '@shared/components/EstadoVacio';
import { FiltroPeriodo } from '@shared/components/FiltroPeriodo';
import { CampoFecha } from '@shared/components/CampoFecha';

interface Props {
    onCambio?: () => void;
    avisar?: Avisar;
}

export function Revision({ onCambio, avisar }: Props) {
    const { flujos, flujo, elegirFlujo, pendientes, cerrados, porFlujo, total, enviar, reabrirItem } =
        useRevision({ onCambio, avisar });

    // Vive aquí y no en el hook: es puramente cómo se PINTA la misma cola, no qué hay en ella.
    // Sobrevive a cambiar de pestaña de flujo porque el componente no se desmonta al hacerlo.
    const [criterios, setCriterios] = useState<CriteriosAgrupacion>(SIN_AGRUPAR);
    // Pendientes (lo que falta decidir) o Histórico (lo ya resuelto, con la salida de reabrir).
    const [vista, setVista] = useState<'pendientes' | 'historico'>('pendientes');

    // Filtro por educador — solo tiene sentido con equipo a cargo. Es conveniencia de
    // pantalla: el aislamiento real de qué se puede revisar ya lo da `consultarVisitas()`.
    const [fEducador, setFEducador] = useState('');
    // Periodo: se filtra por el día de la visita. Vive aquí, como el resto de filtros de pantalla.
    const [periodo, setPeriodo] = useState({ desde: '', hasta: '' });
    const enPeriodo = (dia?: string) =>
        (!periodo.desde || (dia || '') >= periodo.desde) && (!periodo.hasta || (dia || '') <= periodo.hasta);
    const educadores = useMemo(
        () => [...new Set(pendientes.map(p => p.educador).filter(Boolean))].sort(compararEs) as string[],
        [pendientes]
    );
    const pendientesFiltrados = useMemo(
        () => pendientes.filter(p => (!fEducador || p.educador === fEducador) && enPeriodo(p.visita.dia)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pendientes, fEducador, periodo]
    );
    const grupos = agruparPendientes(pendientesFiltrados, criterios);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const cerradosFiltrados = useMemo(() => cerrados.filter(c => enPeriodo(c.visita.dia)), [cerrados, periodo]);

    return (
        <div className="vista vista-revision">
            <header className="vista-head">
                <h2>Revisión</h2>
                <p className="eyebrow">
                    {total === 0 ? 'Nada pendiente' : `${plural(total, 'elemento', 'elementos')} por revisar`}
                </p>
            </header>

            {/* Lo que un educador pidió quitar de su evidencia y le toca autorizar a esta persona. */}
            <SolicitudesEliminacion avisar={avisar} />

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

                    <FiltroPeriodo desde={periodo.desde} hasta={periodo.hasta}
                                   onCambiar={(desde, hasta) => setPeriodo({ desde, hasta })} />
                    <div className="filtros">
                        <label className="filtro">
                            <span className="campo-lbl">Desde</span>
                            <CampoFecha className="inp" value={periodo.desde}
                                        onChange={(e) => setPeriodo(p => ({ ...p, desde: e.target.value }))} />
                        </label>
                        <label className="filtro">
                            <span className="campo-lbl">Hasta</span>
                            <CampoFecha className="inp" value={periodo.hasta}
                                        onChange={(e) => setPeriodo(p => ({ ...p, hasta: e.target.value }))} />
                        </label>
                    </div>

                    <div className="seg" role="tablist" aria-label="Pendientes o histórico">
                        <button type="button" role="tab" aria-selected={vista === 'pendientes'}
                                onClick={() => setVista('pendientes')}>
                            Pendientes ({pendientes.length})
                        </button>
                        <button type="button" role="tab" aria-selected={vista === 'historico'}
                                onClick={() => setVista('historico')}>
                            Histórico ({cerradosFiltrados.length})
                        </button>
                    </div>

                    {vista === 'historico' ? (
                        cerradosFiltrados.length === 0 ? (
                            <p className="ayuda">No hay nada resuelto en «{flujo.nombre}» en este periodo.</p>
                        ) : (
                            <div className="revision-lista">
                                {cerradosFiltrados.map(item => (
                                    <TarjetaHistorial
                                        key={`${flujo.clave}:${item.id_ambito}`}
                                        flujo={flujo}
                                        item={item}
                                        onReabrir={motivo => reabrirItem(item, motivo)}
                                    />
                                ))}
                            </div>
                        )
                    ) : (<>
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

                    {tieneEquipo() && pendientes.length > 0 && (
                        <div className="filtros filtros-cal">
                            <ComboFiltro etiqueta="Educador" opciones={educadores} valor={fEducador} onCambiar={setFEducador} />
                        </div>
                    )}

                    {pendientes.length === 0 ? <AlDia nombre={flujo.nombre} /> : pendientesFiltrados.length === 0 ? (
                        <p className="ayuda">Nadie llamado «{fEducador}» tiene pendientes en «{flujo.nombre}».</p>
                    ) : (
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
                                                onEnviar={(r, obs, crit) => enviar(item, r, obs, crit)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    </>)}
                </div>
            )}
        </div>
    );
}

function AlDia({ nombre }: { nombre: string }) {
    return (
        <EstadoVacio titulo="Al día" texto={<>No hay nada pendiente en «{nombre}».</>} />
    );
}

/**
 * Sin permiso en ningún flujo el riel ni siquiera ofrece el módulo, así que esto solo se ve si
 * el perfil cambió con la vista abierta. Es preferible a una pantalla en blanco.
 */
function SinFlujos() {
    return (
        <EstadoVacio titulo="Nada que revisar" texto={<>Tu perfil no tiene flujos de revisión asignados.</>} />
    );
}
