/**
 * Solicitudes de eliminar una evidencia ya subida que le toca autorizar a esta persona.
 *
 * El educador pide, el jefe decide: aprobar manda el archivo a «eliminado» (no se borra, queda
 * para auditoría) y la actividad vuelve a deber su evidencia; rechazar exige explicar por qué y
 * la evidencia sigue como estaba. En los dos casos el educador recibe un aviso.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    solicitudesPorResolver, descargarSolicitudes, resolverEliminacion,
    consultarVisitas, miniaturaEvidencia, fechaHoraCorta, type Avisar
} from '@core/puente';
import type { SolicitudEliminacion } from '@core/tipos';
import { NodoVanilla } from '@shared/components/NodoVanilla';

function useSolicitudes(): SolicitudEliminacion[] {
    const [version, setVersion] = useState(0);

    useEffect(() => {
        const alCambiar = () => setVersion(v => v + 1);
        window.addEventListener('pdt:eliminaciones', alCambiar);
        // Al entrar a Revisión se pide fresco: no esperar al siguiente ciclo para ver lo nuevo.
        descargarSolicitudes().then(alCambiar).catch(() => {});
        return () => window.removeEventListener('pdt:eliminaciones', alCambiar);
    }, []);

    return useMemo(() => solicitudesPorResolver(), [version]);
}

export function SolicitudesEliminacion({ avisar }: { avisar?: Avisar }) {
    const pendientes = useSolicitudes();
    if (pendientes.length === 0) return null;

    return (
        <section className="panel-body" aria-label="Solicitudes de eliminación de evidencia">
            <p className="eyebrow">
                {pendientes.length === 1
                    ? '1 solicitud para eliminar una evidencia'
                    : `${pendientes.length} solicitudes para eliminar una evidencia`}
            </p>
            <div className="revision-lista">
                {pendientes.map(s => <TarjetaSolicitud key={s.id} solicitud={s} avisar={avisar} />)}
            </div>
        </section>
    );
}

function TarjetaSolicitud({ solicitud: s, avisar }: { solicitud: SolicitudEliminacion; avisar?: Avisar }) {
    const [nota, setNota] = useState('');
    const [aviso, setAviso] = useState('');
    const [enviando, setEnviando] = useState(false);

    // La actividad se busca en lo que esta persona ya ve, para mostrar QUÉ se pide eliminar.
    const actividad = useMemo(() => {
        for (const v of consultarVisitas()) {
            for (const sector of v.sectores || []) {
                const a = (sector.actividades || []).find(x => x.id === s.id_actividad);
                if (a) return a;
            }
        }
        return null;
    }, [s.id_actividad]);

    async function decidir(aprobar: boolean) {
        if (enviando) return;
        setEnviando(true);
        try {
            await resolverEliminacion(s.id, aprobar, nota);
            avisar?.(aprobar ? 'Eliminación aprobada.' : 'Eliminación rechazada.', { estado: 'completa' });
        } catch (err) {
            setAviso((err as Error).message || 'No se pudo registrar la decisión.');
            setEnviando(false);
        }
    }

    return (
        <div className="revision-card">
            <div className="revision-head">
                <div className="revision-head-txt">
                    <span className="revision-titulo">{s.nombre_archivo || 'Evidencia'}</span>
                    <span className="revision-detalle">
                        {[s.cliente, `${s.solicitante || s.solicitante_correo} · ${fechaHoraCorta(s.creado_en)}`]
                            .filter(Boolean).join(' · ')}
                    </span>
                </div>
                {actividad && (
                    <NodoVanilla clave={actividad.id} construir={() => miniaturaEvidencia(actividad)} />
                )}
            </div>

            <p className="coment-txt"><strong>Motivo:</strong> {s.motivo}</p>

            <div className="revision-acciones">
                <textarea
                    className="inp hilo-area"
                    rows={2}
                    placeholder="Nota para el educador (obligatoria al rechazar)…"
                    value={nota}
                    onChange={e => { setNota(e.target.value); if (aviso) setAviso(''); }}
                />
                {aviso && <span className="pista" role="alert">{aviso}</span>}
                <div className="revision-botones">
                    <button type="button" className="btn btn-principal" disabled={enviando}
                            onClick={() => decidir(true)}>
                        ✓ Aprobar eliminación
                    </button>
                    <button type="button" className="btn-txt peligro" disabled={enviando}
                            onClick={() => decidir(false)}>
                        ✕ Rechazar
                    </button>
                </div>
                <p className="ayuda">
                    Al aprobar, el archivo deja de verse y la actividad vuelve a pedir su evidencia.
                    No se borra del servidor: queda para auditoría.
                </p>
            </div>
        </div>
    );
}
