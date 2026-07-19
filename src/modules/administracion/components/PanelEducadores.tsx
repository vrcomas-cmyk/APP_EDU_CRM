/**
 * El equipo y quién puede administrar.
 *
 * Quién es administrador se decide por CORREO, porque el correo es lo que la sesión de Google
 * verifica; el nombre se escribe a mano y dos personas pueden llamarse igual.
 */

import type { BorradorCatalogo, Educador } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import { conAdmin, conCorreoDeEducador, educadorNuevo, sinEducador } from '../services/borrador';

interface Props {
    borrador: BorradorCatalogo;
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
}

export function PanelEducadores({ borrador, cambiar }: Props) {
    return (
        <div className="campo">
            <span className="campo-lbl">Educadores</span>

            {borrador.educadores.map((e, i) => (
                <FilaEducador
                    key={i}
                    educador={e}
                    esAdmin={!!e.correo && borrador.admins.includes(e.correo)}
                    onNombre={(nombre) => cambiar(b => ({
                        ...b,
                        educadores: b.educadores.map((x, j) => (j === i ? { ...x, nombre } : x))
                    }))}
                    onCorreo={(correo) => cambiar(b => conCorreoDeEducador(b, i, correo))}
                    onAdmin={(v) => cambiar(b => conAdmin(b, b.educadores[i]?.correo || '', v))}
                    onBorrar={() => cambiar(b => sinEducador(b, i))}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => cambiar(b => ({ ...b, educadores: [...b.educadores, educadorNuevo()] }))}
            >
                + Nuevo educador
            </button>
        </div>
    );
}

interface FilaProps {
    educador: Educador;
    esAdmin: boolean;
    onNombre: (v: string) => void;
    onCorreo: (v: string) => void;
    onAdmin: (v: boolean) => void;
    onBorrar: () => void;
}

function FilaEducador({ educador, esAdmin, onNombre, onCorreo, onAdmin, onBorrar }: FilaProps) {
    return (
        <div className="admin-fila">
            <input
                type="text"
                className="inp"
                placeholder="Nombre"
                aria-label="Nombre del educador"
                value={educador.nombre}
                onChange={e => onNombre(e.target.value)}
            />

            <input
                type="email"
                className="inp mono"
                placeholder="correo@degasa.com"
                aria-label="Correo del educador"
                value={educador.correo}
                onChange={e => onCorreo(e.target.value)}
            />

            <ChipToggle etiqueta="Admin" activo={esAdmin} onCambiar={onAdmin} />

            <button
                type="button"
                className="icon-btn"
                aria-label={`Borrar ${educador.nombre || 'educador'}`}
                onClick={onBorrar}
            >
                ✕
            </button>
        </div>
    );
}
