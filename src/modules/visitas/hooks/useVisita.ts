/**
 * Estado de la visita abierta en el drawer.
 *
 * El dato vive en el almacén, no en React: es la misma visita que lee el calendario, la que
 * sincroniza `sync.js` y la que sobrevive a un cierre de pestaña. Duplicarla en `useState`
 * crearía dos verdades que se separan en cuanto algo escribe por el otro lado.
 *
 * Así que aquí hay una copia de LECTURA que se refresca tras cada escritura. Es más tosco que
 * un store reactivo, y es lo correcto mientras el resto de la app siga siendo vanilla.
 */

import { useCallback, useEffect, useState } from 'react';
import type { Visita } from '@core/tipos';
import * as repo from '../repository/visitasRepo';

export interface OpcionesEdicion {
    /** Avisa hacia afuera (calendario, contadores) además de refrescar el drawer. */
    silencioso?: boolean;
}

export interface UsoVisita {
    visita: Visita | null;
    /** Aplica un cambio y refresca. Devuelve la visita ya modificada. */
    editar: (mutador: (v: Visita) => void, opciones?: OpcionesEdicion) => Visita | null;
    /** Vuelve a leer del almacén. Para después de que otra ventana haya escrito. */
    refrescar: () => void;
}

export function useVisita(
    visitaId: string | null,
    alCambiar: () => void = () => {}
): UsoVisita {
    const [visita, setVisita] = useState<Visita | null>(
        () => (visitaId ? repo.obtenerVisita(visitaId) : null)
    );

    const refrescar = useCallback(() => {
        setVisita(visitaId ? repo.obtenerVisita(visitaId) : null);
    }, [visitaId]);

    useEffect(() => { refrescar(); }, [refrescar]);

    const editar = useCallback((mutador: (v: Visita) => void, opciones: OpcionesEdicion = {}) => {
        if (!visitaId) return null;

        const actualizada = repo.actualizarVisita(visitaId, mutador);

        // Se vuelve a leer en vez de reusar lo devuelto: el almacén es la fuente de verdad y
        // puede haber normalizado algo por el camino.
        refrescar();
        if (!opciones.silencioso) alCambiar();

        return actualizada;
    }, [visitaId, refrescar, alCambiar]);

    return { visita, editar, refrescar };
}
