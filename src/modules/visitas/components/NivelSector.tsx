/**
 * El sector visto desde dentro: sus datos ya sellados y la lista de sus actividades.
 *
 * Solo se llega aquí desde una visita GUARDADA. Mientras es borrador, el sector se corrige en
 * su propia ventana; una vez guardada, objetivo, origen y solicitado_por son parte de lo que
 * la visita afirmó y no se editan. Lo único abierto son las actividades, que es justo lo que
 * se viene a hacer aquí.
 */

import { estadoSector, etiquetaSector, estaGuardada, requiereEvidencia, bloqueoParaActividades } from '@core/puente';
import type { Visita, Sector, Actividad } from '@core/tipos';

interface Props {
    visita: Visita;
    sector: Sector;
    onAbrirActividad: (actividadId: string | null) => void;
}

export function CabeceraSector({ visita, sector, onVolver, onCerrar }: {
    visita: Visita; sector: Sector; onVolver: () => void; onCerrar: () => void;
}) {
    const estado = estadoSector(visita, sector);

    return (
        <div className="drawer-head">
            <button type="button" className="icon-btn volver" aria-label="Volver a la visita" onClick={onVolver}>
                ‹
            </button>
            <div className="drawer-head-txt">
                <h3>{sector.nombre}</h3>
                <p className="drawer-sub">{visita.hospital || 'Sin hospital'} · {visita.hora_inicio}</p>
                <span className={`sector-estado es-${estado}`}>{etiquetaSector(estado)}</span>
            </div>
            <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
        </div>
    );
}

export function CuerpoSector({ visita, sector, onAbrirActividad }: Props) {
    return (
        <div className="drawer-body">
            <div className="campo panel-info">
                <span className="campo-lbl">Sector registrado</span>
                <div className="datos">
                    <Dato etiqueta="Objetivo" valor={sector.objetivo} />
                    <Dato etiqueta="Origen de la actividad" valor={(sector.origen || []).join(', ')} />
                    <Dato etiqueta="Solicitado por" valor={sector.solicitado_por} />
                </div>
                <p className="ayuda">
                    Estos datos se registraron al guardar la visita y no se editan.
                </p>
            </div>

            <BloqueActividades visita={visita} sector={sector} onAbrirActividad={onAbrirActividad} />
        </div>
    );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string }) {
    return (
        <div className="dato">
            <span className="dato-lbl">{etiqueta}</span>
            <span className={'dato-val' + (valor ? '' : ' es-vacio')}>{valor || '—'}</span>
        </div>
    );
}

function BloqueActividades({ visita, sector, onAbrirActividad }: Props) {
    const actividades = sector.actividades || [];

    // Hay estados en que capturar no tiene sentido —cancelada, sin haber llegado— y el motivo
    // se muestra en vez de un botón muerto.
    const bloqueo = bloqueoParaActividades(visita);

    return (
        <div className="campo actividades">
            <span className="campo-lbl">Actividades · {actividades.length}</span>

            {bloqueo ? (
                <p className="aviso">{bloqueo}</p>
            ) : (
                <>
                    {actividades.length === 0 && (
                        <p className="ayuda">Aún no registras actividades en este sector.</p>
                    )}

                    {actividades.map((act, i) => (
                        <FilaActividad
                            key={act.id}
                            actividad={act}
                            numero={i + 1}
                            onAbrir={() => onAbrirActividad(act.id)}
                        />
                    ))}

                    <button
                        type="button"
                        className="btn btn-principal btn-registrar"
                        onClick={() => onAbrirActividad(null)}
                    >
                        + Registrar actividad
                    </button>
                </>
            )}
        </div>
    );
}

/**
 * Una actividad en la lista: qué fue, con quién y en qué estado quedó.
 *
 * Es una fila y no una tarjeta desplegada porque desde aquí no se edita nada — solo se decide
 * cuál abrir. El detalle completo vive en su ventana.
 */
function FilaActividad({ actividad, numero, onAbrir }: {
    actividad: Actividad; numero: number; onAbrir: () => void;
}) {
    const guardada = estaGuardada(actividad);
    const debeEvidencia = requiereEvidencia(actividad);
    const subida = actividad.evidencia?.estado === 'subida';

    const sub = [
        actividad.area_visitada,
        (actividad.contacto?.nombre || '').trim(),
        (actividad.materiales || []).length ? `${actividad.materiales!.length} mat.` : ''
    ].filter(Boolean).join(' · ') || 'Sin capturar';

    return (
        <button
            type="button"
            className={'act-fila' + (guardada ? '' : ' es-borrador')}
            data-actividad={actividad.id}
            onClick={onAbrir}
        >
            <span className="act-n">{numero}</span>

            <span className="act-fila-txt">
                <span className={'act-fila-titulo' + (actividad.tipo ? '' : ' es-vacio')}>
                    {actividad.tipo || 'Sin tipo'}
                </span>
                <span className="act-fila-sub">{sub}</span>
            </span>

            <span className="act-fila-meta">
                {!guardada ? (
                    <span className="pill st-programada">Borrador</span>
                ) : debeEvidencia && !subida ? (
                    <span className="pill st-faltan-evidencias">
                        {actividad.evidencia?.estado === 'local' ? 'Evid. en cola' : 'Falta evidencia'}
                    </span>
                ) : (
                    <span className="pill st-completa">✓ Completa</span>
                )}
            </span>

            <span className="sector-fila-flecha">›</span>
        </button>
    );
}
