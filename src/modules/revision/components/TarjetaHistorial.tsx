/**
 * Un elemento ya cerrado: quién lo resolvió, cuándo y con qué comentarios — y la salida para
 * cambiar su estatus (Reabrir). Reabrir NO borra nada: agrega un veredicto «Reabierto» con su
 * motivo y el elemento vuelve a la cola de pendientes; el educador recibe el aviso.
 */

import { useState } from 'react';
import { comentariosDeVisita, historialDe, miniaturaEvidencia } from '@core/puente';
import type { FlujoRevision, PendienteRevision } from '@core/tipos';
import { NodoVanilla } from '@shared/components/NodoVanilla';

import { Contexto } from './TarjetaPendiente';
import { ComentariosDeVisita, HistorialRevisiones } from './LoYaDicho';

interface Props {
    flujo: FlujoRevision;
    item: PendienteRevision;
    /** Devuelve el error a mostrar, o `null` si se reabrió. */
    onReabrir: (motivo: string) => string | null;
}

export function TarjetaHistorial({ flujo, item, onReabrir }: Props) {
    const historial = historialDe(flujo.clave, item.id_ambito);
    const charla = comentariosDeVisita(item.id_visita);
    const [abriendo, setAbriendo] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [aviso, setAviso] = useState('');

    const confirmar = () => {
        const error = onReabrir(motivo);
        if (error) setAviso(error);
        // Sin error el elemento pasa a pendientes y esta tarjeta desaparece de aquí.
    };

    return (
        <div className="revision-card">
            <div className="revision-head">
                <div className="revision-head-txt">
                    <span className="revision-titulo">{item.titulo}</span>
                    <span className="revision-detalle">{item.detalle}</span>
                </div>
                {item.actividad && (
                    <NodoVanilla
                        clave={item.actividad.id}
                        construir={() => miniaturaEvidencia(item.actividad!)}
                    />
                )}
            </div>

            <Contexto flujo={flujo} item={item} />

            <HistorialRevisiones flujo={flujo} historial={historial} />
            <ComentariosDeVisita charla={charla} />

            {!abriendo ? (
                <div className="revision-botones">
                    <button type="button" className="btn-txt" onClick={() => setAbriendo(true)}>
                        ↺ Reabrir para cambiar el estatus
                    </button>
                </div>
            ) : (
                <div className="revision-acciones">
                    <textarea
                        className="inp hilo-area"
                        rows={2}
                        placeholder="¿Por qué se reabre? (el educador lo verá)"
                        value={motivo}
                        onChange={e => { setMotivo(e.target.value); if (aviso) setAviso(''); }}
                    />
                    {aviso && <span className="pista" role="alert">{aviso}</span>}
                    <div className="revision-botones">
                        <button type="button" className="btn btn-principal" onClick={confirmar}>
                            Reabrir
                        </button>
                        <button type="button" className="btn-txt" onClick={() => { setAbriendo(false); setAviso(''); }}>
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
