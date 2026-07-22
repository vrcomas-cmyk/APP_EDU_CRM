/**
 * Usuarios: sus roles y si están activos.
 *
 * No hay botón de borrar a un usuario ya existente: `pdt_usuario_guardar` no tiene ese camino,
 * solo `activo:false`. Borrar de la lista solo tiene sentido para deshacer un "+ Invitar" antes
 * de guardar — ver `sinUsuarioNuevo`.
 */

import type { BorradorRBAC } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import {
    conActivoDeUsuario, conCorreoDeUsuario, conNombreDeUsuario, conRolesDeUsuario,
    sinUsuarioNuevo, usuarioNuevo
} from '../services/borradorRBAC';

interface Props {
    borrador: BorradorRBAC;
    cambiar: (fn: (b: BorradorRBAC) => BorradorRBAC) => void;
}

export function PanelUsuarios({ borrador, cambiar }: Props) {
    const rolesDisponibles = borrador.roles.filter(r => r.activo);

    return (
        <div className="campo">
            <span className="campo-lbl">Quién tiene qué rol</span>
            <p className="ayuda">
                Una persona puede tener varios roles a la vez: sus capacidades son la unión de
                todos.
            </p>

            {borrador.usuarios.map((u, i) => {
                const esNuevo = !u.correo && u.roles.length === 0;
                return (
                    <div className="admin-fila-col" key={u.correo || `nuevo-${i}`}>
                        <div className="admin-fila">
                            <input
                                type="text"
                                className="inp"
                                placeholder="Nombre"
                                aria-label={`Nombre de ${u.correo || 'usuario nuevo'}`}
                                value={u.nombre || ''}
                                onChange={e => cambiar(b => ({
                                    ...b, usuarios: conNombreDeUsuario(b.usuarios, i, e.target.value)
                                }))}
                            />
                            <input
                                type="email"
                                className="inp mono"
                                placeholder="correo@degasa.com"
                                aria-label={`Correo de ${u.nombre || 'usuario nuevo'}`}
                                value={u.correo}
                                disabled={!esNuevo}
                                title={esNuevo ? undefined : 'El correo de una cuenta existente no se cambia aquí'}
                                onChange={e => cambiar(b => ({
                                    ...b, usuarios: conCorreoDeUsuario(b.usuarios, i, e.target.value)
                                }))}
                            />
                            <ChipToggle
                                etiqueta={u.activo ? 'Activo' : 'Inactivo'}
                                activo={u.activo}
                                onCambiar={(v) => cambiar(b => ({
                                    ...b, usuarios: conActivoDeUsuario(b.usuarios, i, v)
                                }))}
                            />
                            {!esNuevo && <EstadoInvitacion invitacion={u.invitacion} />}
                            {esNuevo && (
                                <button
                                    type="button"
                                    className="icon-btn"
                                    aria-label="Quitar esta fila"
                                    onClick={() => cambiar(b => ({ ...b, usuarios: sinUsuarioNuevo(b.usuarios, i) }))}
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        <div className="chips">
                            {rolesDisponibles.map(r => (
                                <ChipToggle
                                    key={r.clave}
                                    etiqueta={r.nombre}
                                    activo={u.roles.includes(r.clave)}
                                    onCambiar={(v) => cambiar(b => ({
                                        ...b,
                                        usuarios: conRolesDeUsuario(
                                            b.usuarios, i,
                                            v ? [...u.roles, r.clave] : u.roles.filter(x => x !== r.clave)
                                        )
                                    }))}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => cambiar(b => ({ ...b, usuarios: [...b.usuarios, usuarioNuevo()] }))}
            >
                + Invitar por correo
            </button>
        </div>
    );
}

/**
 * "Sin invitar" (`null`) y "invitación revocada" se ven idénticos si solo se muestra
 * Activo/Inactivo: los dos casos son personas que hoy no entran, pero uno nunca recibió
 * invitación y al otro se le retiró a propósito. Un administrador que investiga "¿por qué
 * esta persona no puede entrar?" necesita distinguirlos, no solo saber que no puede.
 */
function EstadoInvitacion({ invitacion }: { invitacion: string | null }) {
    if (invitacion === 'pendiente') return <span className="pill st-programada">Invitación pendiente</span>;
    if (invitacion === 'revocada') return <span className="pill st-sin-registrar">Invitación revocada</span>;
    if (invitacion === 'aceptada') return null; // el caso normal no necesita distinguirse con una pastilla.
    return <span className="pill neutro">Sin invitar</span>;
}
