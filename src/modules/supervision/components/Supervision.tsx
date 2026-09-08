/**
 * Supervisión al día: el jefe elige a un subordinado y ve, en vivo, qué está haciendo ahora,
 * qué tiene planeado hoy, qué subió y qué le falta.
 *
 * No es una pestaña de Mi Día ni de Indicadores. Mi Día responde "¿qué me falta antes de
 * salir?" en primera persona; Indicadores es agregado histórico. Esto es tiempo real de UNA
 * tercera persona — una pregunta distinta, con su propio lugar.
 *
 * Todo sale de `consultarVisitas()` + `calcularIndicadores()`, ya usados en Mi Día y el
 * tablero — no hay cálculo nuevo, solo se recorta a "hoy" y a la persona elegida. El detalle
 * de la visita en curso reusa `ExpedienteVisita` (de Revisión) tal cual: ya es de solo lectura
 * y ya trae el árbol completo desde `consultarVisitas()`, sin pedir nada al servidor.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    consultarVisitas, calcularIndicadores, claveHoy, alcance, sesionActual,
    estadoDe, ESTADOS, tieneCheckIn, tieneCheckOut, permanenciaTexto,
    etiquetaVisita, detalleEstado, saludDe
} from '@core/puente';
import type { Visita } from '@core/tipos';
import { ExpedienteVisita } from '@modules/revision/components/ExpedienteVisita';
import { BanderasVisita } from '@shared/components/Indicadores';
import { Tile } from '@shared/components/Tile';

interface Subordinado {
    correo: string;
    nombre: string;
    /** Sin visitas visibles no hay de dónde sacar el nombre — sigue en la lista (nadie
     *  desaparece del alcance), pero con esto en `true` para avisar por qué se ve el correo. */
    sinNombre: boolean;
}

export function Supervision({ version = 0 }: { version?: number }) {
    // Alcance = quién existe (fuente de verdad, jerarquía resuelta por Postgres). Las visitas
    // solo ENRIQUECEN con nombre a quien ya está ahí — no al revés, o un subordinado sin
    // visitas hoy desaparecería justo del lugar donde alguien preguntaría por qué.
    const todas = useMemo(() => consultarVisitas(), [version]);

    const subordinados = useMemo<Subordinado[]>(() => {
        const yo = (sesionActual()?.correo || '').trim().toLowerCase();
        const nombreDe = new Map<string, string>();
        for (const v of todas) {
            const correo = (v.educador_correo || '').trim().toLowerCase();
            if (correo && v.educador && !nombreDe.has(correo)) nombreDe.set(correo, v.educador);
        }
        return alcance()
            .map(c => c.trim().toLowerCase())
            .filter(c => c && c !== yo)
            .map(correo => ({
                correo,
                nombre: nombreDe.get(correo) || correo,
                sinNombre: !nombreDe.has(correo)
            }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [todas]);

    const [elegido, setElegido] = useState<string>('');
    useEffect(() => {
        // Si el elegido salió del alcance (cambio de jerarquía) o no hay ninguno todavía,
        // cae al primero — nunca se queda apuntando a nadie sin decirlo.
        if (subordinados.length === 0) { setElegido(''); return; }
        if (!subordinados.some(s => s.correo === elegido)) setElegido(subordinados[0]!.correo);
    }, [subordinados, elegido]);

    const hoy = claveHoy();
    const deHoy = useMemo(
        () => todas
            .filter(v => (v.educador_correo || '').trim().toLowerCase() === elegido && v.dia === hoy)
            .sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || '')),
        [todas, elegido, hoy]
    );

    const enCurso = useMemo(
        () => deHoy.filter(v => estadoDe(v) === ESTADOS.EN_PROCESO),
        [deHoy]
    );

    const ind = useMemo(() => calcularIndicadores(deHoy), [deHoy]);

    const persona = subordinados.find(s => s.correo === elegido) || null;

    return (
        <div className="vista vista-supervision">
            <header className="vista-head">
                <h2>Supervisión</h2>
                <p className="eyebrow">{claveHoy() === hoy ? 'Hoy' : hoy}</p>
            </header>

            {subordinados.length === 0 ? (
                <p className="ayuda">Todavía no tienes a nadie en tu alcance.</p>
            ) : (
                <>
                    <label className="campo campo-selector">
                        <span className="campo-lbl">Educador</span>
                        <select
                            className="inp"
                            value={elegido}
                            onChange={(e) => setElegido(e.target.value)}
                        >
                            {subordinados.map(s => (
                                <option key={s.correo} value={s.correo}>
                                    {s.sinNombre ? `${s.nombre} (sin visitas registradas)` : s.nombre}
                                </option>
                            ))}
                        </select>
                    </label>

                    {persona && (
                        <>
                            <section className="dash-sec">
                                <h4 className="dash-titulo">Ahora mismo</h4>
                                {enCurso.length === 0 ? (
                                    <p className="ayuda">
                                        {deHoy.some(v => tieneCheckIn(v))
                                            ? `${persona.nombre} no tiene ninguna visita en curso ahora mismo.`
                                            : `${persona.nombre} no ha iniciado ninguna visita hoy todavía.`}
                                    </p>
                                ) : enCurso.map(v => <BloqueEnCurso visita={v} key={v.id} />)}
                            </section>

                            <section className="dash-sec">
                                <h4 className="dash-titulo">
                                    Hoy · {deHoy.length} visita{deHoy.length === 1 ? '' : 's'}
                                </h4>
                                {deHoy.length === 0 ? (
                                    <p className="ayuda">Sin visitas agendadas para hoy.</p>
                                ) : (
                                    <ul className="lista-porresolver">
                                        {deHoy.map(v => <FilaSupervision visita={v} key={v.id} />)}
                                    </ul>
                                )}
                            </section>

                            <section className="dash-sec">
                                <h4 className="dash-titulo">Métricas de hoy</h4>
                                <div className="tiles">
                                    <Tile etiqueta="Horas efectivas" valor={ind.horas_efectivas} />
                                    <Tile etiqueta="Evidencias" valor={ind.evidencias_subidas} nota="subidas" />
                                    <Tile etiqueta="Evidencias" valor={ind.evidencias_pendientes} nota="por subir" />
                                    <Tile etiqueta="Actividades" valor={ind.actividades_borrador} nota="sin guardar" />
                                    <Tile etiqueta="Cumplimiento" valor={ind.cumplimiento} nota="%" />
                                </div>
                            </section>
                        </>
                    )}
                </>
            )}
        </div>
    );
}

/** La visita en curso, con su expediente completo debajo — es el corazón de este módulo: no
 *  solo "está en Hospital X", sino qué llevaba capturado hasta este momento. */
function BloqueEnCurso({ visita }: { visita: Visita }) {
    const permanencia = permanenciaTexto(visita);
    return (
        <div className="expediente-en-curso">
            <p>
                <strong>{visita.cliente || visita.hospital || etiquetaVisita(visita)}</strong>
                {visita.check_in && (
                    <span className="ayuda"> · llegó {visita.check_in.momento
                        ? new Date(visita.check_in.momento).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
                        : ''}
                        {permanencia ? ` · lleva ${permanencia}` : ''}
                    </span>
                )}
            </p>
            <ExpedienteVisita visita={visita} />
        </div>
    );
}

function FilaSupervision({ visita }: { visita: Visita }) {
    const salud = saludDe(visita);
    const estado = estadoDe(visita);
    const etiquetaEstado = estado === ESTADOS.EN_PROCESO
        ? 'En curso'
        : tieneCheckOut(visita)
            ? 'Finalizada'
            : estado === ESTADOS.CANCELADA ? 'Cancelada' : 'Programada';

    return (
        <li>
            <div className={`fila-porresolver st-${salud}`}>
                <span className="fila-porresolver-txt">
                    <strong>{etiquetaVisita(visita)}</strong>
                    <span className="ayuda"> · {visita.hora_inicio || '--:--'} · {etiquetaEstado}</span>
                </span>
                <BanderasVisita clase="fila-porresolver-flags" salud={salud} detalle={detalleEstado(visita)} />
            </div>
        </li>
    );
}
