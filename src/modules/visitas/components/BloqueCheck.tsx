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
    reactivarVisita, type Resultado, type Avisar
} from '@core/puente';
import type { Visita, Marca } from '@core/tipos';

interface Props {
    visita: Visita;
    avisar: Avisar;
    alTerminar: () => void;
}

export function BloqueCheck({ visita, avisar, alTerminar }: Props) {
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

            {tieneCheckOut(visita) ? (
                <>
                    <MarcaCheck etiqueta="Salida" marca={visita.check_out!} />
                    {permanencia && (
                        <p className="permanencia mono">
                            Permanencia real {permanencia} · planeada {duracionTexto(visita)}
                        </p>
                    )}
                </>
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
