/**
 * Vista de mes.
 *
 * Tira el eje de horas a propósito: a esta escala la pregunta ya no es "¿a qué hora?" sino
 * "¿dónde hay hueco?". Conservar la rejilla obligaría a celdas de 30 píxeles donde no cabe
 * ni la hora.
 */

import { useMemo } from 'react';
import {
    claveHoy, desdeClave, diasDeCuadriculaMes, DIAS_ABREV, saludDe, inicioDe, sesionActual
} from '@core/puente';
import { PuntoSalud } from '@shared/components/Indicadores';
import type { Visita } from '@core/tipos';

/** Más de tres líneas no caben. Una celda que intenta mostrarlo todo no muestra nada. */
const MAX_POR_CELDA = 3;

interface Props {
    cursor: Date;
    visitasDe: (clave: string) => Visita[];
    onElegirDia: (dia: string) => void;
}

export function VistaMes({ cursor, visitasDe, onElegirDia }: Props) {
    const hoy = claveHoy();
    const mesActual = cursor.getMonth();
    const dias = useMemo(() => diasDeCuadriculaMes(cursor), [cursor]);

    return (
        <div className="mes">
            {DIAS_ABREV.map((d, i) => (
                <div className={'mes-h' + (i >= 5 ? ' finde' : '')} key={d}>{d}</div>
            ))}

            {dias.map(clave => {
                const fecha = desdeClave(clave);
                const otroMes = fecha.getMonth() !== mesActual;
                const finde = fecha.getDay() === 0 || fecha.getDay() === 6;

                const delDia = [...visitasDe(clave)]
                    .sort((a, b) => (inicioDe(a)?.getTime() ?? 0) - (inicioDe(b)?.getTime() ?? 0));

                const clases = [
                    'mes-cell',
                    otroMes ? 'otro-mes' : (finde ? 'finde' : ''),
                    clave === hoy ? 'is-today' : ''
                ].filter(Boolean).join(' ');

                return (
                    <button type="button" className={clases} key={clave} onClick={() => onElegirDia(clave)}>
                        <span className="mes-n">{fecha.getDate()}</span>

                        {delDia.slice(0, MAX_POR_CELDA).map(v => (
                            <LineaMes visita={v} key={v.id} />
                        ))}

                        {delDia.length > MAX_POR_CELDA && (
                            <span className="mes-more">+{delDia.length - MAX_POR_CELDA} más</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function LineaMes({ visita }: { visita: Visita }) {
    const salud = saludDe(visita);

    // Del equipo, no propia: mismo criterio que la tarjeta del calendario y la agenda móvil.
    // La celda de Mes es demasiado angosta para el nombre completo, así que aquí solo se
    // distingue con la clase (fondo hundido, igual que en Día/Semana) y el título completo
    // en el `title` — no hay espacio para más sin que la cuadrícula deje de leerse.
    const yo = (sesionActual()?.correo || '').trim().toLowerCase();
    const dueno = (visita.educador_correo || '').trim().toLowerCase();
    const esDelEquipo = Boolean(dueno && yo && dueno !== yo);

    const titulo = esDelEquipo
        ? `${visita.hora_inicio || ''} · ${visita.cliente || 'Sin cliente'} · ${visita.educador || visita.educador_correo}`
        : `${visita.hora_inicio || ''} · ${visita.cliente || 'Sin cliente'}`;

    return (
        <span className={`mes-ev st-${salud}` + (esDelEquipo ? ' es-equipo' : '')} title={titulo}>
            <PuntoSalud salud={salud} />
            <span className="t">{visita.hora_inicio || ''}</span>
            <span className="c">{visita.cliente || 'Sin cliente'}</span>
        </span>
    );
}
