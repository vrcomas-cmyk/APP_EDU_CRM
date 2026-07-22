/**
 * Puente entre la app vanilla y la paleta en React.
 *
 * Expone EXACTAMENTE la misma API que `js/paleta.js` —`initPaleta`, `abrirPaleta`,
 * `hayPaletaAbierta`— para que `app.js` no cambie ni una línea.
 *
 * Cuenta con su propio contenedor colgado de `document.body`, igual que el drawer: la paleta
 * es `z-index: 55` y tiene que quedar por encima del drawer (50). Montada dentro del árbol de
 * vistas heredaría su contexto de apilado y podría acabar por debajo —que es exactamente el
 * fallo que ya costó una sesión con la ventana de sector—.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { consultarVisitas } from '@core/puente';
import { Paleta, type AccionPaleta, type AtajoPaleta } from './components/Paleta';

export interface OpcionesPaleta {
    onNuevaVisita?: () => void;
    onIrAHoy?: () => void;
    onSetModo?: (modo: string) => void;
    onAbrirVisita?: (id: string) => void;
    onIrADia?: (dia: string) => void;
}

let raiz: Root | null = null;
let abierta = false;
let acciones: AccionPaleta[] = [];
let atajos: AtajoPaleta[] = [];
let opciones: OpcionesPaleta = {};

export function initPaleta(op: OpcionesPaleta = {}): void {
    opciones = op;

    // Toda acción cierra la paleta al ejecutarse: es una paleta de comandos, no un panel de
    // control. El cierre se envuelve aquí, una vez, en vez de confiar en que cada acción se
    // acuerde de hacerlo.
    const accion = (etiqueta: string, atajo: string, fn: () => void): AccionPaleta => ({
        etiqueta, atajo, fn: () => { fn(); cerrarPaleta(); }
    });

    acciones = [
        accion('Nueva visita', 'N', () => opciones.onNuevaVisita?.()),
        accion('Ir a hoy', 'T', () => opciones.onIrAHoy?.()),
        accion('Vista Día', 'D', () => opciones.onSetModo?.('dia')),
        accion('Vista Semana', 'S', () => opciones.onSetModo?.('semana')),
        accion('Vista Mes', 'M', () => opciones.onSetModo?.('mes'))
    ];

    // Los atajos que se muestran en el panel, según `js/app.js`. Es deliberadamente un
    // duplicado pequeño y plano (no se inyecta desde `app.js`): tenerlos aquí hace que el
    // panel se valide a sí mismo —si `app.js` añade uno y no lo refleja aquí, un
    // desarrollador lo ve al primer repaso del panel. La duplicación modal de 7 pares es
    // menos frágil que un puente JS→TS para lo mismo.
    atajos = [
        { tecla: 'N', descripcion: 'Nueva visita' },
        { tecla: 'T', descripcion: 'Ir a hoy' },
        { tecla: 'D', descripcion: 'Vista Día' },
        { tecla: 'S', descripcion: 'Vista Semana' },
        { tecla: 'M', descripcion: 'Vista Mes' },
        { tecla: 'I', descripcion: 'Indicadores' },
        { tecla: 'R', descripcion: 'Revisión' },
        { tecla: '⌘K', descripcion: 'Abrir esta paleta' }
    ];

    const contenedor = document.createElement('div');
    contenedor.className = 'paleta-host';
    document.body.appendChild(contenedor);

    raiz = createRoot(contenedor);
    pintar();
}

export function hayPaletaAbierta(): boolean { return abierta; }

export function abrirPaleta(): void {
    if (abierta) return;
    abierta = true;
    // Sin esto la página de fondo se desplaza al usar la rueda sobre el overlay.
    document.body.style.overflow = 'hidden';
    pintar();
}

export function cerrarPaleta(): void {
    if (!abierta) return;
    abierta = false;
    document.body.style.overflow = '';
    pintar();
}

function pintar(): void {
    if (!raiz) return;

    if (!abierta) {
        // Se desmonta en vez de esconderse: así el campo y la selección arrancan limpios en la
        // siguiente apertura, sin tener que acordarse de reiniciarlos a mano.
        raiz.render(null);
        return;
    }

    raiz.render(
        <StrictMode>
            <Paleta
                acciones={acciones}
                atajos={atajos}
                // Se leen al abrir, no al inicializar: entre una apertura y otra pudo agendarse
                // algo, y una paleta que no encuentra lo que acabas de crear se deja de usar.
                // `consultarVisitas()` y no solo local: la misma visita del equipo que ya se ve
                // en el Calendario debe poder abrirse también desde aquí — antes la paleta solo
                // conocía lo capturado en este dispositivo, e ir a buscar la de un compañero no
                // la encontraba aunque estuviera justo enfrente en la rejilla.
                visitas={consultarVisitas()}
                onIrAVisita={(v) => {
                    // Primero el día y luego la visita: abrir el drawer sobre el calendario en
                    // otra fecha deja detrás un contexto que no corresponde.
                    if (v.dia) opciones.onIrADia?.(v.dia);
                    opciones.onAbrirVisita?.(v.id);
                    cerrarPaleta();
                }}
                onCerrar={cerrarPaleta}
            />
        </StrictMode>
    );
}
