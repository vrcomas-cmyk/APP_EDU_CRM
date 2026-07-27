/**
 * El borrador vivo de "Sectores por gerente" y su guardado.
 *
 * Calco de `useTerritorios.ts`/`useRBAC.ts`: `leerGerenteSector` es siempre una ida de red, así
 * que la carga es perezosa (`activo`). Sin choque contra otro administrador —a diferencia de
 * Accesos/Territorios, aquí el reemplazo es por gerente individual, así que dos personas
 * editando gerentes DISTINTOS no se pisan; si editan al MISMO, gana quien guarde al final, que
 * es el mismo riesgo que ya se acepta en Roles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { guardarGerenteSector, leerGerenteSector, type Avisar } from '@core/puente';
import type { GerenteSector } from '@core/tipos';

interface Opciones {
    /** Se difiere la primera carga hasta que esto sea `true`. */
    activo: boolean;
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
}

export interface EstadoSectoresGerente {
    borrador: GerenteSector[];
    cambiar: (fn: (b: GerenteSector[]) => GerenteSector[]) => void;
    cargando: boolean;
    error: string | null;
    guardando: boolean;
    guardar: () => Promise<void>;
    descartar: () => void;
    sucio: boolean;
}

export function useSectoresGerente({ activo, avisar, confirmar }: Opciones): EstadoSectoresGerente {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inicial, setInicial] = useState<string>('[]');
    const [borrador, setBorrador] = useState<GerenteSector[]>([]);
    const [guardando, setGuardando] = useState(false);
    const cargadoUnaVez = useRef(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const r = await leerGerenteSector();
            if (r.status === 'error') throw new Error(r.message || 'No se pudo cargar.');
            const b = r.gerentes || [];
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

    const cambiar = useCallback((fn: (b: GerenteSector[]) => GerenteSector[]) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const seguir = (confirmar ?? ((m: string) => window.confirm(m)))(
            'Esto cambia qué sectores puede ver cada gerente en el reporte de Actividades. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        setGuardando(true);
        setError(null);
        try {
            const resp = await guardarGerenteSector({ gerentes: borrador });
            if (resp?.status === 'error') throw new Error(resp.message || 'No se pudieron guardar los sectores.');

            await cargar();
            avisar?.('Sectores por gerente actualizados.', { estado: 'completa' });
        } catch (err) {
            const mensaje = (err as Error).message;
            setError(mensaje);
            avisar?.(`No se pudo guardar: ${mensaje}`, { estado: 'sin-registrar', ms: 8000 });
        } finally {
            setGuardando(false);
        }
    }, [borrador, avisar, confirmar, cargar]);

    const descartar = useCallback(() => { setBorrador(JSON.parse(inicial)); }, [inicial]);

    return {
        borrador, cambiar, cargando, error, guardando, guardar, descartar,
        sucio: JSON.stringify(borrador) !== inicial
    };
}
