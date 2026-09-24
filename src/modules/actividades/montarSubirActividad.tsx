/**
 * Puente entre el drawer y la ventana de "Subir Actividad" en React.
 *
 * Mismo patrón que `montarActividad.tsx`: raíz de React propia, colgada del `host` que vive
 * DENTRO de `.drawer-raiz` (nunca `document.body` — ver la nota de esa misma razón en
 * `montarActividad.tsx`).
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { VentanaSubirActividad } from './components/VentanaSubirActividad';
import type { Avisar } from '@core/puente';

import { abrirModalMaterial } from '../../../js/materiales.js';

export interface OpcionesSubirActividad {
    host: HTMLElement;
    visitaId: string;
    alCambiar?: () => void;
    alToast?: Avisar;
}

/** Devuelve `destruir`, igual que `abrirActividad`/`abrirSector` — ver esas notas gemelas. */
export function abrirSubirActividad({
    host, visitaId, alCambiar = () => {}, alToast = () => {}
}: OpcionesSubirActividad): () => void {
    const contenedor = document.createElement('div');
    contenedor.className = 'actividad-host';
    host.appendChild(contenedor);

    const raiz: Root = createRoot(contenedor);
    let desmontada = false;

    const destruir = () => {
        if (desmontada) return;
        desmontada = true;
        raiz.unmount();
        contenedor.remove();
    };

    const cerrar = () => {
        queueMicrotask(destruir);
    };

    raiz.render(
        <StrictMode>
            <VentanaSubirActividad
                visitaId={visitaId}
                avisar={alToast}
                alCambiar={alCambiar}
                onCerrar={cerrar}
                abrirVentanaMaterial={(sector, onAgregar) => {
                    abrirModalMaterial({ host, sector, alToast, onAgregar } as never);
                }}
            />
        </StrictMode>
    );

    return destruir;
}
