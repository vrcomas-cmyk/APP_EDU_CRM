/**
 * Jerarquía: quién ve a quién.
 *
 * Es la tabla que decide el ALCANCE de cada quien —qué visitas de otros aparecen—, así que se
 * edita por jefe completo: se elige un analista y se marca la lista entera de a quién revisa,
 * incluido dejarla vacía. Ver `pdt_jerarquia_guardar` y `jerarquiaParaGuardar`.
 *
 * El modelo es N:N a propósito: dos analistas pueden compartir educadores (uno revisa calidad,
 * otro un proyecto puntual) y eso es correcto, no un error. Lo que hay que evitar es que ese
 * solape quede INVISIBLE — por eso, además de "a quién revisa X", esta pantalla siempre muestra
 * "quién revisa a Y", sea o no Y el analista elegido arriba.
 */

import type { BorradorRBAC } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import { cerrariaCiclo, conSubordinados, jefesDe, quitarJefe } from '../services/borradorRBAC';

interface Props {
    borrador: BorradorRBAC;
    cambiar: (fn: (b: BorradorRBAC) => BorradorRBAC) => void;
    /** Elevado a `GestionAccesos`: si viviera aquí, se olvidaría cada vez que se cambia de
        sub-pestaña y se vuelve, porque este panel se desmonta con ella. */
    analista: string;
    elegirAnalista: (correo: string) => void;
}

export function PanelJerarquia({ borrador, cambiar, analista, elegirAnalista }: Props) {
    const usuarios = borrador.usuarios.filter(u => u.correo);
    // Si el correo elegido ya no existe en la lista (se borró, o aún no se ha elegido nada),
    // cae al primero — pero solo como último recurso, nunca pisando una elección ya hecha.
    const jefe = usuarios.some(u => u.correo === analista) ? analista : (usuarios[0]?.correo || '');

    const actual = usuarios.find(u => u.correo === jefe);

    return (
        <div className="campo">
            <span className="campo-lbl">A quién revisa cada analista</span>
            <p className="ayuda">
                A quién ve un analista determina qué visitas del equipo aparecen en su bandeja de
                revisión y en su tablero. No cambia lo que puede HACER —eso lo dan los roles—,
                solo lo que puede VER y calificar. Dos analistas pueden tener educadores en común
                sin problema: cada uno los revisa por su lado.
            </p>

            <div className="campo-fila">
                <span className="campo-fila-lbl">Analista</span>
                <select
                    className="inp"
                    aria-label="Elegir analista"
                    value={jefe}
                    onChange={e => elegirAnalista(e.target.value)}
                >
                    <option value="">— Elige un analista —</option>
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
                <p className="ayuda">Elige un analista para ver y editar a quién tiene a cargo.</p>
            )}

            <hr className="separador" />

            <span className="campo-lbl">Quién revisa a quién (todas las relaciones)</span>
            <p className="ayuda">
                Antes de mover a alguien, revisa aquí quién ya lo tiene a cargo — así nunca se
                pierde de vista un analista existente al agregar uno nuevo.
            </p>

            <div className="tabla-jerarquia">
                {usuarios.map(u => {
                    const propios = jefesDe(usuarios, u.correo);
                    return (
                        <div key={u.correo} className="admin-fila-col">
                            <div className="admin-fila">
                                <span>{u.nombre || u.correo}</span>
                            </div>
                            <div className="chips">
                                {propios.length === 0 && <span className="ayuda">Nadie lo revisa todavía.</span>}
                                {propios.map(j => (
                                    <span
                                        key={j.correo}
                                        className="chip chip-quitable"
                                        title={`Quitar a ${j.nombre || j.correo} como analista de ${u.nombre || u.correo}`}
                                    >
                                        {j.nombre || j.correo}
                                        <button
                                            type="button"
                                            className="chip-quitar"
                                            aria-label={`Quitar a ${j.nombre || j.correo} como analista de ${u.nombre || u.correo}`}
                                            onClick={() => cambiar(b => ({ ...b, usuarios: quitarJefe(b.usuarios, j.correo, u.correo) }))}
                                        >
                                            ✕
                                        </button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
