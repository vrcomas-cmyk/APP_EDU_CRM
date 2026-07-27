/**
 * Sectores por gerente: qué línea de producto (GASAS, SUTURAS, CARDINAL…) puede ver cada
 * gerente en el reporte de Actividades — del equipo, no de lo propio, que siempre se ve.
 *
 * Tiene su propio pie de guardado, a diferencia de Roles/Usuarios/Jerarquía: esas comparten el
 * `EstadoRBAC` de toda la pantalla de Accesos porque cuelgan del mismo `leerRBAC`/`guardarRoles`
 * +`guardarUsuarios`; esto es un backend propio (`pdt_gerente_sector`) con su propio ciclo, y
 * mezclarlo forzaría a `useRBAC` a saber de sectores.
 */

import { useMemo, useState } from 'react';
import { sectoresDelCatalogo } from '@core/puente';
import type { BorradorRBAC, GerenteSector } from '@core/tipos';
import type { EstadoSectoresGerente } from '../hooks/useSectoresGerente';
import { ChipToggle } from '@shared/components/ChipToggle';

interface Props {
    estado: EstadoSectoresGerente;
    /** Para ofrecer a quién agregar: los usuarios ya cargados por Accesos, no una ida aparte. */
    usuarios: BorradorRBAC['usuarios'];
}

export function PanelSectoresGerente({ estado, usuarios }: Props) {
    const { borrador, cambiar, cargando, error, guardando, guardar, descartar, sucio } = estado;
    const [nuevoCorreo, setNuevoCorreo] = useState('');

    const sectores = useMemo(() => sectoresDelCatalogo(), []);

    const yaAsignados = useMemo(() => new Set(borrador.map(g => g.gerente_correo)), [borrador]);
    const candidatos = useMemo(
        () => usuarios.filter(u => u.correo && u.activo && !yaAsignados.has(u.correo)),
        [usuarios, yaAsignados]
    );

    if (cargando && borrador.length === 0) {
        return <p className="ayuda">Cargando sectores por gerente…</p>;
    }

    if (error && borrador.length === 0) {
        return <div className="campo es-error"><p className="ayuda">No se pudo cargar: {error}</p></div>;
    }

    const nombreDe = (correo: string) => usuarios.find(u => u.correo === correo)?.nombre || correo;

    return (
        <div className="campo">
            <span className="campo-lbl">Qué sector ve cada gerente</span>
            <p className="ayuda">
                Un gerente siempre ve lo que él mismo capturó, en cualquier sector. Esto decide
                además qué del EQUIPO ve en el reporte de Actividades: solo lo de los sectores
                marcados aquí. Sin ninguno marcado, no ve nada del equipo — hay que asignar al
                menos uno para que el reporte muestre algo más que lo propio.
            </p>

            {borrador.map(g => (
                <div className="admin-fila-col" key={g.gerente_correo}>
                    <div className="admin-fila">
                        <span className="dato-val">{nombreDe(g.gerente_correo)}</span>
                        <span className="ayuda mono">{g.gerente_correo}</span>
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Quitar a ${nombreDe(g.gerente_correo)} de esta lista`}
                            title="Quitar de la lista (deja de tener sectores asignados)"
                            onClick={() => cambiar(b => b.filter(x => x.gerente_correo !== g.gerente_correo))}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="chips">
                        {sectores.map(s => (
                            <ChipToggle
                                key={s}
                                etiqueta={s}
                                activo={g.sectores.includes(s)}
                                onCambiar={(v) => cambiar(b => b.map(x => x.gerente_correo !== g.gerente_correo ? x : {
                                    ...x,
                                    sectores: v ? [...x.sectores, s] : x.sectores.filter(y => y !== s)
                                }))}
                            />
                        ))}
                    </div>
                </div>
            ))}

            {borrador.length === 0 && (
                <p className="ayuda">Todavía no hay ningún gerente con sectores asignados.</p>
            )}

            <div className="campo-fila">
                <select
                    className="inp"
                    aria-label="Elegir a quién agregar"
                    value={nuevoCorreo}
                    onChange={(e) => setNuevoCorreo(e.target.value)}
                >
                    <option value="">— Elige un usuario —</option>
                    {candidatos.map(u => (
                        <option value={u.correo} key={u.correo}>{u.nombre || u.correo}</option>
                    ))}
                </select>
                <button
                    type="button"
                    className="btn-dashed"
                    disabled={!nuevoCorreo}
                    onClick={() => {
                        cambiar(b => [...b, { gerente_correo: nuevoCorreo, sectores: [] } as GerenteSector]);
                        setNuevoCorreo('');
                    }}
                >
                    + Agregar
                </button>
            </div>

            <div className="campo-fila" style={{ justifyContent: 'flex-end' }}>
                <button
                    type="button"
                    className="btn-txt"
                    disabled={!sucio || guardando}
                    onClick={() => { if (window.confirm('¿Descartar los cambios sin guardar?')) descartar(); }}
                >
                    Descartar
                </button>
                <button
                    type="button"
                    className="btn"
                    disabled={guardando || !sucio}
                    onClick={() => { void guardar(); }}
                >
                    {guardando ? 'Guardando…' : 'Guardar sectores por gerente'}
                </button>
            </div>

            {error && <p className="ayuda es-error">{error}</p>}
        </div>
    );
}
