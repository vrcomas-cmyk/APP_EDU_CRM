/**
 * El borrador vivo de Territorios (titulares de zona + coberturas) y su guardado.
 *
 * Calco de `useRBAC.ts`: `leerTerritorios` es siempre una ida de red (sin caché local), así
 * que la carga es perezosa (`activo`) y hay estados de carga/error que un borrador de
 * catálogo no necesita.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { guardarTerritorios, leerTerritorios, type Avisar } from '@core/puente';
import type { BorradorTerritorios } from '@core/tipos';
import {
    VACIO_TERRITORIOS, coberturasParaGuardar, problemasDeTerritorios, titularesParaGuardar
} from '../services/borradorTerritorios';

interface Opciones {
    /** Se difiere la primera carga hasta que esto sea `true`. */
    activo: boolean;
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export interface EstadoTerritorios {
    borrador: BorradorTerritorios;
    cambiar: (fn: (b: BorradorTerritorios) => BorradorTerritorios) => void;
    cargando: boolean;
    error: string | null;
    guardando: boolean;
    guardar: () => Promise<void>;
    descartar: () => void;
    sucio: boolean;
    recargar: () => Promise<void>;
}

export function useTerritorios({ activo, avisar, confirmar, onGuardado }: Opciones): EstadoTerritorios {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inicial, setInicial] = useState<string>(() => JSON.stringify(VACIO_TERRITORIOS));
    const [borrador, setBorrador] = useState<BorradorTerritorios>(VACIO_TERRITORIOS);
    const [guardando, setGuardando] = useState(false);
    const cargadoUnaVez = useRef(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const datos = await leerTerritorios();
            const b: BorradorTerritorios = {
                titulares: datos.titulares,
                coberturas: datos.coberturas.map(c => ({ ...c, hasta: c.hasta ?? null }))
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

    const cambiar = useCallback((fn: (b: BorradorTerritorios) => BorradorTerritorios) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const problemas = problemasDeTerritorios(borrador);
        if (problemas.length > 0) {
            avisar?.(`No se puede guardar: ${problemas.join('; ')}.`, { estado: 'sin-registrar', ms: 8000 });
            return;
        }

        const seguir = (confirmar ?? ((m: string) => window.confirm(m)))(
            'Esto cambia qué clientes ve cada educador. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        const original: BorradorTerritorios = JSON.parse(inicial);

        setGuardando(true);
        setError(null);
        try {
            // Mismo choque que en Accesos/Flujos: `guardarTerritorios` manda el estado completo
            // de titulares (upsert) y las coberturas nuevas/quitadas, no un diff contra lo que
            // el servidor tiene ahora. Se compara contra un vistazo fresco antes de escribir.
            const fresco = await leerTerritorios();
            const enServidor = JSON.stringify({
                titulares: fresco.titulares,
                coberturas: fresco.coberturas.map(c => ({ ...c, hasta: c.hasta ?? null }))
            });
            if (enServidor !== inicial) {
                setInicial(enServidor);
                avisar?.(
                    'Alguien más guardó cambios en Territorios desde que abriste esta pantalla. ' +
                    'Tus cambios siguen aquí sin guardar — revísalos contra lo más reciente antes de guardar de nuevo.',
                    { estado: 'sin-registrar', ms: 9000 }
                );
                return;
            }

            const { asignar, quitarZona } = titularesParaGuardar(original.titulares, borrador.titulares);
            const { agregarCobertura, quitarCobertura } = coberturasParaGuardar(original.coberturas, borrador.coberturas);

            const resp = await guardarTerritorios({
                asignar, quitar_zona: quitarZona,
                agregar_cobertura: agregarCobertura, quitar_cobertura: quitarCobertura
            }) as { status?: string; message?: string };
            if (resp?.status === 'error') throw new Error(resp.message || 'No se pudieron guardar los territorios.');

            // Se relee: las coberturas nuevas llegan con el id real que Supabase generó.
            await cargar();
            avisar?.('Territorios actualizados.', { estado: 'completa' });
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
