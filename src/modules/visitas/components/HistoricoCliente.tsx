/**
 * Lo que ya se dijo antes de este hospital, mientras se agenda una visita nueva.
 *
 * Un hospital con observaciones repetidas es información que se pierde entre visitas: la
 * escribe quien fue la última vez y la necesita quien va ahora, que suele ser otra persona.
 * `historicoDeHospital` ya existe para responder exactamente esto (`js/comentarios.js`); lo
 * único que faltaba era mostrarlo al capturar, que es cuando de verdad hace falta no perder
 * el hilo.
 */

import { useMemo } from 'react';
import { historicoDeHospital } from '@core/puente';
import type { Visita } from '@core/tipos';

export function HistoricoCliente({ visita }: { visita: Visita }) {
    const historico = useMemo(
        () => historicoDeHospital(visita.hospital || '', { excluirVisita: visita.id }),
        [visita.hospital, visita.id]
    );

    if (!visita.hospital?.trim() || historico.length === 0) return null;

    return (
        <details className="expediente-plegable historico-cliente">
            <summary>
                Lo ya dicho de {visita.hospital} ({historico.length})
                {/* Zona · Ejecutivo se resuelven arriba al elegir el Cliente; repetirlos aquí
                    evita que quien revisa el histórico tenga que subir la mirada para
                    confirmar que está viendo al cliente/zona correctos. */}
                {(visita.zona || visita.ejecutivo) && (
                    <span className="historico-zona">
                        {' '}· {visita.zona || '—'} · {visita.ejecutivo || '—'}
                    </span>
                )}
            </summary>
            <div className="expediente">
                {historico.map(c => (
                    <div className="historial-item" key={c.id}>
                        <p className="historial-meta">
                            {c.usuario || c.usuario_correo || 'Sin autor'} · {fechaCorta(c.momento)}
                        </p>
                        <p className="coment-txt">{c.texto}</p>
                    </div>
                ))}
            </div>
        </details>
    );
}

function fechaCorta(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}
