/**
 * El borrador vivo de Accesos (roles, usuarios, jerarquía) y su guardado.
 *
 * Difiere de `useAdmin` en un punto: los catálogos se materializan desde una caché local
 * síncrona, pero RBAC no tiene caché — `leerRBAC` es siempre una ida de red. Por eso este hook
 * tiene estados de carga y error que `useAdmin` no necesita, y por eso la carga es PEREZOSA
 * (`activo`): mientras el administrador no entra a la pestaña Accesos, no vale la pena gastar
 * la ida de red en datos que quizás no va a mirar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { guardarRoles, guardarUsuarios, leerRBAC, type Avisar } from '@core/puente';
import type { BorradorRBAC } from '@core/tipos';
import {
    VACIO_RBAC, jerarquiaParaGuardar, problemasDeRoles, problemasDeUsuarios,
    rolesParaGuardar, usuariosParaGuardar
} from '../services/borradorRBAC';

interface Opciones {
    /** Se difiere la primera carga hasta que esto sea `true`. */
    activo: boolean;
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export interface EstadoRBAC {
    borrador: BorradorRBAC;
    cambiar: (fn: (b: BorradorRBAC) => BorradorRBAC) => void;
    cargando: boolean;
    /** Mensaje de la última carga o guardado fallidos; `null` si todo salió bien. */
    error: string | null;
    guardando: boolean;
    guardar: () => Promise<void>;
    descartar: () => void;
    sucio: boolean;
    recargar: () => Promise<void>;
}

export function useRBAC({ activo, avisar, confirmar, onGuardado }: Opciones): EstadoRBAC {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inicial, setInicial] = useState<string>(() => JSON.stringify(VACIO_RBAC));
    const [borrador, setBorrador] = useState<BorradorRBAC>(VACIO_RBAC);
    const [guardando, setGuardando] = useState(false);
    const cargadoUnaVez = useRef(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const datos = await leerRBAC();
            const b: BorradorRBAC = {
                roles: datos.roles, capacidades: datos.capacidades, usuarios: datos.usuarios
            };
            setInicial(JSON.stringify(b));
            setBorrador(b);
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => {
        if (!activo || cargadoUnaVez.current) return;
        cargadoUnaVez.current = true;
        void cargar();
    }, [activo, cargar]);

    const cambiar = useCallback((fn: (b: BorradorRBAC) => BorradorRBAC) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const problemas = [...problemasDeRoles(borrador.roles), ...problemasDeUsuarios(borrador.usuarios)];
        if (problemas.length > 0) {
            avisar?.(`No se puede guardar: ${problemas.join('; ')}.`,
                { estado: 'sin-registrar', ms: 8000 });
            return;
        }

        const seguir = (confirmar ?? ((m: string) => window.confirm(m)))(
            'Esto cambia quién puede hacer qué en TODA la instalación. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        const original: BorradorRBAC = JSON.parse(inicial);

        setGuardando(true);
        setError(null);
        try {
            // Choque con otro administrador: `guardarRoles`/`guardarUsuarios` mandan el estado
            // COMPLETO de cada uno, no un diff contra lo que el servidor tiene ahora — si dos
            // personas tienen Accesos abierto a la vez, quien guarda al final pisa en silencio
            // lo que la otra acabó de guardar. Se compara contra un vistazo fresco antes de
            // escribir; los cambios locales NO se tocan, solo se avisa y se actualiza la base
            // de comparación para que el siguiente intento ya no choque con esto mismo.
            const fresco = await leerRBAC();
            const enServidor = JSON.stringify({
                roles: fresco.roles, capacidades: fresco.capacidades, usuarios: fresco.usuarios
            });
            if (enServidor !== inicial) {
                setInicial(enServidor);
                avisar?.(
                    'Alguien más guardó cambios en Accesos desde que abriste esta pantalla. ' +
                    'Tus cambios siguen aquí sin guardar — revísalos contra lo más reciente antes de guardar de nuevo.',
                    { estado: 'sin-registrar', ms: 9000 }
                );
                return;
            }

            const { roles, eliminar } = rolesParaGuardar(original.roles, borrador.roles);
            const rolesResp = await guardarRoles({ roles, eliminar }) as
                { status?: string; message?: string };
            if (rolesResp?.status === 'error') throw new Error(rolesResp.message || 'No se pudieron guardar los roles.');

            const usuariosResp = await guardarUsuarios({
                usuarios: usuariosParaGuardar(borrador.usuarios),
                jerarquia: jerarquiaParaGuardar(original.usuarios, borrador.usuarios)
            }) as { status?: string; message?: string };
            if (usuariosResp?.status === 'error') {
                throw new Error(usuariosResp.message || 'No se pudieron guardar los usuarios.');
            }

            // Se relee: lo que el servidor aceptó —capacidades resueltas, jerarquía normalizada—
            // no tiene por qué ser exactamente lo que se envió.
            await cargar();
            avisar?.('Accesos actualizados.', { estado: 'completa' });
            onGuardado?.();
        } catch (err) {
            const mensaje = (err as Error).message;
            setError(mensaje);
            avisar?.(`No se pudo guardar: ${mensaje}`, { estado: 'sin-registrar', ms: 8000 });
        } finally {
            setGuardando(false);
        }
    }, [borrador, inicial, avisar, confirmar, onGuardado, cargar]);

    const descartar = useCallback(() => { setBorrador(JSON.parse(inicial)); }, [inicial]);

    return {
        borrador, cambiar, cargando, error, guardando, guardar, descartar,
        sucio: JSON.stringify(borrador) !== inicial,
        recargar: cargar
    };
}
