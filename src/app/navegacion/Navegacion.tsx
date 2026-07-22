/**
 * El selector de módulos.
 *
 * Riel vertical a la izquierda en escritorio; en móvil, la MISMA lista se convierte en barra
 * inferior. No es una decisión estética: la app se usa de pie, con una mano, dentro de un
 * hospital, y ahí el borde inferior es lo único que alcanza el pulgar sin recolocar el
 * teléfono. Arriba estaría fuera de alcance justo cuando más prisa hay.
 *
 * Es el mismo componente para los dos: duplicarlo garantizaría que un módulo nuevo apareciera
 * en uno y no en el otro.
 */

import { modulosDisponibles, type ClaveModulo } from './modulos';
import { Icono, SpriteIconos } from '@shared/components/Icono';

interface Props {
    activo: ClaveModulo;
    onElegir: (clave: ClaveModulo) => void;
}

export function Navegacion({ activo, onElegir }: Props) {
    const modulos = modulosDisponibles();

    // Con un solo módulo el selector no selecciona nada: ocuparía espacio para no dar opción.
    if (modulos.length <= 1) return null;

    return (
        <>
            <SpriteIconos />
            <nav className="nav-modulos" aria-label="Módulos">
            {modulos.map(m => {
                const tieneInsignia = typeof m.insignia === 'function';
                const n = tieneInsignia ? m.insignia!() : null;
                const esActivo = m.clave === activo;

                return (
                    <button
                        key={m.clave}
                        type="button"
                        className={'nav-item' + (esActivo ? ' is-activo' : '')}
                        aria-current={esActivo ? 'page' : undefined}
                        onClick={() => onElegir(m.clave)}
                    >
                        <span className="nav-ico" aria-hidden="true">
                            <Icono clave={m.icono} tam={18} />
                        </span>

                        {/* Dos rótulos: el largo en el riel, el corto en la barra inferior.
                            CSS elige cuál se ve; el texto SIEMPRE está, porque un icono solo
                            no dice qué hay detrás. */}
                        <span className="nav-txt">{m.nombre}</span>
                        <span className="nav-txt-corto">{m.corto}</span>

                        {/* Cuatro estados, no tres — la diferencia importa:
                            - módulo SIN insignia (no tiene `insignia()`)  → nada
                            - insignia() devuelve `undefined` ("cargando")  → badge pulsante
                            - insignia() devuelve 0                         → nada, pero por
                                                                              filtrado real, no
                                                                              esperando datos
                            - insignia() devuelve n > 0                    → número con aria-label
                          Confundir "sin insignia" con "cargando" pinta pulsante en módulos que
                          no tienen conteo — Calendario siempre lo tendría, y eso engaña. */}
                        {tieneInsignia && n === undefined && (
                            <span className="nav-badge is-cargando" title="Cargando…"
                                  aria-hidden="true" />
                        )}
                        {tieneInsignia && typeof n === 'number' && n > 0 && (
                            <span className="nav-badge" aria-label={`${n} pendientes`}>
                                {n > 99 ? '99+' : n}
                            </span>
                        )}
                    </button>
                );
            })}
            </nav>
        </>
    );
}
