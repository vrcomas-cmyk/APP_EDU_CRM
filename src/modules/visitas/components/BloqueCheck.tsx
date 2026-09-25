/**
 * Check-in y check-out: el hecho de haber estado ahí.
 *
 * Es la única parte del drawer que hace trabajo asíncrono (pide el GPS), y por eso es la única
 * con estado de "ocupado". El botón se bloquea mientras tanto: dos check-ins seguidos por
 * doble toque registrarían dos llegadas a la misma visita.
 */

import { useMemo, useState } from 'react';
import {
    tieneCheckIn, tieneCheckOut, puedeIniciar, iniciarVisita, finalizarVisita,
    permanenciaTexto, duracionTexto, describirUbicacion, precisionDudosa,
    reactivarVisita, minutosDeRetraso, esVisitaCliente, consultarVisitas, visitaAbiertaDe,
    upsertPendiente, sincronizarPendientes, nuevoId, sesionActual,
    type Resultado, type Avisar
} from '@core/puente';
import type { Visita, Marca } from '@core/tipos';

interface Props {
    visita: Visita;
    avisar: Avisar;
    alTerminar: () => void;
    /** Visita de otra persona: el check-in/out es un hecho físico de quien la capturó, no de
     *  quien la mira — mostrarlo como botón invitaría a marcar la llegada de alguien más. */
    soloLectura?: boolean;
    /** Abre otra visita en este mismo drawer — aquí, para saltar directo a cerrar la que
     *  quedó abierta. Opcional porque `AvisoCancelada` comparte este tipo y no la usa. */
    abrirOtraVisita?: (id: string) => void;
}

export function BloqueCheck({ visita, avisar, alTerminar, soloLectura, abrirOtraVisita }: Props) {
    const [ocupado, setOcupado] = useState<string | null>(null);
    // Se pregunta DESPUÉS de que el checkout ya quedó registrado, nunca antes: un pendiente sin
    // resolver no debe poder bloquear ni retrasar el hecho físico de haber salido.
    const [preguntarPendiente, setPreguntarPendiente] = useState(false);

    // Solo importa mientras no hay check-in todavía: una vez iniciada, esta visita YA ES la
    // abierta, no tiene sentido bloquearla contra sí misma.
    const abierta = useMemo(() => {
        if (tieneCheckIn(visita)) return null;
        try {
            return visitaAbiertaDe(consultarVisitas(), visita.educador_correo, visita.id);
        } catch {
            // Un fallo de permisos/red al consultar el equipo no debe tumbar el drawer — la
            // capa de dominio (iniciarVisita) vuelve a comprobarlo igual con datos locales.
            return null;
        }
    }, [visita]);

    async function ejecutar(accion: (id: string) => Promise<Resultado>, textoOcupado: string, esCheckOut = false) {
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
            const donde = esVisitaCliente(r.visita) ? 'en el cliente' : 'en el bloque';
            avisar(`Visita finalizada · ${permanenciaTexto(r.visita)} ${donde}.`,
                { estado: 'completa' });
        }

        // El checkout ya se registró — de aquí en más, preguntar por un pendiente es la única
        // cosa que falta antes de cerrar. `alTerminar()` se llama al responder, no ahora.
        if (esCheckOut) {
            setPreguntarPendiente(true);
            return;
        }

        alTerminar();
    }

    if (preguntarPendiente) {
        return <PromptPendiente visita={visita} avisar={avisar} onCerrar={() => { setPreguntarPendiente(false); alTerminar(); }} />;
    }

    if (!tieneCheckIn(visita)) {
        if (soloLectura) {
            return <div className="check"><p className="ayuda">Todavía no se registra la llegada.</p></div>;
        }

        const listo = puedeIniciar(visita);
        const cliente = esVisitaCliente(visita);

        if (abierta) {
            const nombre = abierta.cliente || abierta.hospital || 'sin cliente';
            return (
                <div className="check">
                    <p className="ayuda">
                        Tienes una visita sin cerrar en <strong>{nombre}</strong>. Ciérrala antes
                        de iniciar esta — no se puede estar en dos visitas a la vez.
                    </p>
                    {abrirOtraVisita && (
                        <button
                            type="button"
                            className="btn-txt"
                            onClick={() => abrirOtraVisita(abierta.id)}
                        >
                            Ir a cerrarla
                        </button>
                    )}
                </div>
            );
        }

        return (
            <div className="check">
                <p className="ayuda">
                    {listo
                        ? (cliente
                            ? 'Al llegar con el cliente, inicia la visita. Se registra la hora y tu ubicación.'
                            : 'Inicia cuando empieces. Se registra la hora y tu ubicación.')
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
                        onClick={() => ejecutar(finalizarVisita, 'Finalizando…', true)}
                    >
                        {ocupado ?? '■ Finalizar visita'}
                    </button>
                    {/* El educador tiene que poder irse sin haber terminado de escribir. */}
                    <p className="ayuda">
                        {esVisitaCliente(visita)
                            ? 'Finalizar marca tu salida del cliente. Puedes seguir capturando actividades después.'
                            : 'Finalizar marca el fin de este bloque de tiempo.'}
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

/**
 * Se ofrece justo al cerrar la visita — es el momento en que lo que quedó suelto está más
 * fresco, y no exige volver a abrir el registro después para acordarse de anotarlo. Un "No" no
 * es un paso perdido: la mayoría de las visitas no dejan nada pendiente, y preguntar sin
 * insistir es lo que hace que valga la pena seguir preguntando.
 */
function PromptPendiente({ visita, avisar, onCerrar }: { visita: Visita; avisar: Avisar; onCerrar: () => void }) {
    const [escribiendo, setEscribiendo] = useState(false);
    const [descripcion, setDescripcion] = useState('');

    const guardar = () => {
        const texto = descripcion.trim();
        if (!texto) return;

        const sesion = sesionActual();
        upsertPendiente({
            id: nuevoId('pend'),
            id_visita: visita.id,
            cliente: visita.cliente || undefined,
            hospital: visita.hospital || undefined,
            descripcion: texto,
            estado: 'abierto',
            creado_por: sesion?.nombre || '',
            creado_correo: sesion?.correo || '',
            creado_en: new Date().toISOString(),
            sincronizado: false
        });
        avisar('Pendiente guardado.', { estado: 'programada' });
        // Igual que Estrategias: la subida es en segundo plano, no hace esperar a quien ya
        // terminó su visita y quiere seguir a la siguiente.
        sincronizarPendientes().catch(() => {});
        onCerrar();
    };

    if (!escribiendo) {
        return (
            <div className="check">
                <p className="ayuda">¿Tienes algún pendiente de esta visita?</p>
                <div className="admin-fila">
                    <button type="button" className="btn-txt" onClick={onCerrar}>No</button>
                    <button type="button" className="btn btn-check" onClick={() => setEscribiendo(true)}>
                        Sí
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="check">
            <label className="campo">
                <span className="campo-lbl">¿Qué queda pendiente?</span>
                <textarea
                    className="inp notas-area"
                    rows={3}
                    autoFocus
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                />
            </label>
            <div className="admin-fila">
                <button type="button" className="btn-txt" onClick={onCerrar}>Cancelar</button>
                <button
                    type="button"
                    className="btn btn-check"
                    disabled={!descripcion.trim()}
                    onClick={guardar}
                >
                    Guardar pendiente
                </button>
            </div>
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
