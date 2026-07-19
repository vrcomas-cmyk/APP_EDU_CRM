/**
 * El shell: navegación + la vista activa.
 *
 * Sustituye al modelo anterior, donde el calendario ERA la pantalla y todo lo demás se abría
 * encima como una capa. Ahora los módulos son sitios a los que se va.
 *
 * ── Lo que todavía no es una vista ───────────────────────────────────────────────────
 *
 * Administración sigue siendo vanilla y construye su propio panel a pantalla completa, así que
 * el riel lo ABRE como modal en vez de cambiar de vista. Se nota, y es deuda declarada en el
 * registro de módulos (`modal: true`). Al portarlo desaparece.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useState } from 'react';

import { Navegacion } from './navegacion/Navegacion';
import { moduloDe, resolverModulo, type ClaveModulo } from './navegacion/modulos';
import { Calendario, type ControlesExternos, type MandosNavegacion } from '@modules/agenda/components/Calendario';
import { Dashboard } from '@modules/dashboard/components/Dashboard';
import { Revision } from '@modules/revision/components/Revision';
import type { Avisar } from '@core/puente';

export interface OpcionesVistas {
    onAbrirVisita?: (id: string) => void;
    onCrearEn?: (dia: string, inicio: string, fin: string | null) => void;
    onCambio?: () => void;
    onToast?: Avisar;
    /** Abre un módulo que todavía es modal. Lo resuelve `app.js`. */
    onAbrirModal?: (clave: ClaveModulo) => void;
}

let raiz: Root | null = null;
let controles: ControlesExternos | undefined;
let opciones: OpcionesVistas = {};

let version = 0;
let mandos: MandosNavegacion | null = null;
let irAModulo: ((c: ClaveModulo) => void) | null = null;

export function initVistas(op: OpcionesVistas = {}): void {
    opciones = op;

    const host = document.getElementById('main');
    if (!host) return;

    controles = {
        titulo: document.getElementById('cal-titulo'),
        anterior: document.getElementById('cal-anterior'),
        siguiente: document.getElementById('cal-siguiente'),
        hoy: document.getElementById('cal-hoy'),
        modos: document.getElementById('cal-modo')
    };

    raiz = createRoot(host);
    raiz.render(<StrictMode><Shell /></StrictMode>);
}

/** El almacén no avisa cuando cambia; quien escribe llama a esto. */
export function refrescarVistas(): void {
    version++;
    raiz?.render(<StrictMode><Shell /></StrictMode>);
}

export function irAHoy(): void { mandos?.irAHoy(); }
export function irADia(dia: string): void { mandos?.irADia(dia); }
export function setModo(modo: string): void { mandos?.setModo(modo as never); }
export function mostrarModulo(clave: ClaveModulo): void { irAModulo?.(clave); }

function Shell() {
    const [activo, setActivo] = useState<ClaveModulo>(() => resolverModulo(null));

    const elegir = useCallback((clave: ClaveModulo) => {
        const modulo = moduloDe(clave);

        // Un módulo que todavía es modal no cambia la vista: se abre encima y el riel se
        // queda donde estaba, para no dejar la pantalla de fondo en blanco al cerrarlo.
        if (modulo?.modal) {
            opciones.onAbrirModal?.(clave);
            return;
        }
        setActivo(clave);
    }, []);

    irAModulo = elegir;

    // El contexto de la appbar —fechas, vistas— pertenece al calendario. En otro módulo se
    // esconde: dejarlo visible sugeriría que sigue haciendo algo.
    const enCalendario = activo === 'calendario';

    return (
        <>
            <Navegacion activo={activo} onElegir={elegir} />

            <div className="vista-host">
                {enCalendario ? (
                    <Calendario
                        version={version}
                        controles={controles}
                        publicarMandos={(m) => { mandos = m; }}
                        onAbrirVisita={(id) => opciones.onAbrirVisita?.(id)}
                        onCrearEn={(d, i, f) => opciones.onCrearEn?.(d, i, f)}
                        onCambio={() => { opciones.onCambio?.(); refrescarVistas(); }}
                        avisar={opciones.onToast ?? (() => {})}
                    />
                ) : (
                    <ContextoOculto controles={controles} />
                )}

                {activo === 'dashboard' && <Dashboard />}

                {activo === 'revision' && (
                    <Revision
                        // Revisar cambia el contador del riel, así que hay que repintarlo.
                        onCambio={() => { opciones.onCambio?.(); refrescarVistas(); }}
                        avisar={opciones.onToast}
                    />
                )}
            </div>
        </>
    );
}

/** Esconde la barra de fechas y el selector de vistas mientras el calendario no está. */
function ContextoOculto({ controles }: { controles?: ControlesExternos }) {
    if (controles?.modos) (controles.modos as HTMLElement).hidden = true;
    if (controles?.titulo) controles.titulo.textContent = '';
    return null;
}
