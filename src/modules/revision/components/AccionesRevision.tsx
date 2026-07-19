/**
 * El veredicto.
 *
 * Revisar es una acción de negocio, no una edición: no se toca ni un dato de lo revisado.
 * Queda una revisión nueva, firmada y fechada, y el elemento sale de la cola.
 */

import { useState } from 'react';
import { RESULTADOS } from '@core/puente';
import type { PendienteRevision, ResultadoRevision } from '@core/tipos';
import { exigeObservaciones } from '../services/formato';

interface Props {
    item: PendienteRevision;
    onEnviar: (resultado: ResultadoRevision, observaciones: string) => string | null;
}

const BOTONES: Array<[ResultadoRevision, string, string]> = [
    [RESULTADOS.APROBADO as ResultadoRevision, '✓ Aprobar', 'btn btn-principal'],
    [RESULTADOS.CORRECCION as ResultadoRevision, '↺ Requiere corrección', 'btn-txt'],
    [RESULTADOS.RECHAZADO as ResultadoRevision, '✕ Rechazar', 'btn-txt peligro']
];

export function AccionesRevision({ item, onEnviar }: Props) {
    const [obs, setObs] = useState('');
    const [aviso, setAviso] = useState('');

    // Cada tarjeta necesita su propio id: hay muchas en la página y un `htmlFor` repetido
    // llevaría el foco siempre al primer campo.
    const idObs = `obs-${item.id_ambito}`;

    const mandar = (resultado: ResultadoRevision) => {
        const error = onEnviar(resultado, obs);

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
                {BOTONES.map(([resultado, etiqueta, clase]) => (
                    <button
                        key={resultado}
                        type="button"
                        className={clase}
                        // Deshabilitarlo escondería el porqué. Se deja pulsable y se explica.
                        aria-disabled={exigeObservaciones(resultado) && !obs.trim() || undefined}
                        onClick={() => mandar(resultado)}
                    >
                        {etiqueta}
                    </button>
                ))}
            </div>

            {/* Aprobar sin escribir nada es válido; rechazar no. Se dice antes de intentarlo. */}
            <p className="ayuda">Rechazar o pedir corrección exige explicar qué hay que arreglar.</p>
        </div>
    );
}
