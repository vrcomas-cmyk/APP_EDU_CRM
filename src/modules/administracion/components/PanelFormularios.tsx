/**
 * Qué pide cada formulario que no es la actividad: la visita, el sector y la estrategia.
 *
 * Mismo modelo que `PanelTipos` (cada campo declara su modo) pero con UNA configuración por
 * formulario, no una por tipo. Lo que el sistema necesita para funcionar —educador, cliente,
 * fecha, horario— se muestra igual, bloqueado, para que se entienda por qué no se puede tocar.
 */

import { FORMULARIOS, ETIQUETAS_MODO, MODOS, configuracionFormulario, modosDeFormulario } from '@core/puente';
import type { BorradorCatalogo, IdFormulario, ModoCampo } from '@core/tipos';
import { conCampoFormulario } from '../services/borrador';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
}

export function PanelFormularios({ borrador, cambiar }: Props) {
    return (
        <div className="campo">
            <span className="campo-lbl">Qué pide cada formulario</span>
            <p className="ayuda">
                Visita, sector y estrategia. Un campo oculto no se pregunta; uno obligatorio impide
                guardar si queda vacío. Los de la actividad y el material se configuran por tipo,
                en "Tipos y campos".
            </p>

            {(Object.keys(FORMULARIOS) as IdFormulario[]).map(id => (
                <FichaFormulario key={id} id={id} borrador={borrador} cambiar={cambiar} />
            ))}
        </div>
    );
}

function FichaFormulario({ id, borrador, cambiar }: { id: IdFormulario } & Props) {
    const def = FORMULARIOS[id];
    // Lo que se ve es lo guardado en el borrador; los campos que aún no tienen valor caen en
    // su default (la misma resolución que usa la app).
    const actual = { ...configuracionFormulario(id), ...(borrador.formularios?.[id] || {}) };

    const obligatorios = def.campos.filter(c => (actual[c.id] ?? c.defecto) === MODOS.OBLIGATORIO).length;

    return (
        <details className="tipo-ficha">
            <summary className="tipo-sum">
                <span className="tipo-nombre">{def.etiqueta}</span>
                <span className="sector-cuenta">
                    {obligatorios} obligatorio{obligatorios === 1 ? '' : 's'}
                </span>
            </summary>

            <div className="tipo-cuerpo">
                {def.campos.map(campo => {
                    const modos = modosDeFormulario(campo);
                    const valor = campo.fijo ? MODOS.OBLIGATORIO : (actual[campo.id] ?? campo.defecto);

                    return (
                        <div className="campo-fila" key={campo.id}>
                            <span className="campo-fila-lbl">{campo.etiqueta}</span>
                            <select
                                className="inp"
                                aria-label={`Modo de ${campo.etiqueta} (${def.etiqueta})`}
                                value={valor}
                                disabled={campo.fijo}
                                title={campo.fijo ? 'Siempre obligatorio: lo necesita el sistema.' : undefined}
                                onChange={(e) => {
                                    const modo = e.target.value as ModoCampo;
                                    cambiar(b => conCampoFormulario(b, id, campo.id, modo));
                                }}
                            >
                                {modos.map(m => (
                                    <option value={m} key={m}>
                                        {campo.fijo ? 'Siempre obligatorio' : ETIQUETAS_MODO[m]}
                                    </option>
                                ))}
                            </select>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}
