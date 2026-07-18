/**
 * Puente entre la app vanilla y el calendario en React.
 *
 * Expone la MISMA API que `js/calendario.js` —`initCalendario`, `refrescarCalendario`,
 * `irAHoy`, `irADia`, `setModo`— para que `app.js` no cambie.
 *
 * El estado de navegación (modo, cursor) vive dentro de React. Las funciones exportadas que lo
 * tocan desde fuera se conectan a través de un registro de mandos que el componente publica al
 * montarse. Es un rodeo, y existe porque `app.js` todavía llama a estas funciones directamente;
 * cuando el shell se porte, desaparece.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { Calendario, type ControlesExternos } from './components/Calendario';
import type { ModoCalendario } from './hooks/useCalendario';
import type { Avisar } from '@core/puente';

let raiz: Root | null = null;
let controles: ControlesExternos | undefined;

let alAbrirVisita: (id: string) => void = () => {};
let alCrearEn: (dia: string, inicio: string, fin: string | null) => void = () => {};
let alCambiar: () => void = () => {};
let avisar: Avisar = () => {};

/**
 * Contador de invalidación. El almacén no avisa cuando cambia, así que quien lo escribe llama
 * a `refrescarCalendario()` y esto obliga a releer. Es el mismo contrato que tenía el
 * calendario anterior, solo que ahora explícito en vez de un `render()` global.
 */
let version = 0;

/** Mandos que el componente publica para que las funciones exportadas puedan usarlos. */
interface Mandos {
    irAHoy: () => void;
    irADia: (dia: string) => void;
    setModo: (m: ModoCalendario) => void;
}
let mandos: Mandos | null = null;

export function initCalendario({ onAbrirVisita, onCrearEn, onCambio, onToast }: {
    onAbrirVisita?: (id: string) => void;
    onCrearEn?: (dia: string, inicio: string, fin: string | null) => void;
    onCambio?: () => void;
    onToast?: Avisar;
} = {}): void {
    alAbrirVisita = onAbrirVisita || (() => {});
    alCrearEn = onCrearEn || (() => {});
    alCambiar = onCambio || (() => {});
    avisar = onToast || (() => {});

    const host = document.getElementById('cal');
    if (!host) return;

    controles = {
        titulo: document.getElementById('cal-titulo'),
        anterior: document.getElementById('cal-anterior'),
        siguiente: document.getElementById('cal-siguiente'),
        hoy: document.getElementById('cal-hoy'),
        modos: document.getElementById('cal-modo')
    };

    raiz = createRoot(host);
    pintar();
}

export function refrescarCalendario(): void {
    version++;
    pintar();
}

export function irAHoy(): void { mandos?.irAHoy(); }
export function irADia(dia: string): void { mandos?.irADia(dia); }
export function setModo(modo: ModoCalendario): void { mandos?.setModo(modo); }

function pintar(): void {
    raiz?.render(
        <StrictMode>
            <Calendario
                version={version}
                controles={controles}
                onAbrirVisita={(id) => alAbrirVisita(id)}
                onCrearEn={(dia, inicio, fin) => alCrearEn(dia, inicio, fin)}
                onCambio={() => { alCambiar(); refrescarCalendario(); }}
                avisar={avisar}
                publicarMandos={(m) => { mandos = m; }}
            />
        </StrictMode>
    );
}
