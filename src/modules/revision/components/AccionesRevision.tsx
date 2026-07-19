/**
 * El veredicto.
 *
 * Revisar es una acción de negocio, no una edición: no se toca ni un dato de lo revisado.
 * Queda una revisión nueva, firmada y fechada, y el elemento sale de la cola —o vuelve al
 * educador, si el veredicto elegido no cierra—.
 *
 * Los botones salen del FLUJO, no de una lista escrita aquí. Un flujo de calidad puede
 * ofrecer «Efectiva / Parcial / No efectiva» y uno de evidencias «Aprobar / Rechazar», sin
 * que este componente sepa que existe ninguno de los dos.
 */

import { useState } from 'react';
import { resultadosDe } from '@core/puente';
import type { FlujoRevision, PendienteRevision, ResultadoFlujo } from '@core/tipos';

interface Props {
    flujo: FlujoRevision;
    item: PendienteRevision;
    onEnviar: (resultado: string, observaciones: string) => string | null;
}

const CLASES: Record<string, string> = {
    principal: 'btn btn-principal',
    txt: 'btn-txt',
    peligro: 'btn-txt peligro'
};

export function AccionesRevision({ flujo, item, onEnviar }: Props) {
    const [obs, setObs] = useState('');
    const [aviso, setAviso] = useState('');

    const resultados = resultadosDe(flujo);

    // Cada tarjeta necesita su propio id: hay muchas en la página y un `htmlFor` repetido
    // llevaría el foco siempre al primer campo.
    const idObs = `obs-${item.id_ambito}`;

    // Solo se anuncia si TODOS los veredictos que devuelven trabajo lo exigen; con un flujo
    // donde ninguno lo pide, la frase sobra y estorba.
    const algunoExige = resultados.some(r => r.exige_observaciones);

    const mandar = (r: ResultadoFlujo) => {
        const error = onEnviar(r.valor, obs);

        if (error) {
            setAviso(error);
            document.getElementById(idObs)?.focus();
            return;
        }
        // No se limpia el campo ni se quita el aviso: al registrarse, el elemento desaparece
        // de la cola y con él este componente entero.
    };

    return (
        <div className="revision-acciones">
            <label className="sr-only" htmlFor={idObs}>
                Observaciones para {item.titulo}
            </label>
            <textarea
                id={idObs}
                className="inp hilo-area"
                rows={2}
                placeholder="Observaciones…"
                value={obs}
                onChange={e => { setObs(e.target.value); if (aviso) setAviso(''); }}
            />

            {aviso && <span className="pista" role="alert">{aviso}</span>}

            <div className="revision-botones">
                {resultados.map(r => (
                    <button
                        key={r.valor}
                        type="button"
                        className={CLASES[r.estilo || 'txt'] || 'btn-txt'}
                        // Deshabilitarlo escondería el porqué. Se deja pulsable y se explica.
                        aria-disabled={(r.exige_observaciones && !obs.trim()) || undefined}
                        onClick={() => mandar(r)}
                    >
                        {r.accion}
                    </button>
                ))}
            </div>

            {algunoExige && (
                <p className="ayuda">
                    {resultados.filter(r => r.exige_observaciones).map(r => r.etiqueta).join(' o ')}
                    {' '}exige explicar qué hay que arreglar.
                </p>
            )}
        </div>
    );
}
