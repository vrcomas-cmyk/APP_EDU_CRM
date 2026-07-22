/**
 * El shell: navegación + la vista activa.
 *
 * Sustituye al modelo anterior, donde el calendario ERA la pantalla y todo lo demás se abría
 * encima como una capa. Ahora los módulos son sitios a los que se va.
 *
 * Todos los módulos son ya vistas: ninguno se abre como capa encima de otro. El registro de
 * módulos dice cuáles existen y quién los ve; aquí solo se elige cuál se pinta.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode, useCallback, useState } from 'react';

import { Navegacion } from './navegacion/Navegacion';
import { resolverModulo, type ClaveModulo } from './navegacion/modulos';
import { Calendario, type ControlesExternos, type MandosNavegacion } from '@modules/agenda/components/Calendario';
import { Dashboard } from '@modules/dashboard/components/Dashboard';
import { Estrategias } from '@modules/estrategias/components/Estrategias';
import { MiDia } from '@modules/midia/components/MiDia';
import { Revision } from '@modules/revision/components/Revision';
import { Administracion } from '@modules/administracion/components/Administracion';
import type { Avisar } from '@core/puente';

export interface OpcionesVistas {
    onAbrirVisita?: (id: string) => void;
    onCrearEn?: (dia: string, inicio: string, fin: string | null) => void;
    onCambio?: () => void;
    onToast?: Avisar;
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
        datenav: document.getElementById('cal-datenav'),
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

    const elegir = useCallback((clave: ClaveModulo) => { setActivo(clave); }, []);

    irAModulo = elegir;

    // El contexto de la appbar —fechas, vistas— pertenece al calendario. En otro módulo se
    // esconde: dejarlo visible sugeriría que sigue haciendo algo.
    const enCalendario = activo === 'calendario';

    // El FAB crea visitas; fuera del calendario no hay dónde agendarlas, así que desaparece
    // en vez de quedarse como un atajo hacia un módulo que no lo necesita.
    const fab = document.getElementById('fab');
    if (fab) (fab as HTMLButtonElement).hidden = !enCalendario;

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

                {activo === 'mi-dia' && (
                    <MiDia onAbrirVisita={(id) => opciones.onAbrirVisita?.(id)} />
                )}

                {activo === 'estrategias' && <Estrategias avisar={opciones.onToast} />}

                {activo === 'dashboard' && <Dashboard />}

                {activo === 'revision' && (
                    <Revision
                        // Revisar cambia el contador del riel, así que hay que repintarlo.
                        onCambio={() => { opciones.onCambio?.(); refrescarVistas(); }}
                        avisar={opciones.onToast}
                    />
                )}

                {activo === 'administracion' && (
                    <Administracion
                        avisar={opciones.onToast}
                        // Los catálogos acaban de cambiar: lo que se ofrece al capturar sale de
                        // ahí, así que el resto de la app tiene que releerlos.
                        onGuardado={() => { opciones.onCambio?.(); refrescarVistas(); }}
                    />
                )}
            </div>
        </>
    );
}

/** Esconde la barra de fechas y el selector de vistas mientras el calendario no está. */
function ContextoOculto({ controles }: { controles?: ControlesExternos }) {
    if (controles?.datenav) (controles.datenav as HTMLElement).hidden = true;
    if (controles?.modos) (controles.modos as HTMLElement).hidden = true;
    if (controles?.titulo) controles.titulo.textContent = '';
    return null;
}
