/**
 * Puente entre la app vanilla y el drawer en React.
 *
 * Expone EXACTAMENTE la misma API que `js/drawer.js` —`initDrawer`, `abrirVisita`,
 * `abrirNuevaVisita`, `hayDrawerAbierto`— para que `app.js` y `calendario.js` no cambien ni
 * una línea. Ese es todo el truco de la migración progresiva: la frontera se mueve por dentro
 * y quien llama no se entera.
 *
 * Cuando el calendario también se porte, este archivo desaparece y el drawer se monta como un
 * componente más dentro del árbol de React.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { VisitaDrawer } from './components/VisitaDrawer';
import { nuevaVisita, type DatosNuevaVisita } from './services/fabricas';
import * as repo from './repository/visitasRepo';
import { sesionActual, type Avisar } from '@core/puente';

import { abrirSector } from '@modules/sectores/montarSector';
import { abrirActividad } from '@modules/actividades/montarActividad';

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let visitaAbierta: string | null = null;

/**
 * Contador de invalidación. Las ventanas de sector y actividad siguen siendo vanilla y
 * escriben directo en el almacén; esto le dice al drawer que vuelva a leerlo.
 */
let version = 0;

let alCambiar: () => void = () => {};
let avisar: Avisar = () => {};

export function initDrawer({ onCambio, onToast }: {
    onCambio?: () => void;
    onToast?: Avisar;
} = {}): void {
    alCambiar = onCambio || (() => {});
    avisar = onToast || (() => {});

    contenedor = document.createElement('div');
    contenedor.className = 'drawer-host';
    document.body.appendChild(contenedor);

    raiz = createRoot(contenedor);
    pintar();
}

export function hayDrawerAbierto(): boolean {
    return visitaAbierta !== null;
}

export function abrirVisita(id: string): void {
    visitaAbierta = id;
    version++;
    pintar();
}

/**
 * Nueva visita, siempre como BORRADOR. Se persiste de inmediato —para que sobreviva a un
 * cierre accidental— pero con la marca de borrador, así que no existe para el calendario ni
 * para la sincronización hasta que se guarde.
 */
export function abrirNuevaVisita(datos: DatosNuevaVisita = {}): void {
    const visita = nuevaVisita(datos, sesionActual(), repo.nuevoId);
    repo.agregarVisita(visita);
    abrirVisita(visita.id);
}

function cerrar(): void {
    visitaAbierta = null;
    pintar();
}

function pintar(): void {
    if (!raiz) return;

    if (!visitaAbierta) {
        raiz.render(null);
        return;
    }

    raiz.render(
        <StrictMode>
            <VisitaDrawer
                // La clave fuerza un montaje limpio al cambiar de visita: sin ella, el estado
                // interno (nivel de sector, reagendando) se arrastraría de una visita a otra.
                key={visitaAbierta}
                visitaId={visitaAbierta}
                version={version}
                avisar={avisar}
                alCambiar={() => { alCambiar(); pintar(); }}
                onCerrar={cerrar}
                abrirOtraVisita={abrirVisita}
                abrirVentanaSector={(sectorId, alTerminar, anfitrion) => {
                    abrirSector({
                        // El anfitrión va DENTRO de `.drawer-raiz` por el apilado; ver el
                        // comentario en VisitaDrawer. Nunca `contenedor`.
                        host: (anfitrion ?? contenedor)!,
                        visitaId: visitaAbierta!,
                        sectorId,
                        alToast: avisar,
                        alCambiar: () => { version++; alCambiar(); pintar(); },
                        alCerrar: () => { version++; alTerminar(); }
                    });
                }}
                abrirVentanaActividad={(sectorId, actividadId, alTerminar, anfitrion) => {
                    abrirActividad({
                        host: (anfitrion ?? contenedor)!,
                        visitaId: visitaAbierta!,
                        sectorId,
                        actividadId,
                        alToast: avisar,
                        alCambiar: () => { version++; alTerminar(); alCambiar(); pintar(); }
                    });
                }}
            />
        </StrictMode>
    );
}
