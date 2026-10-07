/**
 * Datos que le faltan a la persona y que debe completar: hoy, la fecha del documento de una
 * evidencia ya adjunta.
 *
 * No viven en el servidor: se calculan sobre lo capturado en ESTE dispositivo (lo suyo), así que
 * aparecen y desaparecen en el momento en que se captura la fecha, sin esperar a ningún sync.
 */

import { todasLasActividades } from './storage.js';
import { fechaDocumentoFaltante } from './catalogos.js';

export function datosFaltantes() {
    return todasLasActividades()
        .filter(({ actividad }) => actividad.guardada && fechaDocumentoFaltante(actividad))
        .map(({ visita, sector, actividad }) => ({
            id: `falta-fecha-${actividad.id}`,
            tipo: 'fecha_documento',
            titulo: 'Falta la fecha del documento',
            // Si la evidencia ya se subió sin fecha, no hay nada retenido; si no, se explica qué pasa.
            detalle: actividad.evidencia?.estado === 'local'
                ? 'La evidencia está guardada en tu dispositivo pero no se sube hasta que captures la fecha del documento.'
                : 'La evidencia ya se subió, pero falta la fecha del documento.',
            id_visita: visita.id,
            id_actividad: actividad.id,
            visita, sector, actividad
        }));
}
