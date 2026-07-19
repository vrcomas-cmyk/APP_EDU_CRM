/**
 * El expediente completo de una visita: todos sus sectores, actividades, materiales y
 * evidencias, de solo lectura.
 *
 * Quien revisa "calidad de la visita" o "cumplimiento" mira el ámbito VISITA completo, no una
 * actividad puntual — sin esto solo veía un resumen de tres datos (educador, cliente, fecha) y
 * tenía que calificar sin ver qué se hizo ni si la evidencia respalda lo capturado. Este
 * componente es la misma información que ya trae `item.visita` (el árbol completo llega desde
 * `consultarVisitas()`, incluidas las visitas del equipo); no pide nada nuevo al servidor.
 */

import type { Actividad, Sector, Visita } from '@core/tipos';
import { miniaturaEvidencia, urlEvidencia } from '@core/puente';
import { NodoVanilla } from '@shared/components/NodoVanilla';

export function ExpedienteVisita({ visita }: { visita: Visita }) {
    const sectores = visita.sectores || [];

    if (sectores.length === 0) {
        return <p className="ayuda">Esta visita no tiene sectores registrados.</p>;
    }

    return (
        <div className="expediente">
            {sectores.map(s => <BloqueSector key={s.id} sector={s} />)}
        </div>
    );
}

function BloqueSector({ sector }: { sector: Sector }) {
    const actividades = sector.actividades || [];

    return (
        <div className="expediente-sector">
            <p className="expediente-sector-nombre">
                {sector.nombre}
                {sector.objetivo && <span className="expediente-sector-obj"> · {sector.objetivo}</span>}
            </p>

            {actividades.length === 0
                ? <p className="ayuda">Sin actividades registradas.</p>
                : actividades.map(a => <BloqueActividad key={a.id} actividad={a} />)}
        </div>
    );
}

function BloqueActividad({ actividad }: { actividad: Actividad }) {
    const materiales = actividad.materiales || [];
    const contacto = actividad.contacto;
    const tieneEvidencia = Boolean(urlEvidencia(actividad));

    return (
        <div className="expediente-actividad">
            <div className="expediente-actividad-head">
                <span className="expediente-actividad-tipo">
                    {actividad.tipo || 'Sin tipo'}
                    {actividad.area_visitada && ` · ${actividad.area_visitada}`}
                </span>

                {/* La evidencia se VE, no se describe — igual criterio que en la tarjeta de
                    revisión por actividad. Aquí importa sobre todo para calidad de la visita,
                    que no tenía forma de mostrarla al ser de ámbito VISITA y no actividad. */}
                {tieneEvidencia ? (
                    <NodoVanilla clave={actividad.id} construir={() => miniaturaEvidencia(actividad)} />
                ) : (
                    <span className="pill st-faltan-evidencias">Sin evidencia</span>
                )}
            </div>

            {contacto?.nombre && (
                <p className="expediente-dato">
                    Contacto: {contacto.nombre}{contacto.cargo ? ` (${contacto.cargo})` : ''}
                    {contacto.servicio ? ` · ${contacto.servicio}` : ''}
                </p>
            )}

            {materiales.length > 0 && (
                <p className="expediente-dato">
                    Materiales: {materiales.map(m =>
                        `${m.material || 'Sin nombre'} ×${m.cantidad ?? '—'}${m.unidad ? ` ${m.unidad}` : ''}`
                    ).join(', ')}
                </p>
            )}
        </div>
    );
}
