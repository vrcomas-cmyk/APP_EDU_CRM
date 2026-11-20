/**
 * Lo que ya se dijo sobre este elemento: revisiones anteriores y comentarios de la visita.
 *
 * Va DESPLEGADO. Un comentario o una observación de revisión es justo el mensaje que alguien
 * quiso transmitir (cambia esto, sube otra evidencia): enterrarlo en un plegable hacía que
 * nadie lo leyera. Cada bloque sigue pudiéndose plegar con su encabezado.
 */

import type { Comentario, FlujoRevision, Revision } from '@core/tipos';
import { etiquetaResultado, fechaCorta, plural, tonoResultado } from '../services/formato';

function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
    return (
        <details className="historial" open>
            <summary>{resumen}</summary>
            {children}
        </details>
    );
}

export function HistorialRevisiones(
    { flujo, historial }: { flujo: FlujoRevision; historial: Revision[] }
) {
    if (!historial.length) return null;

    return (
        <Plegable resumen={`Revisado ${plural(historial.length, 'vez', 'veces')} antes`}>
            {/* Del más reciente al más antiguo: lo último que se dijo es lo que pesa. */}
            {historial.slice().reverse().map(r => (
                <div className="historial-item" key={r.id}>
                    <p>
                        <span className={`dot st-${tonoResultado(flujo, r.resultado)}`} aria-hidden="true" />
                        <span> {etiquetaResultado(flujo, r.resultado)}</span>
                    </p>
                    <p className="historial-meta">
                        {r.revisor || r.revisor_correo || 'Sin revisor'} · {fechaCorta(r.momento)}
                    </p>
                    {r.criterios && r.criterios.length > 0 && (
                        <p className="historial-meta">
                            {r.criterios.map(c => `${c.ok ? '✓' : '✗'} ${c.etiqueta || c.clave}`).join(' · ')}
                        </p>
                    )}
                    {r.observaciones && <p className="coment-txt">{r.observaciones}</p>}
                </div>
            ))}
        </Plegable>
    );
}

export function ComentariosDeVisita({ charla }: { charla: Comentario[] }) {
    if (!charla.length) return null;

    return (
        <Plegable resumen={plural(charla.length, 'comentario en la visita', 'comentarios en la visita')}>
            {charla.map(c => (
                <div className="historial-item" key={c.id}>
                    <p className="historial-meta">
                        {c.usuario || c.usuario_correo || 'Sin autor'} · {fechaCorta(c.momento)}
                    </p>
                    <p className="coment-txt">{c.texto}</p>
                </div>
            ))}
        </Plegable>
    );
}
