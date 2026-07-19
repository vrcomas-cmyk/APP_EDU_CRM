/**
 * Administración.
 *
 * Vive fuera del flujo de visitas —no es un nivel del drawer— porque no pertenece a NINGUNA
 * visita en particular: son catálogos compartidos por todos.
 *
 * Guardado explícito, no automático como el drawer: aquí un error se propaga a TODOS los
 * educadores en el siguiente sync, así que un botón «Guardar» da oportunidad de revisar antes
 * de que eso pase, en vez de subir cada tecla suelta.
 */

import { useState } from 'react';
import type { Avisar } from '@core/puente';
import { useAdmin } from '../hooks/useAdmin';
import { PanelTipos } from './PanelTipos';
import { PanelSectores } from './PanelSectores';
import { PanelListas } from './PanelListas';
import { PanelEducadores } from './PanelEducadores';

const PESTANAS = [
    { id: 'tipos', etiqueta: 'Tipos y campos' },
    { id: 'sectores', etiqueta: 'Sectores' },
    { id: 'listas', etiqueta: 'Listas' },
    { id: 'educadores', etiqueta: 'Equipo' }
] as const;

type Pestana = (typeof PESTANAS)[number]['id'];

interface Props {
    avisar?: Avisar;
    /** Se inyectan para poder probarlos: `confirm` bloquea el hilo y colgaría la suite. */
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export function Administracion({ avisar, confirmar, onGuardado }: Props) {
    const [pestana, setPestana] = useState<Pestana>('tipos');
    const preguntar = confirmar ?? ((m: string) => window.confirm(m));

    const { borrador, cambiar, guardando, guardar, descartar, sucio } =
        useAdmin({ avisar, confirmar: preguntar, onGuardado });

    return (
        <div className="vista vista-admin">
            <header className="vista-head">
                <h2>Administración</h2>
                <p className="eyebrow">Catálogos compartidos por todos los educadores.</p>
            </header>

            <div className="seg admin-tabs" role="group" aria-label="Secciones">
                {PESTANAS.map(p => (
                    <button
                        key={p.id}
                        type="button"
                        aria-pressed={p.id === pestana}
                        onClick={() => setPestana(p.id)}
                    >
                        {p.etiqueta}
                    </button>
                ))}
            </div>

            <div className="panel-body">
                {pestana === 'tipos' && (
                    <PanelTipos borrador={borrador} cambiar={cambiar} confirmar={preguntar} />
                )}
                {pestana === 'sectores' && <PanelSectores borrador={borrador} cambiar={cambiar} />}
                {pestana === 'listas' && <PanelListas borrador={borrador} cambiar={cambiar} />}
                {pestana === 'educadores' && <PanelEducadores borrador={borrador} cambiar={cambiar} />}
            </div>

            {/*
              La barra de guardado se queda pegada abajo. Las pestañas de tipos y equipo crecen
              mucho más que la pantalla, y un botón al final del documento obliga a bajar hasta
              el fondo para confirmar algo que se cambió arriba.
            */}
            <div className="vista-foot">
                {/*
                  Sustituye al «Cancelar» del modal. Como vista ya no hay nada que cerrar, y sin
                  esto la única forma de deshacer sería irse a otro módulo —que descarta igual,
                  pero de callado y sin que parezca esa la intención—.
                */}
                <button
                    type="button"
                    className="btn-txt"
                    disabled={!sucio || guardando}
                    onClick={() => {
                        if (preguntar('¿Descartar los cambios sin guardar?')) descartar();
                    }}
                >
                    Descartar
                </button>

                <span className="ayuda">
                    {sucio ? 'Hay cambios sin guardar.' : 'Sin cambios.'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                    type="button"
                    className="btn"
                    // No se deshabilita sin cambios: un botón apagado no explica por qué.
                    disabled={guardando}
                    onClick={() => { void guardar(); }}
                >
                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
            </div>
        </div>
    );
}
