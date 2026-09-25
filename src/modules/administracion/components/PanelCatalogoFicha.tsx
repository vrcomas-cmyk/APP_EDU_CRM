/**
 * Un catálogo ficha+activo genérico: clave, nombre, descripción, orden, activo, borrado
 * protegido por conteo de uso. Extraído de `PanelFlujos.tsx`/`PanelRoles.tsx` (Fase 5 del plan de
 * trabajo) para que los catálogos de Estrategia (Tipos y Etapas) no dupliquen la misma ficha
 * desplegable que ya existía dos veces — y para que el próximo catálogo de este tipo no la
 * duplique una tercera.
 *
 * No cubre lo que sí varía entre Flujos y Roles (veredictos propios, capacidades, herencia): eso
 * sigue viviendo en sus propios paneles. Esto es solo la parte que de verdad era idéntica.
 */

import type { CatalogoFicha } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import { conCampoFicha, fichaNueva } from '../services/borradorCatalogoFicha';

interface Props {
    titulo: string;
    ayuda: string;
    /** Cómo se nombra una fila en los mensajes: "flujo", "tipo de estrategia", "etapa"… */
    etiquetaFila: string;
    fichas: CatalogoFicha[];
    abierta: string | null;
    onAbrir: (clave: string | null) => void;
    onCambiar: (fn: (fichas: CatalogoFicha[]) => CatalogoFicha[]) => void;
    confirmar: (mensaje: string) => boolean;
}

export function PanelCatalogoFicha({ titulo, ayuda, etiquetaFila, fichas, abierta, onAbrir, onCambiar, confirmar }: Props) {
    const editarFicha = (clave: string, fn: (f: CatalogoFicha) => CatalogoFicha) => {
        onCambiar(fs => fs.map(f => (f.clave === clave ? fn(f) : f)));
    };

    const borrarFicha = (f: CatalogoFicha) => {
        if ((f.usos || 0) > 0) {
            confirmar(`"${f.nombre}" ya lo usan ${f.usos} registro(s). Desactívalo para que deje `
                + 'de ofrecerse en vez de borrarlo: borrarlo dejaría ese histórico sin a qué '
                + 'referirse.');
            return;
        }
        const ok = confirmar(`¿Borrar "${f.nombre}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        onCambiar(fs => fs.filter(x => x.clave !== f.clave));
        if (abierta === f.clave) onAbrir(null);
    };

    return (
        <div className="campo">
            <span className="campo-lbl">{titulo}</span>
            <p className="ayuda">{ayuda}</p>

            {fichas.map(f => (
                <FichaCatalogo
                    key={f.clave || f.nombre}
                    ficha={f}
                    etiquetaFila={etiquetaFila}
                    abierta={abierta === f.clave}
                    onAbrir={(v) => onAbrir(v ? f.clave : null)}
                    onCambiar={(fn) => editarFicha(f.clave, fn)}
                    onBorrar={() => borrarFicha(f)}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => {
                    const nueva = fichaNueva();
                    onCambiar(fs => [...fs, nueva]);
                    onAbrir(nueva.clave);
                }}
            >
                + Agregar {etiquetaFila}
            </button>
        </div>
    );
}

interface FichaProps {
    ficha: CatalogoFicha;
    etiquetaFila: string;
    abierta: boolean;
    onAbrir: (abierta: boolean) => void;
    onCambiar: (fn: (f: CatalogoFicha) => CatalogoFicha) => void;
    onBorrar: () => void;
}

function FichaCatalogo({ ficha, etiquetaFila, abierta, onAbrir, onCambiar, onBorrar }: FichaProps) {
    return (
        <details
            className="tipo-ficha"
            open={abierta}
            onToggle={e => onAbrir((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="tipo-sum">
                <span className={'tipo-nombre' + (ficha.nombre ? '' : ' es-vacio')}>
                    {ficha.nombre || `${etiquetaFila.charAt(0).toUpperCase()}${etiquetaFila.slice(1)} sin nombre`}
                </span>
                <span className="sector-cuenta">
                    {ficha.usos || 0} uso{(ficha.usos || 0) === 1 ? '' : 's'}
                    {!ficha.activo && ' · inactivo'}
                </span>
            </summary>

            <div className="tipo-cuerpo">
                <div className="admin-fila">
                    <input
                        type="text"
                        className="inp"
                        placeholder="Nombre visible"
                        aria-label={`Nombre de ${ficha.nombre}`}
                        value={ficha.nombre}
                        onChange={e => onCambiar(f => conCampoFicha(f, 'nombre', e.target.value))}
                    />
                    <input
                        type="text"
                        className="inp mono"
                        placeholder="clave_interna"
                        aria-label={`Clave de ${ficha.nombre}`}
                        value={ficha.clave}
                        disabled={(ficha.usos || 0) > 0}
                        title={(ficha.usos || 0) > 0
                            ? 'Ya lo usan registros existentes; cambiar la clave los dejaría huérfanos.'
                            : undefined}
                        onChange={e => onCambiar(f => conCampoFicha(f, 'clave', e.target.value.trim().toLowerCase()))}
                    />
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Borrar ${ficha.nombre || etiquetaFila}`}
                        onClick={onBorrar}
                        disabled={(ficha.usos || 0) > 0}
                        title={(ficha.usos || 0) > 0 ? 'Ya lo usan registros existentes; desactívalo en su lugar' : 'Borrar'}
                    >
                        ✕
                    </button>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Descripción</span>
                    <input
                        type="text"
                        className="inp"
                        aria-label={`Descripción de ${ficha.nombre}`}
                        value={ficha.descripcion || ''}
                        onChange={e => onCambiar(f => conCampoFicha(f, 'descripcion', e.target.value))}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Orden</span>
                    <input
                        type="number"
                        className="inp mono"
                        aria-label={`Orden de ${ficha.nombre}`}
                        value={ficha.orden}
                        onChange={e => onCambiar(f => conCampoFicha(f, 'orden', Number(e.target.value) || 0))}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Activo</span>
                    <ChipToggle
                        etiqueta={ficha.activo ? 'Activo' : 'Inactivo'}
                        activo={ficha.activo}
                        onCambiar={(v) => onCambiar(f => conCampoFicha(f, 'activo', v))}
                    />
                </div>
            </div>
        </details>
    );
}
