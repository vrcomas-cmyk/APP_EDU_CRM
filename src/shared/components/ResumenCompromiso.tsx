/**
 * Resumen en pantalla de un compromiso de Google Calendar.
 *
 * Antes, tocarlo mandaba directo a Calendar en una pestaña nueva — para saber de qué se
 * trataba una junta de 15 minutos había que salir de la app. Esto es de solo lectura, igual
 * que el bloque que lo abre: "Abrir en Google Calendar" sigue ahí para quien de verdad
 * necesite editarlo, pero ya no es el único camino para leerlo.
 */

import type { CompromisoCalendar } from '@core/puente';

function horaCorta(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? ''
        : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export function ResumenCompromiso({ compromiso, onCerrar }: {
    compromiso: CompromisoCalendar;
    onCerrar: () => void;
}) {
    const rango = compromiso.todoElDia
        ? 'Todo el día'
        : `${horaCorta(compromiso.inicio)} – ${horaCorta(compromiso.fin)}`;

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-actividad">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{compromiso.titulo}</h3>
                        <span className="eyebrow">Google Calendar · {rango}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
                </div>

                <div className="modal-body">
                    {compromiso.ubicacion && <p className="ayuda">📍 {compromiso.ubicacion}</p>}

                    {compromiso.descripcion && (
                        <p className="notas-area" style={{ whiteSpace: 'pre-wrap' }}>{compromiso.descripcion}</p>
                    )}

                    {compromiso.invitados && compromiso.invitados.length > 0 && (
                        <p className="ayuda">Invitados: {compromiso.invitados.join(', ')}</p>
                    )}

                    {!compromiso.ubicacion && !compromiso.descripcion && !compromiso.invitados?.length && (
                        <p className="ayuda">Sin más detalle en este evento.</p>
                    )}

                    {compromiso.url && (
                        <div className="modal-foot">
                            <span style={{ flex: 1 }} />
                            <a
                                className="btn-txt"
                                href={compromiso.url}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Abrir en Google Calendar
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
