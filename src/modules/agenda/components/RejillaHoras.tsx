/**
 * La rejilla de horas, compartida por Día y Semana.
 *
 * Ambas vistas son la misma cosa con distinto número de columnas, así que comparten
 * componente: duplicarlas garantizaría que un arreglo se aplicara solo a una de las dos.
 */

import { useMemo } from 'react';
import {
    claveHoy, desdeClave, etiquetaDiaLarga, DIAS_ABREV, repartirEnColumnas,
    type CompromisoCalendar
} from '@core/puente';
import { type Ventana, altoDeVentana } from '../services/ventana';
import { TarjetaVisita } from './TarjetaVisita';
import type { Visita } from '@core/tipos';

interface Props {
    claves: string[];
    clase: 'dia' | 'semana';
    ventana: Ventana;
    visitasDe: (clave: string) => Visita[];
    /** Lo que ya está en Google Calendar (juntas, bloqueos) — de solo lectura, no se arrastra. */
    compromisosDe?: (clave: string) => CompromisoCalendar[];
    onPointerDownColumna: (e: React.PointerEvent<HTMLDivElement>, dia: string) => void;
    onPointerDownCuerpo: (e: React.PointerEvent<HTMLElement>, visita: Visita, duracionH: number) => void;
    onPointerDownManija: (e: React.PointerEvent<HTMLElement>, visita: Visita, duracionH: number) => void;
    onAbrir: (id: string) => void;
}

export function RejillaHoras({
    claves, clase, ventana, visitasDe, compromisosDe,
    onPointerDownColumna, onPointerDownCuerpo, onPointerDownManija, onAbrir
}: Props) {
    const hoy = claveHoy();
    const horas = useMemo(
        () => Array.from({ length: altoDeVentana(ventana) }, (_, i) => ventana.desde + i),
        [ventana]
    );

    return (
        <div className={`grid ${clase}`}>
            <div className="grid-head">
                <div />{/* esquina, sobre el eje de horas */}
                {claves.map(clave => {
                    const fecha = desdeClave(clave);
                    return (
                        <div key={clave} className={clave === hoy ? 'is-today' : undefined}>
                            <div className="dow">
                                {clase === 'dia'
                                    ? etiquetaDiaLarga(clave)
                                    : DIAS_ABREV[(fecha.getDay() + 6) % 7] + (clave === hoy ? ' · Hoy' : '')}
                            </div>
                            <div className="dnum">{fecha.getDate()}</div>
                        </div>
                    );
                })}
            </div>

            <div className="axis">
                {horas.map(h => (
                    <div className="t" key={h}>
                        <span>{String(h).padStart(2, '0')}:00</span>
                    </div>
                ))}
            </div>

            {claves.map(clave => (
                <ColumnaDia
                    key={clave}
                    clave={clave}
                    esHoy={clave === hoy}
                    horas={horas}
                    ventana={ventana}
                    visitas={visitasDe(clave)}
                    compromisos={compromisosDe?.(clave) ?? []}
                    clase={clase}
                    onPointerDownColumna={onPointerDownColumna}
                    onPointerDownCuerpo={onPointerDownCuerpo}
                    onPointerDownManija={onPointerDownManija}
                    onAbrir={onAbrir}
                />
            ))}
        </div>
    );
}

interface PropsColumna {
    clave: string;
    esHoy: boolean;
    horas: number[];
    ventana: Ventana;
    visitas: Visita[];
    compromisos: CompromisoCalendar[];
    clase: string;
    onPointerDownColumna: Props['onPointerDownColumna'];
    onPointerDownCuerpo: Props['onPointerDownCuerpo'];
    onPointerDownManija: Props['onPointerDownManija'];
    onAbrir: Props['onAbrir'];
}

function ColumnaDia({
    clave, esHoy, horas, ventana, visitas, compromisos, clase,
    onPointerDownColumna, onPointerDownCuerpo, onPointerDownManija, onAbrir
}: PropsColumna) {
    // Las que se pisan se reparten en columnas para dibujarse lado a lado. El grupo es una
    // CADENA de solapes: si A pisa a B y B pisa a C, las tres comparten ancho.
    const repartidas = useMemo(() => repartirEnColumnas(visitas), [visitas]);

    return (
        <div
            className={'col' + (esHoy ? ' is-today' : '')}
            data-dia={clave}
            onPointerDown={(e) => onPointerDownColumna(e, clave)}
        >
            {horas.map(h => <div className="h" key={h} />)}

            {esHoy && <LineaAhora ventana={ventana} />}

            {/* Antes que las visitas: quedan por debajo (z-index más bajo) y nunca les roban
                el gesto de arrastrar cuando se pisan en la pantalla. */}
            {compromisos.map(c => (
                <BloqueCompromiso key={c.id} compromiso={c} ventana={ventana} />
            ))}

            {repartidas.map(({ visita, columna, columnas }) => (
                <TarjetaVisita
                    key={visita.id}
                    visita={visita}
                    columna={columna}
                    columnas={columnas}
                    ventana={ventana}
                    modo={clase}
                    onPointerDownCuerpo={onPointerDownCuerpo}
                    onPointerDownManija={onPointerDownManija}
                    onAbrir={onAbrir}
                />
            ))}
        </div>
    );
}

/**
 * Lo que ya está en Google Calendar (junta, bloqueo). De solo lectura a propósito: no es una
 * visita, no se arrastra ni se abre en un drawer — clic la lleva a Calendar, que es donde de
 * verdad vive y se edita.
 */
function BloqueCompromiso({ compromiso, ventana }: { compromiso: CompromisoCalendar; ventana: Ventana }) {
    // Todo el día no tiene una hora que posicionar en la rejilla; se deja fuera aquí y ya se
    // ve en el resumen de "Mi día".
    if (compromiso.todoElDia) return null;

    const inicio = new Date(compromiso.inicio);
    const fin = new Date(compromiso.fin);
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;

    const desplazamiento = inicio.getHours() + inicio.getMinutes() / 60 - ventana.desde;
    // Duración real para POSICIONAR, pero nunca tan angosta como para que el bloque desaparezca:
    // una junta de 15 min sigue necesitando alto suficiente para leer la hora y el título.
    const duracionReal = (fin.getTime() - inicio.getTime()) / 3600000;
    const duracion = Math.max(duracionReal, 0.25);
    const compacta = duracionReal < 0.75;

    const hora = `${String(inicio.getHours()).padStart(2, '0')}:${String(inicio.getMinutes()).padStart(2, '0')}`;
    const contenido = compacta ? (
        <span className="ev-client">{hora} · {compromiso.titulo}</span>
    ) : (
        <>
            <span className="ev-time">{hora}</span>
            <span className="ev-client">{compromiso.titulo}</span>
        </>
    );

    const clases = 'ev compromiso-externo' + (compacta ? ' compacta' : '');
    const estilo = {
        '--s': desplazamiento.toFixed(3), '--dur': duracion.toFixed(3), '--col': 0, '--cols': 1
    } as React.CSSProperties;
    const titulo = `${compromiso.titulo} · en Google Calendar`;

    return compromiso.url ? (
        <a
            className={clases}
            style={estilo}
            href={compromiso.url}
            target="_blank"
            rel="noopener noreferrer"
            title={titulo}
        >
            {contenido}
        </a>
    ) : (
        <div className={clases} style={estilo} title={compromiso.titulo}>
            {contenido}
        </div>
    );
}

/**
 * La línea de "ahora". Fuera de la ventana visible NO se dibuja: pegada al borde superior
 * afirmaría que son las 07:00 cuando son las 03:00, y una referencia temporal que miente es
 * peor que no tenerla.
 */
function LineaAhora({ ventana }: { ventana: Ventana }) {
    const ahora = new Date();
    const posicion = ahora.getHours() + ahora.getMinutes() / 60 - ventana.desde;

    if (posicion < 0 || posicion > altoDeVentana(ventana)) return null;

    return (
        <div className="nowline" style={{ '--now': posicion.toFixed(3) } as React.CSSProperties}>
            <span className="now-badge">
                {String(ahora.getHours()).padStart(2, '0')}:{String(ahora.getMinutes()).padStart(2, '0')}
            </span>
        </div>
    );
}
