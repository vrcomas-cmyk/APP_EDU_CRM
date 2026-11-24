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
import { resultadosDe, criteriosDe } from '@core/puente';
import type { CriterioRevision, FlujoRevision, PendienteRevision, ResultadoFlujo } from '@core/tipos';
import { Icono } from '@shared/components/Icono';

interface Props {
    flujo: FlujoRevision;
    item: PendienteRevision;
    onEnviar: (resultado: string, observaciones: string, criterios?: CriterioRevision[]) => string | null;
}

const CLASES: Record<string, string> = {
    principal: 'btn btn-principal',
    txt: 'btn-txt',
    peligro: 'btn-txt peligro'
};

export function AccionesRevision({ flujo, item, onEnviar }: Props) {
    const [obs, setObs] = useState('');
    const [aviso, setAviso] = useState('');
    // Un doble clic/doble-tap antes de que la tarjeta desaparezca de la cola (el re-render que
    // la saca es asíncrono respecto al clic) llamaba a `onEnviar` dos veces: dos revisiones
    // append-only para el mismo elemento. No corrompía el veredicto vigente (gana la última),
    // pero el educador veía "te revisaron dos veces" sin que hubiera pasado nada raro.
    const [enviando, setEnviando] = useState(false);

    // Qué se mira en este flujo. Cada criterio se marca ✓ (cumple) o ✗ (no cumple); sin marcar
    // no afirma nada. Así el revisor no decide a ojo y el educador ve QUÉ falló.
    const criterios = criteriosDe(flujo);
    const [marcas, setMarcas] = useState<Record<string, boolean | undefined>>({});
    const marcar = (clave: string, ok: boolean) =>
        setMarcas(m => ({ ...m, [clave]: m[clave] === ok ? undefined : ok }));

    const resultados = resultadosDe(flujo);

    // Cada tarjeta necesita su propio id: hay muchas en la página y un `htmlFor` repetido
    // llevaría el foco siempre al primer campo.
    const idObs = `obs-${item.id_ambito}`;

    // Solo se anuncia si TODOS los veredictos que devuelven trabajo lo exigen; con un flujo
    // donde ninguno lo pide, la frase sobra y estorba.
    const algunoExige = resultados.some(r => r.exige_observaciones);

    const mandar = (r: ResultadoFlujo) => {
        if (enviando) return;
        setEnviando(true);

        const error = onEnviar(r.valor, obs, criterios.map(c => ({ ...c, ok: marcas[c.clave] })));

        if (error) {
            setEnviando(false);
            setAviso(error);
            document.getElementById(idObs)?.focus();
            return;
        }
        // No se limpia el campo ni se quita el aviso: al registrarse, el elemento desaparece
        // de la cola y con él este componente entero. `enviando` se queda en `true` a
        // propósito: no hay para qué volver a habilitar botones de algo que ya se fue.
    };

    return (
        <div className="revision-acciones">
            {criterios.length > 0 && (
                <fieldset className="revision-criterios" aria-label="Qué se revisa">
                    <legend className="eyebrow">Qué se revisa</legend>
                    {criterios.map(c => (
                        <div className="revision-criterio" key={c.clave}>
                            <span className="revision-criterio-txt">{c.etiqueta || c.clave}</span>
                            <button type="button" className="btn-txt" aria-pressed={marcas[c.clave] === true}
                                    onClick={() => marcar(c.clave, true)}>
                                {marcas[c.clave] === true ? <><Icono clave="ok" tam={13} /> Cumple</> : 'Cumple'}
                            </button>
                            <button type="button" className="btn-txt peligro" aria-pressed={marcas[c.clave] === false}
                                    onClick={() => marcar(c.clave, false)}>
                                {marcas[c.clave] === false ? <><Icono clave="no" tam={13} /> No cumple</> : 'No cumple'}
                            </button>
                        </div>
                    ))}
                </fieldset>
            )}

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
                        // Deshabilitarlo por falta de observaciones escondería el porqué, así
                        // que ese caso se deja pulsable y se explica abajo. Mientras se envía
                        // SÍ se deshabilita de verdad: ahí no hay nada que explicar, es solo
                        // evitar el doble envío del mismo veredicto.
                        disabled={enviando}
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
