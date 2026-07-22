/**
 * La vista de móvil.
 *
 * No es la rejilla encogida: es otra forma. Siete columnas con eje de horas en 390px son
 * ilegibles, así que el día se vuelve una lista vertical y la semana se reduce a una tira de
 * puntos — que se lee de un vistazo sin abrir nada.
 */

import { useMemo } from 'react';
import {
    claveDia, claveHoy, desdeClave, diasDeSemana, etiquetaDiaLarga, inicialesDias,
    saludDe, detalleEstado, estadoDe, ESTADOS, inicioDe
} from '@core/puente';
import { BanderasVisita } from '@shared/components/Indicadores';
import type { Visita } from '@core/tipos';

/** Más de cuatro puntos no se distinguen; el número deja de leerse como cantidad. */
const MAX_PUNTOS = 4;

interface Props {
    cursor: Date;
    visitasDe: (clave: string) => Visita[];
    onElegirDia: (fecha: Date) => void;
    onAbrir: (id: string) => void;
}

export function AgendaMovil({ cursor, visitasDe, onElegirDia, onAbrir }: Props) {
    const clave = claveDia(cursor);
    const hoy = claveHoy();

    const delDia = useMemo(
        () => [...visitasDe(clave)]
            .sort((a, b) => (inicioDe(a)?.getTime() ?? 0) - (inicioDe(b)?.getTime() ?? 0)),
        [visitasDe, clave]
    );

    return (
        <>
            <TiraSemana cursor={cursor} visitasDe={visitasDe} onElegirDia={onElegirDia} />

            <div>
                <div className={'agenda-day' + (clave === hoy ? ' es-hoy' : '')}>
                    <span className="lbl">{etiquetaDiaLarga(clave)}</span>
                    <span className="cnt">
                        {delDia.length === 1 ? '1 visita' : `${delDia.length} visitas`}
                    </span>
                </div>

                {delDia.length === 0 ? (
                    <p className="empty">
                        <strong>{clave === hoy ? 'Día libre' : 'Sin visitas'}</strong>
                        Toca "Nueva visita" para agendar una.
                    </p>
                ) : (
                    <div className="agenda-list">
                        {delDia.map(v => <FilaAgenda visita={v} key={v.id} onAbrir={onAbrir} />)}
                    </div>
                )}
            </div>
        </>
    );
}

function TiraSemana({ cursor, visitasDe, onElegirDia }: Omit<Props, 'onAbrir'>) {
    const actual = claveDia(cursor);
    const iniciales = inicialesDias();

    return (
        <div className="wkstrip">
            {diasDeSemana(cursor).map(clave => {
                const fecha = desdeClave(clave);
                return (
                    <button
                        type="button"
                        key={clave}
                        className={clave === actual ? 'is-sel' : undefined}
                        onClick={() => onElegirDia(fecha)}
                    >
                        <span className="d">{iniciales[(fecha.getDay() + 6) % 7]}</span>
                        <span className="n">{fecha.getDate()}</span>
                        {/* Los puntos son la carga del día y su estado: la semana se lee sin abrirla. */}
                        <span className="carga">
                            {visitasDe(clave).slice(0, MAX_PUNTOS).map(v => (
                                <i className={`st-${saludDe(v)}`} key={v.id} />
                            ))}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

/** Se reutiliza en `Mi día`: misma fila, misma lectura de un vistazo. */
export function FilaAgenda({ visita, onAbrir }: { visita: Visita; onAbrir: (id: string) => void }) {
    const salud = saludDe(visita);
    const estado = estadoDe(visita);

    return (
        <button
            type="button"
            className={`arow st-${salud}` + (estado === ESTADOS.EN_PROCESO ? ' es-viva' : '')}
            data-id={visita.id}
            data-estado={estado}
            onClick={() => onAbrir(visita.id)}
        >
            <span className="arow-time">
                {visita.hora_inicio || '--:--'}
                <br />
                <span className="end">{visita.hora_fin || ''}</span>
            </span>

            <span className="arow-body">
                <span className="arow-client">{visita.cliente || 'Sin cliente'}</span>
                <span className="arow-hosp">{visita.hospital || 'Sin hospital'}</span>
                <BanderasVisita
                    clase="arow-meta"
                    salud={salud}
                    detalle={detalleEstado(visita)}
                    sincronizado={visita.sincronizado}
                />
            </span>
        </button>
    );
}
