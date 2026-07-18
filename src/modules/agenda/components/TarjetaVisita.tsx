/**
 * Una visita en la rejilla.
 *
 * Se POSICIONA y ESCALA por su duración real —de ahí que `hora_inicio` y `hora_fin` sean
 * campos separados y ninguno se calcule solo—. Lo que se muestra depende de cuánto espacio
 * hay: por debajo de ~45 minutos no cabe más que la hora y el cliente, y forzarlo produce
 * texto cortado a la mitad, que se lee peor que no ponerlo.
 */

import {
    saludDe, detalleEstado, estadoDe, ESTADOS, duracionHoras, duracionTexto, inicioDe,
    tieneCheckOut, hora as formatearHora
} from '@core/puente';
import { BanderasVisita } from '@shared/components/Indicadores';
import type { Ventana } from '../services/ventana';
import type { Visita } from '@core/tipos';

interface Props {
    visita: Visita;
    columna: number;
    columnas: number;
    ventana: Ventana;
    modo: string;
    onPointerDownCuerpo: (e: React.PointerEvent<HTMLElement>, visita: Visita, duracionH: number) => void;
    onPointerDownManija: (e: React.PointerEvent<HTMLElement>, visita: Visita, duracionH: number) => void;
    onAbrir: (id: string) => void;
}

export function TarjetaVisita({
    visita, columna, columnas, ventana, modo,
    onPointerDownCuerpo, onPointerDownManija, onAbrir
}: Props) {
    const salud = saludDe(visita);
    const estado = estadoDe(visita);
    const duracion = duracionHoras(visita);
    const inicio = inicioDe(visita);
    const desplazamiento = inicio
        ? inicio.getHours() + inicio.getMinutes() / 60 - ventana.desde
        : 0;

    /**
     * Una cancelada o ya finalizada no se arrastra: solo se abre.
     *
     * Reagendarlas ya está prohibido por las reglas de negocio, así que ofrecer el gesto sería
     * prometer algo que el guardado va a rechazar — y el usuario culparía a la app, no a la regla.
     */
    const movible = estado !== ESTADOS.CANCELADA && !tieneCheckOut(visita);

    const clases = [
        'ev', `st-${salud}`,
        // Late mientras el educador está dentro: es lo único que está pasando AHORA.
        estado === ESTADOS.EN_PROCESO ? 'es-viva' : '',
        duracion < 0.75 ? 'compacta' : ''
    ].filter(Boolean).join(' ');

    const sectores = visita.sectores || [];

    return (
        <button
            type="button"
            className={clases}
            data-id={visita.id}
            data-estado={estado}
            style={{
                '--s': desplazamiento.toFixed(3),
                '--dur': duracion.toFixed(3),
                '--col': columna,
                '--cols': columnas
            } as React.CSSProperties}
            onPointerDown={(e) => {
                if (!movible) return;
                onPointerDownCuerpo(e, visita, duracion);
            }}
            // Sin gesto de arrastre el clic sigue siendo la única forma de abrirla.
            onClick={(e) => { if (!movible) { e.stopPropagation(); onAbrir(visita.id); } }}
        >
            <span className="ev-time">
                {duracion >= 1
                    ? `${formatearHora(visita.hora_inicio || '')}–${formatearHora(visita.hora_fin || '')} · ${duracionTexto(visita)}`
                    : visita.hora_inicio || ''}
            </span>

            <span className="ev-client">{visita.cliente || 'Sin cliente'}</span>

            {duracion >= 0.75 && (
                <span className="ev-hosp">{visita.hospital || 'Sin hospital'}</span>
            )}

            {duracion >= 1.5 && modo === 'dia' && sectores.length > 0 && (
                <span className="ev-sectores">
                    {sectores.map(s => <span key={s.id}>{s.nombre}</span>)}
                </span>
            )}

            {duracion >= 1 && (
                <BanderasVisita
                    clase="ev-flags"
                    salud={salud}
                    detalle={detalleEstado(visita)}
                    sincronizado={visita.sincronizado}
                />
            )}

            {movible && (
                <div
                    className="ev-resize"
                    aria-hidden="true"
                    onPointerDown={(e) => onPointerDownManija(e, visita, duracion)}
                />
            )}
        </button>
    );
}
