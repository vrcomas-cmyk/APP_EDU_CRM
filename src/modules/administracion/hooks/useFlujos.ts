/**
 * El borrador vivo de Flujos de revisión y su guardado. Calco de `useRBAC.ts`: `leerFlujos` es
 * siempre una ida de red (sin caché local), así que la carga es perezosa (`activo`) y hay
 * estados de carga/error que un borrador de catálogo no necesita.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { guardarFlujosAdmin, leerFlujosAdmin, type Avisar } from '@core/puente';
import type { BorradorFlujos } from '@core/tipos';
import { VACIO_FLUJOS, flujosParaGuardar, problemasDeFlujos } from '../services/borradorFlujos';

interface Opciones {
    /** Se difiere la primera carga hasta que esto sea `true`. */
    activo: boolean;
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export interface EstadoFlujos {
    borrador: BorradorFlujos;
    cambiar: (fn: (b: BorradorFlujos) => BorradorFlujos) => void;
    cargando: boolean;
    error: string | null;
    guardando: boolean;
    guardar: () => Promise<void>;
    descartar: () => void;
    sucio: boolean;
    recargar: () => Promise<void>;
}

export function useFlujos({ activo, avisar, confirmar, onGuardado }: Opciones): EstadoFlujos {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inicial, setInicial] = useState<string>(() => JSON.stringify(VACIO_FLUJOS));
    const [borrador, setBorrador] = useState<BorradorFlujos>(VACIO_FLUJOS);
    const [guardando, setGuardando] = useState(false);
    const cargadoUnaVez = useRef(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const datos = await leerFlujosAdmin();
            const b: BorradorFlujos = { flujos: datos.flujos };
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

    const cambiar = useCallback((fn: (b: BorradorFlujos) => BorradorFlujos) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const problemas = problemasDeFlujos(borrador.flujos);
        if (problemas.length > 0) {
            avisar?.(`No se puede guardar: ${problemas.join('; ')}.`,
                { estado: 'sin-registrar', ms: 8000 });
            return;
        }

        const seguir = (confirmar ?? ((m: string) => window.confirm(m)))(
            'Esto cambia qué se revisa y cómo se califica en TODA la instalación. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        const original: BorradorFlujos = JSON.parse(inicial);

        setGuardando(true);
        setError(null);
        try {
            const { flujos, eliminar } = flujosParaGuardar(original.flujos, borrador.flujos);
            const resp = await guardarFlujosAdmin({ flujos, eliminar }) as
                { status?: string; message?: string };
            if (resp?.status === 'error') throw new Error(resp.message || 'No se pudieron guardar los flujos.');

            // Se relee: el servidor puede rellenar valores por defecto (nombre, orden) que no
            // tienen por qué ser exactamente lo que se envió.
            await cargar();
            avisar?.('Flujos de revisión actualizados.', { estado: 'completa' });
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
