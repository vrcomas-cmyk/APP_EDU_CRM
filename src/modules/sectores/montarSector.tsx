/**
 * Puente entre el drawer y la ventana de sector en React.
 *
 * Misma firma que `js/sector.js`. El `host` llega desde el drawer y es un nodo interno de
 * `.drawer-raiz`: montar fuera de ahí deja la ventana por debajo del drawer y los clics se los
 * come el scrim. Ese fue exactamente el bug que impedía agregar sectores a una visita nueva.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { VentanaSector } from './components/VentanaSector';
import type { Avisar } from '@core/puente';

export interface OpcionesSector {
    host: HTMLElement;
    visitaId: string;
    sectorId?: string | null;
    alCambiar?: () => void;
    alToast?: Avisar;
    /** El drawer decide si lo capturado aquí ya nace sellado. */
    alCerrar?: () => void;
}

export function abrirSector({
    host, visitaId, sectorId = null,
    alCambiar = () => {}, alToast = () => {}, alCerrar = () => {}
}: OpcionesSector): void {
    const contenedor = document.createElement('div');
    contenedor.className = 'sector-host';
    host.appendChild(contenedor);

    const raiz: Root = createRoot(contenedor);

    const cerrar = () => {
        // Desmontar dentro del render que lo provoca hace que React se queje; el cierre
        // siempre llega desde un manejador de la propia ventana.
        queueMicrotask(() => {
            raiz.unmount();
            contenedor.remove();
            alCambiar();
            alCerrar();
        });
    };

    raiz.render(
        <StrictMode>
            <VentanaSector
                visitaId={visitaId}
                sectorId={sectorId}
                avisar={alToast}
                alCambiar={alCambiar}
                onCerrar={cerrar}
            />
        </StrictMode>
    );
}
