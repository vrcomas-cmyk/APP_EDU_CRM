/**
 * Qué pide cada tipo de actividad.
 *
 * Esto ES el formulario de captura: la pantalla de actividad no tiene ni una condición escrita
 * a mano, se dibuja recorriendo esta configuración. Por eso un cambio aquí se nota en el
 * teléfono de todos en el siguiente sync.
 */

import { useState } from 'react';
import { CAMPOS_ACTIVIDAD, ETIQUETAS_MODO, MODOS } from '@core/puente';
import type { BorradorCatalogo, ModoCampo, TipoActividad } from '@core/tipos';
import { conCampo, resumenDeTipo, tipoNuevo } from '../services/borrador';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
    confirmar: (mensaje: string) => boolean;
}

export function PanelTipos({ borrador, cambiar, confirmar }: Props) {
    // Solo uno abierto a la vez: con ocho campos por tipo y siete tipos, abrir todo de golpe da
    // una pared de 56 selectores en la que no se encuentra nada.
    const [abierto, setAbierto] = useState<number | null>(null);

    const editarTipo = (i: number, fn: (t: TipoActividad) => TipoActividad) => {
        cambiar(b => ({
            ...b,
            tipos_actividad: b.tipos_actividad.map((t, j) => (j === i ? fn(t) : t))
        }));
    };

    const borrarTipo = (i: number, t: TipoActividad) => {
        const ok = confirmar(
            `¿Borrar el tipo "${t.nombre || 'sin nombre'}"?\n\n`
            + 'Las actividades ya registradas con él no se tocan, pero dejará de ofrecerse.'
        );
        if (!ok) return;

        cambiar(b => ({ ...b, tipos_actividad: b.tipos_actividad.filter((_, j) => j !== i) }));
        setAbierto(null);
    };

    return (
        <div className="campo">
            <span className="campo-lbl">Qué pide cada tipo de actividad</span>
            <p className="ayuda">
                El formulario de captura se arma con esto. Un campo oculto no se pregunta; uno
                obligatorio impide guardar la actividad si queda vacío.
            </p>

            {borrador.tipos_actividad.map((t, i) => (
                <FichaTipo
                    // El índice como clave es correcto AQUÍ y no en otras listas: el nombre se
                    // edita —no sirve de identidad— y al borrar se remonta la ficha a propósito.
                    key={i}
                    tipo={t}
                    abierta={abierto === i}
                    onAbrir={(v) => setAbierto(v ? i : null)}
                    onCambiar={(fn) => editarTipo(i, fn)}
                    onBorrar={() => borrarTipo(i, t)}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => {
                    cambiar(b => ({ ...b, tipos_actividad: [...b.tipos_actividad, tipoNuevo()] }));
                    setAbierto(borrador.tipos_actividad.length);
                }}
            >
                + Nuevo tipo de actividad
            </button>
        </div>
    );
}

interface FichaProps {
    tipo: TipoActividad;
    abierta: boolean;
    onAbrir: (abierta: boolean) => void;
    onCambiar: (fn: (t: TipoActividad) => TipoActividad) => void;
    onBorrar: () => void;
}

function FichaTipo({ tipo, abierta, onAbrir, onCambiar, onBorrar }: FichaProps) {
    return (
        <details
            className="tipo-ficha"
            open={abierta}
            onToggle={e => onAbrir((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="tipo-sum">
                <span className={'tipo-nombre' + (tipo.nombre ? '' : ' es-vacio')}>
                    {tipo.nombre || 'Tipo sin nombre'}
                </span>
                <span className="sector-cuenta">{resumenDeTipo(tipo)}</span>
            </summary>

            <div className="tipo-cuerpo">
                <div className="admin-fila">
                    <input
                        type="text"
                        className="inp"
                        placeholder="Nombre del tipo"
                        aria-label="Nombre del tipo de actividad"
                        value={tipo.nombre}
                        onChange={e => {
                            const nombre = e.target.value;
                            onCambiar(t => ({ ...t, nombre }));
                        }}
                    />
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Borrar ${tipo.nombre || 'tipo'}`}
                        onClick={onBorrar}
                    >
                        ✕
                    </button>
                </div>

                {CAMPOS_ACTIVIDAD.map(campo => (
                    <div className="campo-fila" key={campo.id}>
                        <span className="campo-fila-lbl">{campo.etiqueta}</span>
                        <select
                            className="inp"
                            aria-label={`Modo de ${campo.etiqueta}`}
                            value={tipo.campos?.[campo.id] || campo.defecto}
                            onChange={e => {
                                const modo = e.target.value as ModoCampo;
                                onCambiar(t => conCampo(t, campo.id, modo));
                            }}
                        >
                            {Object.values(MODOS).map(m => (
                                <option value={m} key={m}>{ETIQUETAS_MODO[m]}</option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
        </details>
    );
}
