/**
 * Lo que ya se dijo sobre este elemento: revisiones anteriores y comentarios de la visita.
 *
 * Va PLEGADO. En la bandeja lo normal es que no haya historia y, cuando la hay, es contexto
 * para el caso raro —el que ya se rechazó una vez—, no algo que haya que leer en los veinte
 * elementos de la cola. Desplegado empujaría cada tarjeta fuera de la pantalla.
 */

import type { Comentario, Revision } from '@core/tipos';
import { ETIQUETAS_RESULTADO } from '@core/puente';
import { fechaCorta, plural, tonoResultado } from '../services/formato';

function Plegable({ resumen, children }: { resumen: string; children: React.ReactNode }) {
    return (
        <details className="historial">
            <summary>{resumen}</summary>
            {children}
        </details>
    );
}

export function HistorialRevisiones({ historial }: { historial: Revision[] }) {
    if (!historial.length) return null;

    return (
        <Plegable resumen={`Revisado ${plural(historial.length, 'vez', 'veces')} antes`}>
            {/* Del más reciente al más antiguo: lo último que se dijo es lo que pesa. */}
            {historial.slice().reverse().map(r => (
                <div className="historial-item" key={r.id}>
                    <p>
                        <span className={`dot st-${tonoResultado(r.resultado)}`} aria-hidden="true" />
                        <span> {ETIQUETAS_RESULTADO[r.resultado] || r.resultado}</span>
                    </p>
                    <p className="historial-meta">
                        {r.revisor || r.revisor_correo || 'Sin revisor'} · {fechaCorta(r.momento)}
                    </p>
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
