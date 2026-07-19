/**
 * El estado de la bandeja: qué flujo se mira y qué queda pendiente en él.
 *
 * Todo lo que decide QUÉ es revisable vive en `js/revisiones.js` y no se toca: depende de la
 * forma del árbol de la visita, no de cómo se pinte. Este hook solo elige flujo, recuenta y
 * registra el veredicto.
 */

import { useCallback, useMemo, useState } from 'react';
import {
    flujosDisponibles, pendientesDe, conteoPendientes, revisar, consultarVisitas,
    ETIQUETAS_RESULTADO, RESULTADOS,
    type Avisar
} from '@core/puente';
import type { FlujoRevision, PendienteRevision, ResultadoRevision } from '@core/tipos';

interface Opciones {
    onCambio?: () => void;
    avisar?: Avisar;
}

export interface EstadoRevision {
    flujos: FlujoRevision[];
    flujo: FlujoRevision | null;
    elegirFlujo: (clave: string) => void;
    pendientes: PendienteRevision[];
    porFlujo: Record<string, number>;
    total: number;
    /** Devuelve el error a mostrar, o `null` si se registró. */
    enviar: (item: PendienteRevision, resultado: ResultadoRevision, observaciones: string) => string | null;
}

export function useRevision({ onCambio, avisar }: Opciones = {}): EstadoRevision {
    // Sube en cada revisión registrada. El almacén no avisa cuando cambia, así que es lo que
    // saca el elemento de la cola sin recargar la pantalla entera.
    const [version, setVersion] = useState(0);
    const [pedido, setPedido] = useState<string | null>(null);

    const flujos = useMemo(() => flujosDisponibles(), [version]);

    // Si el flujo pedido ya no existe —cambió el perfil, o se restauró una sesión con menos
    // permisos— cae al primero en vez de dejar la bandeja en blanco.
    const flujo = useMemo(
        () => flujos.find(f => f.clave === pedido) ?? flujos[0] ?? null,
        [flujos, pedido]
    );

    const visitas = useMemo(() => consultarVisitas(), [version]);
    const { porFlujo, total } = useMemo(() => conteoPendientes(visitas), [visitas]);

    const pendientes = useMemo(
        () => (flujo ? pendientesDe(flujo, visitas) : []),
        [flujo, visitas]
    );

    const enviar = useCallback((
        item: PendienteRevision,
        resultado: ResultadoRevision,
        observaciones: string
    ): string | null => {
        if (!flujo) return 'Ese flujo de revisión ya no está disponible.';

        const r = revisar({
            flujo: flujo.clave,
            ambito: flujo.ambito,
            idAmbito: item.id_ambito,
            idVisita: item.id_visita,
            resultado,
            observaciones
        });

        if (!r.ok) return r.error ?? 'No se pudo registrar la revisión.';

        avisar?.(`${ETIQUETAS_RESULTADO[resultado] || resultado} · ${item.titulo}`, {
            estado: resultado === RESULTADOS.APROBADO ? 'completa' : 'programada'
        });

        onCambio?.();
        setVersion(v => v + 1);   // el elemento sale de la cola
        return null;
    }, [flujo, onCambio, avisar]);

    return {
        flujos,
        flujo,
        elegirFlujo: setPedido,
        pendientes,
        porFlujo,
        total,
        enviar
    };
}
