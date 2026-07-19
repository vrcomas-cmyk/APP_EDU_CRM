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
import { useFlujos } from '../hooks/useFlujos';
import { PanelTipos } from './PanelTipos';
import { PanelSectores } from './PanelSectores';
import { PanelListas } from './PanelListas';
import { PanelEducadores } from './PanelEducadores';
import { GestionAccesos } from './GestionAccesos';
import { PanelFlujos } from './PanelFlujos';

const PESTANAS = [
    { id: 'tipos', etiqueta: 'Tipos y campos' },
    { id: 'sectores', etiqueta: 'Sectores' },
    { id: 'listas', etiqueta: 'Listas' },
    { id: 'educadores', etiqueta: 'Equipo' }
] as const;

type Pestana = (typeof PESTANAS)[number]['id'];

/**
 * Tres áreas de primer nivel, no una pila de pestañas planas: catálogos, accesos y flujos de
 * revisión guardan contra backends distintos (`guardarCatalogosAdmin` / `guardarRoles`+
 * `guardarUsuarios` / `guardarFlujosAdmin`) y cada uno tiene su propio ciclo de borrador.
 * Mezclarlos en una sola barra de guardado confundiría cuál botón sube qué.
 */
const AREAS = [
    { id: 'catalogos', etiqueta: 'Catálogos' },
    { id: 'accesos', etiqueta: 'Accesos' },
    { id: 'flujos', etiqueta: 'Flujos' }
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
    // La carga es perezosa (`activo`): mientras el administrador no entra a esa área, no vale
    // la pena gastar la ida de red en datos que quizás no va a mirar.
    const rbac = useRBAC({ activo: area === 'accesos', avisar, confirmar: preguntar, onGuardado });
    const flujos = useFlujos({ activo: area === 'flujos', avisar, confirmar: preguntar, onGuardado });

    const activo = area === 'catalogos' ? catalogos : area === 'accesos' ? rbac : flujos;

    const descripciones: Record<Area, string> = {
        catalogos: 'Catálogos compartidos por todos los educadores.',
        accesos: 'Quién puede hacer qué, y quién ve a quién.',
        flujos: 'Qué se revisa en cada flujo, y con qué veredictos.'
    };

    return (
        <div className="vista vista-admin">
            <header className="vista-head">
                <h2>Administración</h2>
                <p className="eyebrow">{descripciones[area]}</p>
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

            {area === 'catalogos' && (
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
            )}

            {area === 'accesos' && <GestionAccesos estado={rbac} confirmar={preguntar} />}

            {area === 'flujos' && (
                <div className="panel-body">
                    {flujos.cargando && flujos.borrador.flujos.length === 0 ? (
                        <p className="ayuda">Cargando flujos de revisión…</p>
                    ) : flujos.error && flujos.borrador.flujos.length === 0 ? (
                        <div className="campo es-error">
                            <p className="ayuda">No se pudo cargar: {flujos.error}</p>
                            <button type="button" className="btn-txt" onClick={() => { void flujos.recargar(); }}>
                                Reintentar
                            </button>
                        </div>
                    ) : (
                        <PanelFlujos borrador={flujos.borrador} cambiar={flujos.cambiar} confirmar={preguntar} />
                    )}
                </div>
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
                <button
                    type="button"
                    className="btn-txt"
                    disabled={!activo.sucio || activo.guardando}
                    onClick={() => {
                        if (preguntar('¿Descartar los cambios sin guardar?')) activo.descartar();
                    }}
                >
                    Descartar
                </button>

                <span className="ayuda">
                    {'cargando' in activo && activo.cargando
                        ? 'Cargando…'
                        : activo.sucio ? 'Hay cambios sin guardar.' : 'Sin cambios.'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                    type="button"
                    className="btn"
                    // No se deshabilita sin cambios: un botón apagado no explica por qué.
                    disabled={activo.guardando || ('cargando' in activo && activo.cargando && area !== 'catalogos')}
                    onClick={() => { void activo.guardar(); }}
                >
                    {activo.guardando ? 'Guardando…' : 'Guardar cambios'}
                </button>
            </div>
        </div>
    );
}
