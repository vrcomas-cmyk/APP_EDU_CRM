/**
 * El estado de la lista: qué pendientes hay, y marcarlos resuelto/reabrirlos.
 *
 * Mismo patrón que `useRevision.ts`/Estrategias: el almacén no avisa cuando cambia, así que un
 * contador `version` es lo que fuerza a releer `leerPendientes()` después de escribir.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    leerPendientes, upsertPendiente, descargarPendientesEquipo, sincronizarPendientes,
    sesionActual, type Avisar
} from '@core/puente';
import type { Pendiente } from '@core/tipos';

interface Opciones {
    avisar?: Avisar;
}

export interface EstadoPendientes {
    pendientes: Pendiente[];
    cargando: boolean;
    marcarResuelto: (id: string, resuelto: boolean) => void;
    recargar: () => Promise<void>;
}

export function usePendientes({ avisar }: Opciones = {}): EstadoPendientes {
    const [version, setVersion] = useState(0);
    const [cargando, setCargando] = useState(true);

    const pendientes = useMemo(() => leerPendientes(), [version]);

    const cargar = useCallback(async () => {
        await descargarPendientesEquipo();
        setVersion(v => v + 1);
    }, []);

    // Al entrar se refresca contra el equipo: quien lo creó puede haber sido otra persona, y
    // quedarse solo con lo que ya había en este teléfono escondería esos pendientes.
    useEffect(() => {
        let vivo = true;
        cargar().finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [cargar]);

    const marcarResuelto = useCallback((id: string, resuelto: boolean) => {
        const actual = leerPendientes().find(p => p.id === id);
        if (!actual) return;

        const sesion = sesionActual();
        upsertPendiente({
            ...actual,
            estado: resuelto ? 'resuelto' : 'abierto',
            resuelto_en: resuelto ? new Date().toISOString() : undefined,
            resuelto_por: resuelto ? (sesion?.nombre || '') : undefined,
            resuelto_correo: resuelto ? (sesion?.correo || '') : undefined,
            sincronizado: false
        });
        setVersion(v => v + 1);
        avisar?.(resuelto ? 'Pendiente resuelto.' : 'Pendiente reabierto.',
            { estado: resuelto ? 'completa' : 'programada' });

        // Subida en segundo plano, igual que el resto de la app: no hace esperar por un POST.
        sincronizarPendientes().then(() => setVersion(v => v + 1)).catch(() => {});
    }, [avisar]);

    return { pendientes, cargando, marcarResuelto, recargar: cargar };
}
