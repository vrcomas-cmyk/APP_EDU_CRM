/**
 * Indicadores de estado, compartidos por todas las vistas del calendario.
 *
 * El punto es RELLENO o HUECO, no solo de otro color: relleno significa que ya ocurrió algo,
 * hueco que todavía no. La forma existe porque cerca del 8% de los hombres no distingue
 * rojo de verde, y el estado de una visita no puede depender de eso.
 *
 * El color nunca va solo: siempre lo acompaña una pastilla con el texto.
 */

import { SALUD } from '@core/puente';

export function PuntoSalud({ salud }: { salud: string }) {
    const hueco = salud === SALUD.NEUTRA || salud === SALUD.CANCELADA;
    return <span className={'dot' + (hueco ? ' hollow' : '')} aria-hidden="true" />;
}

export function Pastilla({ texto, neutro = false }: { texto: string; neutro?: boolean }) {
    return <span className={neutro ? 'pill neutro' : 'pill'}>{texto}</span>;
}

/** Punto + estado + cola de sincronización. Se repite en tarjeta, mes y agenda. */
export function BanderasVisita({ salud, detalle, sincronizado, clase }: {
    salud: string;
    detalle: string;
    sincronizado?: boolean;
    clase: string;
}) {
    return (
        <span className={clase}>
            <PuntoSalud salud={salud} />
            <Pastilla texto={detalle} />
            {/* Lo que no ha subido se dice, porque si el teléfono se pierde ese trabajo no está
                en ninguna otra parte. */}
            {!sincronizado && <Pastilla texto="↑ En cola" neutro />}
        </span>
    );
}
