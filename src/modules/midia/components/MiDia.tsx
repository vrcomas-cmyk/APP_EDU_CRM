/**
 * Mi día: todo lo que se necesita ver de un vistazo, en una sola ventana.
 *
 * No sustituye al calendario ni al tablero de indicadores — es más rápido que los dos: las
 * visitas de HOY, lo pendiente resumido en tres números (no un dashboard entero) y, para quien
 * tiene equipo, el avance por educador. La pregunta que responde es "¿qué me falta antes de
 * salir?", no "¿cómo vamos este trimestre?".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    consultarVisitas, claveHoy, etiquetaDiaLarga, calcularIndicadores, indicadoresPorEducador,
    tieneEquipo, flujosDisponibles, conteoPendientes,
    listarCompromisos, tieneCheckIn, saludDe, SALUD, detalleEstado,
    type CompromisoCalendar
} from '@core/puente';
import type { Visita } from '@core/tipos';
import { BanderasVisita } from '@shared/components/Indicadores';
import { FilaAgenda } from '@modules/agenda/components/AgendaMovil';
import { useConexionCalendar } from '@modules/agenda/hooks/useConexionCalendar';
import { TablaEducadores } from '@modules/dashboard/components/TablaEducadores';

export function MiDia({ onAbrirVisita }: { onAbrirVisita: (id: string) => void }) {
    const hoy = claveHoy();

    // Sin filtro: como el resto de la app, `consultarVisitas` ya recorta al alcance de quien
    // pregunta (uno mismo, o el equipo si tiene gente a cargo).
    const todas = useMemo(() => consultarVisitas(), []);

    const deHoy = useMemo(
        () => todas
            .filter(v => v.dia === hoy)
            .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || '')),
        [todas, hoy]
    );

    const ind = useMemo(() => calcularIndicadores(todas), [todas]);
    const hayRevision = flujosDisponibles().length > 0;
    const pendRevision = useMemo(() => (hayRevision ? conteoPendientes(todas).total : 0), [todas, hayRevision]);
    const porEducador = useMemo(() => (tieneEquipo() ? indicadoresPorEducador(todas) : []), [todas]);

    /**
     * Lo que de verdad falta, visita por visita — no solo un conteo global. Dos deudas
     * distintas y ambas cuentan como "pendiente":
     *   - check-in sin NINGUNA actividad guardada: se llegó y no se registró nada todavía.
     *   - actividades guardadas pero con evidencia sin subir.
     * `saludDe` ya calcula las dos (ver `js/estado.js`); aquí solo se filtra y se lista.
     */
    const porResolver = useMemo(() => (
        todas
            .filter(v => tieneCheckIn(v)
                && (saludDe(v) === SALUD.SIN_REGISTRAR || saludDe(v) === SALUD.FALTAN_EVIDENCIAS))
            .sort((a, b) => (b.dia || '').localeCompare(a.dia || ''))
    ), [todas]);

    return (
        <div className="vista vista-midia">
            <header className="vista-head">
                <h2>Mi día</h2>
                <p className="eyebrow">{etiquetaDiaLarga(hoy)}</p>
            </header>

            <section className="dash-sec">
                <h4 className="dash-titulo">
                    Hoy · {deHoy.length} visita{deHoy.length === 1 ? '' : 's'}
                </h4>
                {deHoy.length === 0 ? (
                    <p className="ayuda">Sin visitas agendadas para hoy.</p>
                ) : (
                    <div className="agenda-list">
                        {deHoy.map(v => <FilaAgenda visita={v} key={v.id} onAbrir={onAbrirVisita} />)}
                    </div>
                )}
            </section>

            <section className="dash-sec">
                <h4 className="dash-titulo">Pendientes</h4>
                <div className="tiles">
                    <Tile etiqueta="Evidencias" valor={ind.evidencias_pendientes} nota="por subir" />
                    <Tile etiqueta="Actividades" valor={ind.actividades_borrador} nota="sin guardar" />
                    {hayRevision && (
                        <Tile etiqueta="Por revisar" valor={pendRevision} nota="en tu bandeja" />
                    )}
                </div>

                {/* Los números de arriba dicen CUÁNTO falta; esta lista dice DE QUÉ visita,
                    para no tener que abrir una por una a adivinar cuál es. */}
                {porResolver.length > 0 && (
                    <ul className="lista-porresolver">
                        {porResolver.map(v => <FilaPorResolver visita={v} key={v.id} onAbrir={onAbrirVisita} />)}
                    </ul>
                )}
            </section>

            <CompromisosCalendar hoy={hoy} />

            {/* La pregunta gerencial no es "¿cómo va el equipo?" sino "¿quién necesita ayuda?":
                el mismo motivo por el que el tablero desglosa esto por persona en vez de un
                promedio. Ver `Dashboard.tsx`. */}
            {tieneEquipo() && (
                <section className="dash-sec">
                    <h4 className="dash-titulo">Avance por educador</h4>
                    <TablaEducadores filas={porEducador} />
                </section>
            )}
        </div>
    );
}

/**
 * Google Calendar, de ida y vuelta.
 *
 * "De vuelta" vive aquí: lo que ya está en el propio Calendar (juntas, bloqueos) se lista
 * para revisar el día antes de agendar. "De ida" —que las visitas guardadas aparezcan en
 * Calendar— pasa solo, sin botón, desde `calendarSync.ts` al guardar/reagendar/cancelar.
 *
 * El token de acceso vive en memoria (`js/googleCalendar.js`), no en localStorage: se vuelve
 * a pedir cada sesión. Es una app offline-first y Calendar por definición no lo es, así que
 * conectarlo es un extra que se activa cuando hay señal, nunca un requisito para capturar.
 */
function CompromisosCalendar({ hoy }: { hoy: string }) {
    const { conectado, conectar, conectando, error } = useConexionCalendar();
    const [cargando, setCargando] = useState(false);
    const [errorLista, setErrorLista] = useState<string | null>(null);
    const [compromisos, setCompromisos] = useState<CompromisoCalendar[] | null>(null);

    const cargar = useCallback(() => {
        setCargando(true);
        setErrorLista(null);
        const desde = new Date(`${hoy}T00:00:00`);
        const hasta = new Date(`${hoy}T23:59:59`);
        listarCompromisos(desde.toISOString(), hasta.toISOString())
            .then(setCompromisos)
            .catch((err: Error) => setErrorLista(err.message))
            .finally(() => setCargando(false));
    }, [hoy]);

    useEffect(() => { if (conectado) cargar(); }, [conectado, cargar]);

    return (
        <section className="dash-sec">
            <h4 className="dash-titulo">Google Calendar</h4>

            {!conectado ? (
                <>
                    <p className="ayuda">
                        {conectando
                            ? 'Conectando…'
                            : 'Conéctalo para ver aquí tus juntas y otros compromisos de hoy, y para que tus visitas guardadas aparezcan también en tu Calendar.'}
                    </p>
                    <button type="button" className="btn-txt" disabled={conectando} onClick={conectar}>
                        Conectar Google Calendar
                    </button>
                </>
            ) : cargando ? (
                <p className="ayuda">Cargando…</p>
            ) : compromisos && compromisos.length === 0 ? (
                <p className="ayuda">Sin más compromisos en tu Calendar hoy.</p>
            ) : (
                <ul className="lista-compromisos">
                    {compromisos?.map(c => (
                        <li key={c.id}>
                            <span className="mono">
                                {c.todoElDia ? 'Todo el día' : hora12(c.inicio)}
                            </span>
                            <span>{c.titulo}</span>
                        </li>
                    ))}
                </ul>
            )}

            {(error || errorLista) && <p className="aviso">{error || errorLista}</p>}
        </section>
    );
}

function hora12(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/** Una visita con deuda: qué falta (`detalleEstado`) y quién la registró, si hay equipo a cargo. */
function FilaPorResolver({ visita, onAbrir }: { visita: Visita; onAbrir: (id: string) => void }) {
    const salud = saludDe(visita);
    return (
        <li>
            <button
                type="button"
                className={`fila-porresolver st-${salud}`}
                onClick={() => onAbrir(visita.id)}
            >
                <span className="fila-porresolver-txt">
                    <strong>{visita.cliente || 'Sin cliente'}</strong>
                    {tieneEquipo() && visita.educador && <span className="mono"> · {visita.educador}</span>}
                    <span className="ayuda"> · {visita.dia}</span>
                </span>
                <BanderasVisita clase="fila-porresolver-flags" salud={salud} detalle={detalleEstado(visita)} />
            </button>
        </li>
    );
}

function Tile({ etiqueta, valor, nota }: { etiqueta: string; valor: number; nota?: string }) {
    return (
        <div className="tile">
            <span className="tile-lbl">{etiqueta}</span>
            <span className="tile-val">{valor}</span>
            {nota && <span className="tile-nota">{nota}</span>}
        </div>
    );
}
