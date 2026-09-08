/**
 * Editor de temas personalizados.
 *
 * Solo dos colores se editan por tema —papel y tinta—; el resto se deriva (`derivarTema`) y
 * se valida (`problemasDeTema`) antes de poder guardar. Es la misma regla que ya protege el
 * resto de Administración (`useAdmin.guardar` llama a `problemasDe`, que a su vez llama a
 * `problemasDeTema` por cada tema) — aquí además se muestra el motivo EN VIVO, mientras se
 * edita, para no enterarse del contraste roto hasta el intento de guardar.
 */

import { useState } from 'react';
import { derivarTema, problemasDeTema, VARIABLES_DE_TEMA } from '../services/color';
import { temaNuevo } from '../services/borrador';
import type { BorradorCatalogo, TemaPersonalizado } from '@core/tipos';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
    confirmar: (mensaje: string) => boolean;
}

export function PanelTemas({ borrador, cambiar, confirmar }: Props) {
    const [abierto, setAbierto] = useState<number | null>(null);

    const editarTema = (i: number, fn: (t: TemaPersonalizado) => TemaPersonalizado) => {
        cambiar(b => ({ ...b, temas: b.temas.map((t, j) => (j === i ? fn(t) : t)) }));
    };

    const borrarTema = (i: number, t: TemaPersonalizado) => {
        const ok = confirmar(
            `¿Borrar el tema "${t.nombre || 'sin nombre'}"?\n\n`
            + 'Quien lo tenga elegido en su dispositivo vuelve a Claro en su próxima visita.'
        );
        if (!ok) return;
        cambiar(b => ({ ...b, temas: b.temas.filter((_, j) => j !== i) }));
        setAbierto(null);
    };

    return (
        <div className="campo">
            <span className="campo-lbl">Temas de la marca</span>
            <p className="ayuda">
                Un tema nuevo pide dos colores — papel (el fondo) y tinta (el texto y el
                acento) — y calcula el resto solo. No se puede guardar un tema cuyo texto no se
                lea bien sobre su fondo.
            </p>

            {borrador.temas.map((t, i) => (
                <FichaTema
                    key={t.clave}
                    tema={t}
                    abierta={abierto === i}
                    onAbrir={(v) => setAbierto(v ? i : null)}
                    onCambiar={(fn) => editarTema(i, fn)}
                    onBorrar={() => borrarTema(i, t)}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => {
                    cambiar(b => ({ ...b, temas: [...b.temas, temaNuevo()] }));
                    setAbierto(borrador.temas.length);
                }}
            >
                + Nuevo tema
            </button>
        </div>
    );
}

interface FichaProps {
    tema: TemaPersonalizado;
    abierta: boolean;
    onAbrir: (abierta: boolean) => void;
    onCambiar: (fn: (t: TemaPersonalizado) => TemaPersonalizado) => void;
    onBorrar: () => void;
}

function FichaTema({ tema, abierta, onAbrir, onCambiar, onBorrar }: FichaProps) {
    const problemas = problemasDeTema(tema);
    const errores = problemas.filter(p => p.nivel === 'error');
    const avisos = problemas.filter(p => p.nivel === 'aviso');
    const variables = derivarTema(tema);

    return (
        <details
            className="tipo-ficha"
            open={abierta}
            onToggle={e => onAbrir((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="tipo-sum">
                <span className={'tipo-nombre' + (tema.nombre ? '' : ' es-vacio')}>
                    {tema.nombre || 'Tema sin nombre'}
                </span>
                <span className={'sector-cuenta' + (errores.length > 0 ? ' es-error-txt' : '')}>
                    {errores.length > 0 ? `${errores.length} error${errores.length === 1 ? '' : 'es'}` : 'Listo'}
                </span>
            </summary>

            <div className="tipo-cuerpo">
                <div className="admin-fila">
                    <input
                        type="text"
                        className="inp"
                        placeholder="Nombre del tema"
                        aria-label="Nombre del tema"
                        value={tema.nombre}
                        onChange={e => { const nombre = e.target.value; onCambiar(t => ({ ...t, nombre })); }}
                    />
                    <button type="button" className="icon-btn" aria-label={`Borrar ${tema.nombre || 'tema'}`} onClick={onBorrar}>
                        ✕
                    </button>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Modo base</span>
                    <select
                        className="inp"
                        aria-label="Modo base"
                        value={tema.modo}
                        onChange={e => {
                            const modo = e.target.value as TemaPersonalizado['modo'];
                            onCambiar(t => ({ ...t, modo }));
                        }}
                    >
                        <option value="claro">Claro</option>
                        <option value="oscuro">Oscuro</option>
                    </select>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Papel (fondo)</span>
                    <input
                        type="color" className="inp" aria-label="Color de papel"
                        value={tema.paper}
                        onChange={e => { const paper = e.target.value; onCambiar(t => ({ ...t, paper })); }}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Tinta (texto y acento)</span>
                    <input
                        type="color" className="inp" aria-label="Color de tinta"
                        value={tema.ink}
                        onChange={e => { const ink = e.target.value; onCambiar(t => ({ ...t, ink })); }}
                    />
                </div>

                {problemas.length > 0 && (
                    <ul className="tema-problemas">
                        {errores.map((p, i) => <li key={`e${i}`} className="es-error-txt">{p.mensaje}</li>)}
                        {avisos.map((p, i) => <li key={`a${i}`} className="es-aviso-txt">{p.mensaje}</li>)}
                    </ul>
                )}

                <VistaPrevia variables={variables} />
            </div>
        </details>
    );
}

/** Una muestra fija — no repinta la app entera mientras se arrastra el selector de color —
 *  con exactamente lo que un tema puede romper: texto normal, texto secundario, un botón, y
 *  las 4 píldoras de estado (para confirmar que siguen legibles con este papel/tinta). */
function VistaPrevia({ variables }: { variables: Record<(typeof VARIABLES_DE_TEMA)[number], string> }) {
    const estilo = Object.fromEntries(
        VARIABLES_DE_TEMA.map(v => [v, variables[v]])
    ) as React.CSSProperties;

    return (
        <div className="tema-preview" style={estilo}>
            <p className="tema-preview-texto">Así se ve un texto normal.</p>
            <p className="tema-preview-secundario">Y este es texto secundario.</p>
            <button type="button" className="tema-preview-btn">Botón principal</button>
            <div className="tema-preview-pills">
                <span className="pill st-neutra">Programada</span>
                <span className="pill st-sin-registrar">Sin registrar</span>
                <span className="pill st-faltan-evidencias">Falta evidencia</span>
                <span className="pill st-completa">Completa</span>
            </div>
        </div>
    );
}
