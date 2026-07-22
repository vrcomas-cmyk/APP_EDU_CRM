/**
 * Check-in y check-out: el hecho de haber estado ahí.
 *
 * Es la única parte del drawer que hace trabajo asíncrono (pide el GPS), y por eso es la única
 * con estado de "ocupado". El botón se bloquea mientras tanto: dos check-ins seguidos por
 * doble toque registrarían dos llegadas a la misma visita.
 */

import { useState } from 'react';
import {
    tieneCheckIn, tieneCheckOut, puedeIniciar, iniciarVisita, finalizarVisita,
    permanenciaTexto, duracionTexto, describirUbicacion, precisionDudosa,
    reactivarVisita, minutosDeRetraso, type Resultado, type Avisar
} from '@core/puente';
import type { Visita, Marca } from '@core/tipos';

interface Props {
    visita: Visita;
    avisar: Avisar;
    alTerminar: () => void;
    /** Visita de otra persona: el check-in/out es un hecho físico de quien la capturó, no de
     *  quien la mira — mostrarlo como botón invitaría a marcar la llegada de alguien más. */
    soloLectura?: boolean;
}

export function BloqueCheck({ visita, avisar, alTerminar, soloLectura }: Props) {
    const [ocupado, setOcupado] = useState<string | null>(null);

    async function ejecutar(accion: (id: string) => Promise<Resultado>, textoOcupado: string) {
        setOcupado(textoOcupado);
        const r = await accion(visita.id);
        setOcupado(null);

        if (!r.ok) {
            avisar(r.error || 'No se pudo completar.', { estado: 'sin-registrar' });
            return;
        }

        // La ubicación puede fallar sin que falle el registro: estar en un sótano no debe
        // impedir marcar la llegada. Se avisa de la degradación, no se bloquea.
        if (r.ubicacion?.error) {
            avisar(`Registrado sin ubicación: ${r.ubicacion.error.toLowerCase()}.`,
                { estado: 'programada', ms: 6000 });
        } else if (precisionDudosa(r.ubicacion)) {
            avisar(`Ubicación con poca precisión (±${r.ubicacion?.precision_m} m).`,
                { estado: 'programada' });
        }

        if (r.permanencia_min != null && r.visita) {
            avisar(`Visita finalizada · ${permanenciaTexto(r.visita)} en el cliente.`,
                { estado: 'completa' });
        }

        alTerminar();
    }

    if (!tieneCheckIn(visita)) {
        if (soloLectura) {
            return <div className="check"><p className="ayuda">Todavía no se registra la llegada.</p></div>;
        }

        const listo = puedeIniciar(visita);
        return (
            <div className="check">
                <p className="ayuda">
                    {listo
                        ? 'Al llegar con el cliente, inicia la visita. Se registra la hora y tu ubicación.'
                        : 'Falta el cliente para poder iniciar la visita.'}
                </p>
                <button
                    type="button"
                    className="btn btn-check"
                    disabled={!listo || ocupado !== null}
                    onClick={() => ejecutar(iniciarVisita, 'Iniciando…')}
                >
                    {ocupado ?? '▶ Iniciar visita'}
                </button>
            </div>
        );
    }

    const permanencia = permanenciaTexto(visita);

    return (
        <div className="check">
            <MarcaCheck etiqueta="Llegada" marca={visita.check_in!} />
            <Puntualidad visita={visita} />

            {tieneCheckOut(visita) ? (
                <>
                    <MarcaCheck etiqueta="Salida" marca={visita.check_out!} />
                    {permanencia && (
                        <p className="permanencia mono">
                            Permanencia real {permanencia} · planeada {duracionTexto(visita)}
                        </p>
                    )}
                </>
            ) : soloLectura ? (
                <p className="ayuda">Todavía no se registra la salida.</p>
            ) : (
                <>
                    <button
                        type="button"
                        className="btn btn-check"
                        disabled={ocupado !== null}
                        onClick={() => ejecutar(finalizarVisita, 'Finalizando…')}
                    >
                        {ocupado ?? '■ Finalizar visita'}
                    </button>
                    {/* El educador tiene que poder irse sin haber terminado de escribir. */}
                    <p className="ayuda">
                        Finalizar marca tu salida del cliente. Puedes seguir capturando actividades después.
                    </p>
                </>
            )}
        </div>
    );
}

function MarcaCheck({ etiqueta, marca }: { etiqueta: string; marca: Marca }) {
    const cuando = new Date(marca.momento).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });

    return (
        <div className="marca">
            <span className="marca-lbl">{etiqueta}</span>
            <span className="marca-hora mono">{cuando}</span>
            <span className={'marca-ubi' + ((marca as { error?: string }).error ? ' es-sin' : '')}>
                {describirUbicacion(marca)}
            </span>
        </div>
    );
}

/**
 * Puntual / Impuntual: se CALCULA de llegada contra hora de inicio, con 15 min de gracia —
 * los mismos que usa el flujo de revisión "Justificación de retrasos" para decidir si una
 * visita entra a esa cola. No es un campo nuevo que capturar: es la misma regla, mostrada
 * aquí para que el educador la vea sin esperar a que alguien la revise. La justificación en
 * sí se escribe donde ya se revisa el retraso, no aquí.
 */
function Puntualidad({ visita }: { visita: Visita }) {
    const min = minutosDeRetraso(visita);
    if (min <= 0) return <span className="pill st-completa">Puntual</span>;

    return <span className="pill st-sin-registrar">Impuntual · {min} min tarde</span>;
}

/** Una visita cancelada no se borra: queda en el calendario como registro de que no ocurrió. */
export function AvisoCancelada({ visita, avisar, alTerminar }: Props) {
    return (
        <div className="aviso es-cancelada">
            <p>
                {visita.motivo_cancelacion
                    ? `Visita cancelada: ${visita.motivo_cancelacion}`
                    : 'Visita cancelada.'}
            </p>
            <button
                type="button"
                className="btn-txt"
                onClick={() => {
                    const r = reactivarVisita(visita.id);
                    if (!r.ok) { avisar(r.error || 'No se pudo reactivar.', { estado: 'sin-registrar' }); return; }
                    alTerminar();
                }}
            >
                Reactivar
            </button>
        </div>
    );
}
