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
import { useRBAC } from '../hooks/useRBAC';
import { PanelTipos } from './PanelTipos';
import { PanelSectores } from './PanelSectores';
import { PanelListas } from './PanelListas';
import { PanelEducadores } from './PanelEducadores';
import { GestionAccesos } from './GestionAccesos';

const PESTANAS = [
    { id: 'tipos', etiqueta: 'Tipos y campos' },
    { id: 'sectores', etiqueta: 'Sectores' },
    { id: 'listas', etiqueta: 'Listas' },
    { id: 'educadores', etiqueta: 'Equipo' }
] as const;

type Pestana = (typeof PESTANAS)[number]['id'];

/**
 * Dos áreas de primer nivel, no ocho pestañas planas: catálogos y accesos guardan contra
 * backends distintos (`guardarCatalogosAdmin` vs `guardarRoles`/`guardarUsuarios`) y cada uno
 * tiene su propio ciclo de borrador. Mezclarlos en una sola barra de guardado confundiría cuál
 * botón sube qué.
 */
const AREAS = [
    { id: 'catalogos', etiqueta: 'Catálogos' },
    { id: 'accesos', etiqueta: 'Accesos' }
] as const;

type Area = (typeof AREAS)[number]['id'];

interface Props {
    avisar?: Avisar;
    /** Se inyectan para poder probarlos: `confirm` bloquea el hilo y colgaría la suite. */
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export function Administracion({ avisar, confirmar, onGuardado }: Props) {
    const [area, setArea] = useState<Area>('catalogos');
    const [pestana, setPestana] = useState<Pestana>('tipos');
    const preguntar = confirmar ?? ((m: string) => window.confirm(m));

    const catalogos = useAdmin({ avisar, confirmar: preguntar, onGuardado });
    // La carga es perezosa (`activo`): mientras el administrador no entra a Accesos, no vale la
    // pena gastar la ida de red en datos que quizás no va a mirar.
    const rbac = useRBAC({ activo: area === 'accesos', avisar, confirmar: preguntar, onGuardado });

    return (
        <div className="vista vista-admin">
            <header className="vista-head">
                <h2>Administración</h2>
                <p className="eyebrow">
                    {area === 'catalogos'
                        ? 'Catálogos compartidos por todos los educadores.'
                        : 'Quién puede hacer qué, y quién ve a quién.'}
                </p>
            </header>

            <div className="seg admin-area" role="group" aria-label="Área">
                {AREAS.map(a => (
                    <button
                        key={a.id}
                        type="button"
                        aria-pressed={a.id === area}
                        onClick={() => setArea(a.id)}
                    >
                        {a.etiqueta}
                    </button>
                ))}
            </div>

            {area === 'catalogos' ? (
                <>
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
                            <PanelTipos borrador={catalogos.borrador} cambiar={catalogos.cambiar} confirmar={preguntar} />
                        )}
                        {pestana === 'sectores' && (
                            <PanelSectores borrador={catalogos.borrador} cambiar={catalogos.cambiar} />
                        )}
                        {pestana === 'listas' && (
                            <PanelListas borrador={catalogos.borrador} cambiar={catalogos.cambiar} />
                        )}
                        {pestana === 'educadores' && (
                            <PanelEducadores borrador={catalogos.borrador} cambiar={catalogos.cambiar} />
                        )}
                    </div>
                </>
            ) : (
                <GestionAccesos estado={rbac} confirmar={preguntar} />
            )}

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
                {area === 'catalogos' ? (
                    <>
                        <button
                            type="button"
                            className="btn-txt"
                            disabled={!catalogos.sucio || catalogos.guardando}
                            onClick={() => {
                                if (preguntar('¿Descartar los cambios sin guardar?')) catalogos.descartar();
                            }}
                        >
                            Descartar
                        </button>

                        <span className="ayuda">
                            {catalogos.sucio ? 'Hay cambios sin guardar.' : 'Sin cambios.'}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                            type="button"
                            className="btn"
                            // No se deshabilita sin cambios: un botón apagado no explica por qué.
                            disabled={catalogos.guardando}
                            onClick={() => { void catalogos.guardar(); }}
                        >
                            {catalogos.guardando ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            className="btn-txt"
                            disabled={!rbac.sucio || rbac.guardando}
                            onClick={() => {
                                if (preguntar('¿Descartar los cambios sin guardar?')) rbac.descartar();
                            }}
                        >
                            Descartar
                        </button>

                        <span className="ayuda">
                            {rbac.cargando ? 'Cargando…' : rbac.sucio ? 'Hay cambios sin guardar.' : 'Sin cambios.'}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                            type="button"
                            className="btn"
                            disabled={rbac.guardando || rbac.cargando}
                            onClick={() => { void rbac.guardar(); }}
                        >
                            {rbac.guardando ? 'Guardando…' : 'Guardar cambios'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
