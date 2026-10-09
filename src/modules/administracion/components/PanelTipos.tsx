/**
 * Qué pide cada tipo de actividad.
 *
 * Esto ES el formulario de captura: la pantalla de actividad no tiene ni una condición escrita
 * a mano, se dibuja recorriendo esta configuración. Por eso un cambio aquí se nota en el
 * teléfono de todos en el siguiente sync.
 */

import { useState } from 'react';
import { CAMPOS_ACTIVIDAD, ETIQUETAS_MODO, modosPermitidos } from '@core/puente';
import type { BorradorCatalogo, ModoCampo, TipoActividad } from '@core/tipos';
import { conCampo, conCampoEnTodos, conReglaCaptura, resumenDeTipo, tipoNuevo } from '../services/borrador';

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

    const aplicarATodos = (campoEtiqueta: string, campoId: string, modo: ModoCampo) => {
        const ok = confirmar(
            `¿Poner "${campoEtiqueta}" en "${ETIQUETAS_MODO[modo]}" para los `
            + `${borrador.tipos_actividad.length} tipos de actividad?`
        );
        if (!ok) return;
        cambiar(b => conCampoEnTodos(b, campoId, modo));
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
                obligatorio impide guardar si queda vacío; uno "obligatorio después" no bloquea
                el guardado y queda como pendiente. Los campos "Material · …" son los de la
                ventana Agregar material.
            </p>

            {/* Reglas globales del origen del material: no dependen del tipo de actividad. */}
            <div className="campo-grupo">
                <span className="campo-lbl">Origen del material: reglas al capturarlo</span>
                <p className="ayuda">
                    Valen siempre que se escriba un origen, sea o no obligatorio para el tipo.
                    Un origen con solo números se trata como folio; cualquier otro, como texto.
                </p>
                <div className="campo-fila">
                    <span className="campo-fila-lbl">Solo números: mínimo de dígitos</span>
                    <input
                        type="number" className="inp mono" min={1} max={50}
                        aria-label="Mínimo de dígitos del origen cuando son solo números"
                        value={borrador.reglas_captura?.origen_min_digitos ?? ''}
                        onChange={e => {
                            const n = Number(e.target.value);
                            cambiar(b => conReglaCaptura(b, 'origen_min_digitos', n));
                        }}
                    />
                </div>
                <div className="campo-fila">
                    <span className="campo-fila-lbl">Con letras: mínimo de caracteres</span>
                    <input
                        type="number" className="inp mono" min={1} max={50}
                        aria-label="Mínimo de caracteres del origen cuando lleva letras"
                        value={borrador.reglas_captura?.origen_min_caracteres ?? ''}
                        onChange={e => {
                            const n = Number(e.target.value);
                            cambiar(b => conReglaCaptura(b, 'origen_min_caracteres', n));
                        }}
                    />
                </div>
            </div>

            {borrador.tipos_actividad.map((t, i) => (
                <FichaTipo
                    // El índice como clave es correcto AQUÍ y no en otras listas: el nombre se
                    // edita —no sirve de identidad— y al borrar se remonta la ficha a propósito.
                    key={i}
                    tipo={t}
                    abierta={abierto === i}
                    onAbrir={(v) => setAbierto(v ? i : null)}
                    onCambiar={(fn) => editarTipo(i, fn)}
                    onAplicarATodos={aplicarATodos}
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
    onAplicarATodos: (campoEtiqueta: string, campoId: string, modo: ModoCampo) => void;
    onBorrar: () => void;
}

function FichaTipo({ tipo, abierta, onAbrir, onCambiar, onAplicarATodos, onBorrar }: FichaProps) {
    // Los campos de la ventana "Agregar material" van aparte: no son del formulario de la
    // actividad, y mezclados con los demás no se encontraba dónde pedir el origen del material.
    const camposActividad = CAMPOS_ACTIVIDAD.filter(c => !c.ambito);
    const camposMaterial = CAMPOS_ACTIVIDAD.filter(c => c.ambito === 'material');
    const sinMateriales = (tipo.campos?.materiales || 'oculto') === 'oculto';

    const fila = (campo: (typeof CAMPOS_ACTIVIDAD)[number]) => {
        const valor = (tipo.campos?.[campo.id] || campo.defecto) as ModoCampo;
        return (
            <div className="campo-fila" key={campo.id}>
                <span className="campo-fila-lbl">{campo.etiqueta}</span>
                <select
                    className="inp"
                    aria-label={`Modo de ${campo.etiqueta}`}
                    value={valor}
                    onChange={e => {
                        const modo = e.target.value as ModoCampo;
                        onCambiar(t => conCampo(t, campo.id, modo));
                    }}
                >
                    {/* Cada campo ofrece solo lo que de verdad puede cumplirse: la evidencia no
                        puede bloquear el guardado porque la foto se sube después. */}
                    {modosPermitidos(campo).map(m => (
                        <option value={m} key={m}>{ETIQUETAS_MODO[m]}</option>
                    ))}
                </select>
                <button
                    type="button" className="btn-txt"
                    title="Poner este mismo modo en todos los tipos de actividad"
                    onClick={() => onAplicarATodos(campo.etiqueta, campo.id, valor)}
                >
                    A todos
                </button>
            </div>
        );
    };

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

                {camposActividad.map(fila)}

                <div className={'campo-grupo' + (sinMateriales ? ' es-atenuado' : '')}>
                    <span className="campo-lbl">Ventana "Agregar material"</span>
                    <p className="ayuda">
                        {sinMateriales
                            ? 'Este tipo no muestra Materiales (arriba), así que estos campos no se usan todavía.'
                            : 'Qué pide la ventana al registrar cada material de este tipo de actividad.'}
                    </p>
                    {camposMaterial.map(fila)}
                </div>
            </div>
        </details>
    );
}
