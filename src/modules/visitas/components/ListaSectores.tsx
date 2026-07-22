/**
 * Los sectores de una visita, como tarjetas.
 *
 * La tarjeta muestra de un vistazo lo que se querría saber antes de entrar: qué se buscaba,
 * quién lo pidió y cuánto se lleva registrado. Los contadores pesan más que el detalle —desde
 * afuera la pregunta es "¿me falta algo aquí?", no "¿qué dice?".
 */

import { useMemo } from 'react';
import {
    estadoSector, etiquetaSector, estaGuardada, requiereEvidencia, estadoDe, ESTADOS
} from '@core/puente';
import type { Visita, Sector } from '@core/tipos';

interface PropsLista {
    visita: Visita;
    onAbrirSector: (sectorId: string) => void;
    onAgregarSector: () => void;
    /** Visita de otra persona: se ve, no se le agrega nada. Ver `puedeEditarVisita`. */
    soloLectura?: boolean;
}

export function ListaSectores({ visita, onAbrirSector, onAgregarSector, soloLectura }: PropsLista) {
    const sectores = visita.sectores || [];
    const cancelada = estadoDe(visita) === ESTADOS.CANCELADA;

    return (
        <div className="campo">
            <span className="campo-lbl">Sectores · {sectores.length}</span>

            {sectores.length === 0 && (
                <p className="ayuda">
                    {visita.borrador
                        ? 'Una visita necesita al menos un sector. Agrega los que vas a trabajar.'
                        : 'Esta visita no tiene sectores.'}
                </p>
            )}

            <div className="sectores">
                {sectores.map(s => (
                    <TarjetaSector
                        key={s.id}
                        visita={visita}
                        sector={s}
                        onAbrir={() => onAbrirSector(s.id)}
                    />
                ))}
            </div>

            {/* Un solo botón en vez de la pared de chips del catálogo: elegir vive en su ventana. */}
            {!cancelada && !soloLectura && (
                <button type="button" className="btn-dashed" onClick={onAgregarSector}>
                    + Agregar sector
                </button>
            )}
        </div>
    );
}

/**
 * Lo que un sector lleva acumulado. Una sola pasada por sus actividades.
 *
 * ── Corrección respecto al drawer anterior ───────────────────────────────────────────
 *
 * La deuda de evidencia cuenta SOLO actividades selladas. Antes se contaban también los
 * borradores, y eso hacía que la tarjeta se contradijera con el contador global de la barra
 * —que sí filtra por sello (ver `evidenciasPendientesDe` en estado.js)—: un borrador mostraba
 * "1 evid." aquí y 0 allá.
 *
 * La regla correcta es la del contador global: pedir la foto de algo que todavía se está
 * escribiendo es deuda que nadie puede saldar, y una bandeja llena de cosas imposibles de
 * cerrar se deja de mirar. El borrador ya se señala aparte con su propia pastilla.
 */
function resumenDe(sector: Sector) {
    const actividades = sector.actividades || [];
    let borradores = 0;
    let materiales = 0;
    let evidenciasPendientes = 0;

    for (const a of actividades) {
        materiales += (a.materiales || []).length;

        if (!estaGuardada(a)) { borradores++; continue; }
        if (requiereEvidencia(a) && a.evidencia?.estado !== 'subida') evidenciasPendientes++;
    }

    return { total: actividades.length, borradores, materiales, evidenciasPendientes };
}

interface PropsTarjeta {
    visita: Visita;
    sector: Sector;
    onAbrir: () => void;
}

function TarjetaSector({ visita, sector, onAbrir }: PropsTarjeta) {
    const estado = estadoSector(visita, sector);
    const r = useMemo(() => resumenDe(sector), [sector]);

    const procedencia = [
        (sector.origen || []).join(', '),
        sector.solicitado_por ? `Pidió: ${sector.solicitado_por}` : ''
    ].filter(Boolean).join(' · ');

    return (
        <button
            type="button"
            className="sector-card"
            data-sector={sector.id}
            data-estado={estado}
            onClick={onAbrir}
        >
            <span className="sector-card-head">
                <span className="sector-card-nombre">{sector.nombre}</span>
                <span className={`sector-estado es-${estado}`}>{etiquetaSector(estado)}</span>
                <span className="sector-fila-flecha">›</span>
            </span>

            <span className="sector-card-cuerpo">
                <span className={'sector-card-objetivo' + (sector.objetivo ? '' : ' es-vacio')}>
                    {sector.objetivo || 'Sin objetivo'}
                </span>
                {procedencia && <span className="sector-card-origen">{procedencia}</span>}
            </span>

            <span className="sector-card-meta">
                <span className="sector-cuenta">
                    {r.total} {r.total === 1 ? 'actividad' : 'actividades'}
                </span>
                {r.materiales > 0 && (
                    <span className="sector-cuenta">
                        {r.materiales} {r.materiales === 1 ? 'material' : 'materiales'}
                    </span>
                )}
                {r.borradores > 0 && (
                    <span className="pill st-programada">{r.borradores} sin guardar</span>
                )}
                {r.evidenciasPendientes > 0 && (
                    <span className="pill st-faltan-evidencias">{r.evidenciasPendientes} evid.</span>
                )}
            </span>
        </button>
    );
}
