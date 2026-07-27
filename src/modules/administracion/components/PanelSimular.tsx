/**
 * "Ver como": probar la app tal cual la ve otro usuario o rol, sin cerrar sesión.
 *
 * Solo lectura por diseño — ver `postear` en `appsScript.ts` y `entrarSimulacionUsuario` /
 * `entrarSimulacionRol` en `js/permisos.js`. Entrar y salir recargan la página: es más simple y
 * más seguro que desmontar módulo por módulo, y evita que un singleton de otro módulo se quede
 * con datos de la identidad anterior (mismo criterio que ya usa `js/app.js` al cerrar sesión).
 *
 * Dos vías, con fidelidad distinta:
 *  - Por USUARIO: pide el perfil real de ese correo. Alcance, zonas y clientes_extra quedan
 *    coherentes entre sí — es fiel también en DATOS, no solo en menús.
 *  - Por ROL: arma un perfil sintético con las capacidades efectivas del rol (herencia ya
 *    resuelta). Sirve para un rol recién creado que todavía no tiene a nadie asignado, pero sin
 *    alcance ni zonas propias: se ven los menús y capacidades, no los datos de un titular real.
 */

import { useState } from 'react';
import type { BorradorRBAC } from '@core/tipos';
import { entrarSimulacionRol, entrarSimulacionUsuario } from '@core/puente';

interface Props {
    borrador: BorradorRBAC;
}

type Via = 'usuario' | 'rol';

export function PanelSimular({ borrador }: Props) {
    const [via, setVia] = useState<Via>('usuario');
    const [correo, setCorreo] = useState('');
    const [rol, setRol] = useState('');
    const [entrando, setEntrando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const usuarios = borrador.usuarios.filter(u => u.correo && u.activo);
    const roles = borrador.roles.filter(r => r.activo);

    const verComoUsuario = async () => {
        if (!correo) return;
        setEntrando(true);
        setError(null);
        try {
            await entrarSimulacionUsuario(correo);
            location.reload();
        } catch (err) {
            setError((err as Error).message);
            setEntrando(false);
        }
    };

    const verComoRol = () => {
        const r = roles.find(x => x.clave === rol);
        if (!r) return;
        setEntrando(true);
        setError(null);
        try {
            entrarSimulacionRol({ clave: r.clave, nombre: r.nombre, efectivas: r.efectivas });
            location.reload();
        } catch (err) {
            setError((err as Error).message);
            setEntrando(false);
        }
    };

    return (
        <div className="campo">
            <span className="campo-lbl">Ver la app como otro rol o usuario</span>
            <p className="ayuda">
                Sirve para probar un cambio de permisos antes de publicarlo. Es de solo lectura:
                mientras estés viendo como otra identidad, nada se guarda de verdad. Salís desde
                el aviso que queda fijo mientras dure.
            </p>

            <div className="seg" role="group" aria-label="Vía de simulación">
                <button type="button" aria-pressed={via === 'usuario'} onClick={() => setVia('usuario')}>
                    Por usuario
                </button>
                <button type="button" aria-pressed={via === 'rol'} onClick={() => setVia('rol')}>
                    Por rol
                </button>
            </div>

            {via === 'usuario' && (
                <>
                    <p className="ayuda">
                        Pide el perfil real de ese correo: lo que veas es exactamente lo que vería
                        esa persona hoy, datos incluidos.
                    </p>
                    <div className="campo-fila">
                        <span className="campo-fila-lbl">Usuario</span>
                        <select
                            className="inp"
                            aria-label="Elegir usuario a simular"
                            value={correo}
                            onChange={e => setCorreo(e.target.value)}
                        >
                            <option value="">— Elige un usuario —</option>
                            {usuarios.map(u => (
                                <option value={u.correo} key={u.correo}>{u.nombre || u.correo}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        className="btn"
                        disabled={!correo || entrando}
                        onClick={() => { void verComoUsuario(); }}
                    >
                        {entrando ? 'Entrando…' : 'Ver como este usuario'}
                    </button>
                </>
            )}

            {via === 'rol' && (
                <>
                    <p className="ayuda">
                        Arma un perfil solo con las capacidades del rol (incluida la herencia). No
                        tiene territorio propio: para probar datos de verdad, usa "Por usuario".
                    </p>
                    <div className="campo-fila">
                        <span className="campo-fila-lbl">Rol</span>
                        <select
                            className="inp"
                            aria-label="Elegir rol a simular"
                            value={rol}
                            onChange={e => setRol(e.target.value)}
                        >
                            <option value="">— Elige un rol —</option>
                            {roles.map(r => (
                                <option value={r.clave} key={r.clave}>{r.nombre}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="button"
                        className="btn"
                        disabled={!rol || entrando}
                        onClick={verComoRol}
                    >
                        {entrando ? 'Entrando…' : 'Ver como este rol'}
                    </button>
                </>
            )}

            {error && <p className="ayuda es-error">{error}</p>}
        </div>
    );
}
