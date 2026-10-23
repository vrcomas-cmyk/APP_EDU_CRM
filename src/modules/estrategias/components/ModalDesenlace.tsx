/**
 * Finalizar / Cerrar una estrategia: pide el comentario (obligatorio) antes de archivarla.
 * Es una acción, no una etapa — por eso se confirma aquí y no en el menú de etapas.
 */

import { useState } from 'react';
import { DESENLACES } from '@core/puente';
import type { Desenlace } from '@core/tipos';

export function ModalDesenlace({ desenlace, titulo, onConfirmar, onCancelar }: {
    desenlace: Desenlace;
    /** Qué se está terminando (p. ej. "Conversión · Hematología"). */
    titulo: string;
    onConfirmar: (comentario: string) => void;
    onCancelar: () => void;
}) {
    const [comentario, setComentario] = useState('');
    const d = DESENLACES[desenlace];

    return (
        <div className="modal" onClick={(ev) => { if (ev.target === ev.currentTarget) onCancelar(); }}>
            <div className="modal-caja" role="dialog" aria-label={d.etiqueta + ' estrategia'}>
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{d.etiqueta} estrategia</h3>
                        <span className="eyebrow">{titulo}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCancelar}>✕</button>
                </div>
                <div className="modal-body">
                    <p className="ayuda">{d.descripcion} La estrategia se archivará y dejará de aparecer entre las vigentes.</p>
                    <label className="campo">
                        <span className="campo-lbl">{d.pregunta} *</span>
                        <textarea
                            className="inp notas-area" rows={3} autoFocus
                            value={comentario} onChange={(ev) => setComentario(ev.target.value)}
                        />
                    </label>
                    <div className="modal-foot">
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn-txt" onClick={onCancelar}>Cancelar</button>
                        <button
                            type="button" className="btn btn-principal" disabled={!comentario.trim()}
                            onClick={() => onConfirmar(comentario.trim())}
                        >
                            {d.etiqueta}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/** Los dos botones de acción, cada uno con su descripción al pasar el cursor. */
export function BotonesDesenlace({ onElegir, clase = 'btn-txt' }: {
    onElegir: (d: Desenlace) => void;
    clase?: string;
}) {
    return (
        <>
            {(['finalizado', 'cerrado'] as Desenlace[]).map(k => (
                <button
                    key={k} type="button" className={clase}
                    title={DESENLACES[k].descripcion}
                    onClick={(ev) => { ev.stopPropagation(); onElegir(k); }}
                >
                    {k === 'finalizado' ? '✓ ' : '✗ '}{DESENLACES[k].etiqueta}
                </button>
            ))}
        </>
    );
}
