/**
 * Jerarquía: quién ve a quién.
 *
 * Es la tabla que decide el ALCANCE de cada quien —qué visitas de otros aparecen—, así que se
 * edita por jefe completo: se elige un jefe y se marca la lista entera de quién ve, incluido
 * dejarla vacía. Ver `pdt_jerarquia_guardar` y `jerarquiaParaGuardar`.
 */

import { useState } from 'react';
import type { BorradorRBAC } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import { cerrariaCiclo, conSubordinados } from '../services/borradorRBAC';

interface Props {
    borrador: BorradorRBAC;
    cambiar: (fn: (b: BorradorRBAC) => BorradorRBAC) => void;
}

export function PanelJerarquia({ borrador, cambiar }: Props) {
    const usuarios = borrador.usuarios.filter(u => u.correo);
    const [jefe, setJefe] = useState<string>(usuarios[0]?.correo || '');

    const actual = usuarios.find(u => u.correo === jefe);

    return (
        <div className="campo">
            <span className="campo-lbl">A quién ve cada jefe</span>
            <p className="ayuda">
                A quién ve un jefe determina qué visitas del equipo aparecen en su tablero y en
                revisión. No cambia lo que puede HACER —eso lo dan los roles—, solo lo que puede
                VER.
            </p>

            <div className="campo-fila">
                <span className="campo-fila-lbl">Jefe</span>
                <select
                    className="inp"
                    aria-label="Elegir jefe"
                    value={jefe}
                    onChange={e => setJefe(e.target.value)}
                >
                    <option value="">— Elige un jefe —</option>
                    {usuarios.map(u => (
                        <option value={u.correo} key={u.correo}>{u.nombre || u.correo}</option>
                    ))}
                </select>
            </div>

            {actual && (
                <div className="chips">
                    {usuarios.filter(u => u.correo !== jefe).map(u => {
                        const marcado = actual.subordinados.includes(u.correo);
                        const bloqueado = !marcado && cerrariaCiclo(usuarios, jefe, u.correo);
                        return (
                            <span key={u.correo} title={bloqueado ? 'Ya está por encima en la jerarquía; agregarlo haría un ciclo.' : undefined}>
                                <ChipToggle
                                    etiqueta={u.nombre || u.correo}
                                    activo={marcado}
                                    onCambiar={(v) => {
                                        if (v && bloqueado) return;
                                        const subordinados = v
                                            ? [...actual.subordinados, u.correo]
                                            : actual.subordinados.filter(c => c !== u.correo);
                                        cambiar(b => ({ ...b, usuarios: conSubordinados(b.usuarios, jefe, subordinados) }));
                                    }}
                                />
                            </span>
                        );
                    })}
                </div>
            )}

            {!actual && usuarios.length > 0 && (
                <p className="ayuda">Elige un jefe para ver y editar a quién tiene a cargo.</p>
            )}
        </div>
    );
}
