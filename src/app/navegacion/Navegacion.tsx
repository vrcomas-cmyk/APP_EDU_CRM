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

interface Props {
    activo: ClaveModulo;
    onElegir: (clave: ClaveModulo) => void;
}

export function Navegacion({ activo, onElegir }: Props) {
    const modulos = modulosDisponibles();

    // Con un solo módulo el selector no selecciona nada: ocuparía espacio para no dar opción.
    if (modulos.length <= 1) return null;

    return (
        <nav className="nav-modulos" aria-label="Módulos">
            {modulos.map(m => {
                const n = m.insignia?.() ?? 0;
                const esActivo = m.clave === activo;

                return (
                    <button
                        key={m.clave}
                        type="button"
                        className={'nav-item' + (esActivo ? ' is-activo' : '')}
                        aria-current={esActivo ? 'page' : undefined}
                        onClick={() => onElegir(m.clave)}
                    >
                        <span className="nav-ico" aria-hidden="true">{m.icono}</span>

                        {/* Dos rótulos: el largo en el riel, el corto en la barra inferior.
                            CSS elige cuál se ve; el texto SIEMPRE está, porque un icono solo
                            no dice qué hay detrás. */}
                        <span className="nav-txt">{m.nombre}</span>
                        <span className="nav-txt-corto">{m.corto}</span>

                        {n > 0 && (
                            <span className="nav-badge" aria-label={`${n} pendientes`}>
                                {n > 99 ? '99+' : n}
                            </span>
                        )}
                    </button>
                );
            })}
        </nav>
    );
}
