/**
 * Roles y sus capacidades.
 *
 * Cada rol se edita como una ficha desplegable (mismo patrón que `PanelTipos`): con veinte
 * capacidades por rol y varios roles, abrir todo de golpe da una pared de casillas en la que
 * no se encuentra nada.
 */

import { useState } from 'react';
import type { BorradorRBAC, RolAdmin } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import {
    candidatosDeHerencia, capacidadesPorGrupo, conCapacidad, duplicarRol, rolNuevo
} from '../services/borradorRBAC';

interface Props {
    borrador: BorradorRBAC;
    cambiar: (fn: (b: BorradorRBAC) => BorradorRBAC) => void;
    confirmar: (mensaje: string) => boolean;
}

export function PanelRoles({ borrador, cambiar, confirmar }: Props) {
    const [abierto, setAbierto] = useState<string | null>(null);
    const grupos = capacidadesPorGrupo(borrador.capacidades);

    const editarRol = (clave: string, fn: (r: RolAdmin) => RolAdmin) => {
        cambiar(b => ({ ...b, roles: b.roles.map(r => (r.clave === clave ? fn(r) : r)) }));
    };

    const borrarRol = (r: RolAdmin) => {
        if (r.usuarios > 0) {
            confirmar(`"${r.nombre}" lo tienen ${r.usuarios} persona(s). Cámbiales el rol antes `
                + 'de borrarlo, o desactívalo para que deje de ofrecerse.');
            return;
        }
        if (r.herederos > 0) {
            confirmar(`De "${r.nombre}" heredan ${r.herederos} rol(es). Quítales la herencia `
                + 'antes de borrarlo.');
            return;
        }
        const ok = confirmar(`¿Borrar el rol "${r.nombre}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        cambiar(b => ({ ...b, roles: b.roles.filter(x => x.clave !== r.clave) }));
        if (abierto === r.clave) setAbierto(null);
    };

    const duplicar = (r: RolAdmin) => {
        const nuevo = duplicarRol(r, clave => borrador.roles.some(x => x.clave === clave));
        cambiar(b => ({ ...b, roles: [...b.roles, nuevo] }));
        setAbierto(nuevo.clave);
    };

    return (
        <div className="campo">
            <span className="campo-lbl">Roles y sus capacidades</span>
            <p className="ayuda">
                Cada rol concede capacidades. Un rol puede heredar de otro: cambiar el padre
                actualiza a todos los que heredan de él.
            </p>

            {borrador.roles.map(r => (
                <FichaRol
                    key={r.clave || r.nombre}
                    rol={r}
                    roles={borrador.roles}
                    grupos={grupos}
                    abierta={abierto === r.clave}
                    onAbrir={(v) => setAbierto(v ? r.clave : null)}
                    onCambiar={(fn) => editarRol(r.clave, fn)}
                    onBorrar={() => borrarRol(r)}
                    onDuplicar={() => duplicar(r)}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => {
                    const nuevo = rolNuevo();
                    cambiar(b => ({ ...b, roles: [...b.roles, nuevo] }));
                    setAbierto(nuevo.clave);
                }}
            >
                + Nuevo rol
            </button>
        </div>
    );
}

interface FichaProps {
    rol: RolAdmin;
    roles: RolAdmin[];
    grupos: Array<[string, import('@core/tipos').CapacidadAdmin[]]>;
    abierta: boolean;
    onAbrir: (abierta: boolean) => void;
    onCambiar: (fn: (r: RolAdmin) => RolAdmin) => void;
    onBorrar: () => void;
    onDuplicar: () => void;
}

function FichaRol({ rol, roles, grupos, abierta, onAbrir, onCambiar, onBorrar, onDuplicar }: FichaProps) {
    const heredadas = rol.efectivas.filter(c => !rol.capacidades.includes(c));
    const padre = roles.find(r => r.clave === rol.hereda_de);

    return (
        <details
            className="tipo-ficha"
            open={abierta}
            onToggle={e => onAbrir((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="tipo-sum">
                <span className={'tipo-nombre' + (rol.nombre ? '' : ' es-vacio')}>
                    {rol.nombre || 'Rol sin nombre'}
                </span>
                <span className="sector-cuenta">
                    {rol.capacidades.length} capacidad{rol.capacidades.length === 1 ? '' : 'es'}
                    {!rol.activo && ' · inactivo'}
                </span>
            </summary>

            <div className="tipo-cuerpo">
                <div className="admin-fila">
                    <input
                        type="text"
                        className="inp"
                        placeholder="Nombre visible"
                        aria-label={`Nombre del rol ${rol.nombre}`}
                        value={rol.nombre}
                        onChange={e => onCambiar(r => ({ ...r, nombre: e.target.value }))}
                    />
                    <input
                        type="text"
                        className="inp mono"
                        placeholder="clave_del_rol"
                        aria-label={`Clave del rol ${rol.nombre}`}
                        value={rol.clave}
                        disabled={rol.sistema}
                        onChange={e => onCambiar(r => ({ ...r, clave: e.target.value.trim().toLowerCase() }))}
                    />
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Duplicar ${rol.nombre || 'rol'}`}
                        onClick={onDuplicar}
                        title="Duplicar"
                    >
                        ⧉
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Borrar ${rol.nombre || 'rol'}`}
                        onClick={onBorrar}
                        disabled={rol.sistema}
                        title={rol.sistema ? 'Los roles del sistema no se pueden borrar' : 'Borrar'}
                    >
                        ✕
                    </button>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Descripción</span>
                    <input
                        type="text"
                        className="inp"
                        aria-label={`Descripción del rol ${rol.nombre}`}
                        value={rol.descripcion || ''}
                        onChange={e => onCambiar(r => ({ ...r, descripcion: e.target.value || null }))}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Hereda de</span>
                    <select
                        className="inp"
                        aria-label={`De qué rol hereda ${rol.nombre}`}
                        value={rol.hereda_de || ''}
                        onChange={e => onCambiar(r => ({ ...r, hereda_de: e.target.value || null }))}
                    >
                        <option value="">— Ninguno —</option>
                        {candidatosDeHerencia(roles, rol.clave).map(r => (
                            <option value={r.clave} key={r.clave}>{r.nombre}</option>
                        ))}
                    </select>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Activo</span>
                    <ChipToggle
                        etiqueta={rol.activo ? 'Activo' : 'Inactivo'}
                        activo={rol.activo}
                        onCambiar={(v) => {
                            if (rol.sistema && !v) return; // el servidor lo rechazaría igual
                            onCambiar(r => ({ ...r, activo: v }));
                        }}
                    />
                </div>

                <span className="campo-lbl" style={{ marginTop: 10 }}>Capacidades</span>
                {grupos.map(([grupo, capacidades]) => (
                    <div className="campo" key={grupo}>
                        <span className="ayuda">{grupo}</span>
                        <div className="chips">
                            {capacidades.map(c => (
                                <ChipToggle
                                    key={c.clave}
                                    etiqueta={c.nombre}
                                    activo={rol.capacidades.includes(c.clave)}
                                    onCambiar={(v) => onCambiar(r => conCapacidad(r, c.clave, v))}
                                />
                            ))}
                        </div>
                    </div>
                ))}

                {heredadas.length > 0 && (
                    <div className="campo">
                        <span className="ayuda">
                            Heredadas de {padre?.nombre || rol.hereda_de} (no se editan aquí):
                        </span>
                        <div className="chips">
                            {heredadas.map(clave => {
                                const cap = borradorCapacidad(clave, grupos);
                                return <span className="chip on admin-chip" key={clave}>{cap}</span>;
                            })}
                        </div>
                    </div>
                )}
            </div>
        </details>
    );
}

function borradorCapacidad(
    clave: string, grupos: Array<[string, import('@core/tipos').CapacidadAdmin[]]>
): string {
    for (const [, capacidades] of grupos) {
        const c = capacidades.find(x => x.clave === clave);
        if (c) return c.nombre;
    }
    return clave;
}
