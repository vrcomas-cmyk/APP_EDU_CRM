/**
 * La vista de móvil.
 *
 * No es la rejilla encogida: es otra forma. Siete columnas con eje de horas en 390px son
 * ilegibles, así que el día se vuelve una lista vertical y la semana se reduce a una tira de
 * puntos — que se lee de un vistazo sin abrir nada.
 */

import { useMemo, useState } from 'react';
import {
    claveDia, claveHoy, desdeClave, diasDeSemana, etiquetaDiaLarga, inicialesDias,
    saludDe, detalleEstado, estadoDe, ESTADOS, inicioDe, sesionActual,
    esVisitaCliente, etiquetaVisita, type CompromisoCalendar
} from '@core/puente';
import { BanderasVisita } from '@shared/components/Indicadores';
import { ResumenCompromiso } from '@shared/components/ResumenCompromiso';
import type { Visita } from '@core/tipos';

/** Más de cuatro puntos no se distinguen; el número deja de leerse como cantidad. */
const MAX_PUNTOS = 4;

interface Props {
    cursor: Date;
    visitasDe: (clave: string) => Visita[];
    /** Lo que ya está en Google Calendar — de solo lectura, se lee, no se agenda desde aquí. */
    compromisosDe?: (clave: string) => CompromisoCalendar[];
    onElegirDia: (fecha: Date) => void;
    onAbrir: (id: string) => void;
}

export function AgendaMovil({ cursor, visitasDe, compromisosDe, onElegirDia, onAbrir }: Props) {
    const clave = claveDia(cursor);
    const hoy = claveHoy();
    const [compromisoAbierto, setCompromisoAbierto] = useState<CompromisoCalendar | null>(null);

    const delDia = useMemo(
        () => [...visitasDe(clave)]
            .sort((a, b) => (inicioDe(a)?.getTime() ?? 0) - (inicioDe(b)?.getTime() ?? 0)),
        [visitasDe, clave]
    );

    const compromisosDia = useMemo(
        () => compromisosDe?.(clave) ?? [],
        [compromisosDe, clave]
    );

    const filas = useMemo(() => [
        ...delDia.map(v => ({ tipo: 'visita' as const, hora: inicioDe(v)?.getTime() ?? 0, visita: v })),
        ...compromisosDia.map(c => ({ tipo: 'compromiso' as const, hora: new Date(c.inicio).getTime(), compromiso: c }))
    ].sort((a, b) => a.hora - b.hora), [delDia, compromisosDia]);

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

                {filas.length === 0 ? (
                    <p className="empty">
                        <strong>{clave === hoy ? 'Día libre' : 'Sin visitas'}</strong>
                        Toca "Nueva visita" para agendar una.
                    </p>
                ) : (
                    <div className="agenda-list">
                        {filas.map(f => f.tipo === 'visita'
                            ? <FilaAgenda visita={f.visita} key={f.visita.id} onAbrir={onAbrir} />
                            : (
                                <FilaCompromiso
                                    compromiso={f.compromiso}
                                    key={f.compromiso.id}
                                    onAbrir={setCompromisoAbierto}
                                />
                            ))}
                    </div>
                )}
            </div>

            {compromisoAbierto && (
                <ResumenCompromiso compromiso={compromisoAbierto} onCerrar={() => setCompromisoAbierto(null)} />
            )}
        </>
    );
}

function horaCorta(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

/** Misma forma de fila que una visita, para que la lista del día se lea de un vistazo. */
function FilaCompromiso({ compromiso, onAbrir }: {
    compromiso: CompromisoCalendar;
    onAbrir: (c: CompromisoCalendar) => void;
}) {
    return (
        <button
            type="button"
            className="arow es-compromiso"
            onClick={() => onAbrir(compromiso)}
        >
            <span className="arow-time">
                {compromiso.todoElDia ? 'Todo el día' : horaCorta(compromiso.inicio)}
            </span>
            <span className="arow-body">
                <span className="arow-client">{compromiso.titulo}</span>
                <span className="arow-hosp">Google Calendar</span>
            </span>
        </button>
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

    // Del equipo, no propia: mismo criterio que la tarjeta del calendario. Sin correo
    // (captura local vieja) cuenta como propia — el lado que no pinta etiqueta de más.
    const yo = (sesionActual()?.correo || '').trim().toLowerCase();
    const dueno = (visita.educador_correo || '').trim().toLowerCase();
    const esDelEquipo = Boolean(dueno && yo && dueno !== yo);

    return (
        <button
            type="button"
            className={`arow st-${salud}`
                + (estado === ESTADOS.EN_PROCESO ? ' es-viva' : '')
                + (esDelEquipo ? ' es-equipo' : '')}
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
                <span className="arow-client">
                    {etiquetaVisita(visita)}
                    {esDelEquipo && (
                        <span className="arow-educador"> · {visita.educador || visita.educador_correo}</span>
                    )}
                </span>
                {esVisitaCliente(visita) && (
                    <span className="arow-hosp">{visita.hospital || 'Sin hospital'}</span>
                )}
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
