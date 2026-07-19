/**
 * Accesos: roles, usuarios y jerarquía en un mismo lugar.
 *
 * No trae su propia barra de guardado: `Administracion.tsx` la monta una sola vez para toda la
 * vista y la conecta al `EstadoRBAC` que se le pasa aquí como prop, para que solo exista un pie
 * de página fijo en toda la pantalla en vez de uno por área.
 */

import { useState } from 'react';
import type { EstadoRBAC } from '../hooks/useRBAC';
import { PanelJerarquia } from './PanelJerarquia';
import { PanelRoles } from './PanelRoles';
import { PanelUsuarios } from './PanelUsuarios';

const SUBPESTANAS = [
    { id: 'roles', etiqueta: 'Roles' },
    { id: 'usuarios', etiqueta: 'Usuarios' },
    { id: 'jerarquia', etiqueta: 'Jerarquía' }
] as const;

type Subpestana = (typeof SUBPESTANAS)[number]['id'];

interface Props {
    estado: EstadoRBAC;
    confirmar: (mensaje: string) => boolean;
}

export function GestionAccesos({ estado, confirmar }: Props) {
    const [sub, setSub] = useState<Subpestana>('roles');
    // Elevado aquí (y no dentro de PanelJerarquia) porque las sub-pestañas se desmontan al
    // cambiar: sin esto, entrar y salir de Jerarquía olvidaba a quién se estaba mirando y volvía
    // siempre al primero de la lista — parecía que "otra persona" se había vuelto el jefe.
    const [analista, setAnalista] = useState<string>('');
    const { borrador, cambiar, cargando, error } = estado;

    if (cargando && borrador.roles.length === 0) {
        return <p className="ayuda">Cargando roles, usuarios y jerarquía…</p>;
    }

    if (error && borrador.roles.length === 0) {
        return (
            <div className="campo es-error">
                <p className="ayuda">No se pudo cargar: {error}</p>
                <button type="button" className="btn-txt" onClick={() => { void estado.recargar(); }}>
                    Reintentar
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="seg admin-tabs" role="group" aria-label="Secciones de acceso">
                {SUBPESTANAS.map(p => (
                    <button
                        key={p.id}
                        type="button"
                        aria-pressed={p.id === sub}
                        onClick={() => setSub(p.id)}
                    >
                        {p.etiqueta}
                    </button>
                ))}
            </div>

            <div className="panel-body">
                {sub === 'roles' && (
                    <PanelRoles borrador={borrador} cambiar={cambiar} confirmar={confirmar} />
                )}
                {sub === 'usuarios' && <PanelUsuarios borrador={borrador} cambiar={cambiar} />}
                {sub === 'jerarquia' && (
                    <PanelJerarquia
                        borrador={borrador}
                        cambiar={cambiar}
                        analista={analista}
                        elegirAnalista={setAnalista}
                    />
                )}
            </div>
        </>
    );
}
