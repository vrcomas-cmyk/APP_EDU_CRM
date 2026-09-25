/**
 * El borrador vivo de los catálogos de Estrategia (Tipos y Etapas) y su guardado. Calco de
 * `useFlujos.ts`: `leerCatalogosEstrategiaAdmin` es siempre una ida de red (sin caché local), así
 * que la carga es perezosa (`activo`) y hay estados de carga/error que un borrador de catálogo
 * local no necesita.
 *
 * Un solo borrador para los dos catálogos (en vez de dos hooks separados) porque comparten una
 * sola pantalla y un solo botón "Guardar cambios" en Administración — pero se guardan con DOS
 * llamadas (`guardarEstrategiaTiposAdmin` + `guardarEtapasAdmin`), una por catálogo, porque así
 * las expone Apps Script.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    guardarEstrategiaTiposAdmin, guardarEtapasAdmin, leerCatalogosEstrategiaAdmin, type Avisar
} from '@core/puente';
import type { BorradorCatalogosEstrategia } from '@core/tipos';
import { fichasParaGuardar, problemasDeFichas } from '../services/borradorCatalogoFicha';

interface Opciones {
    /** Se difiere la primera carga hasta que esto sea `true`. */
    activo: boolean;
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export interface EstadoCatalogosEstrategia {
    borrador: BorradorCatalogosEstrategia;
    cambiar: (fn: (b: BorradorCatalogosEstrategia) => BorradorCatalogosEstrategia) => void;
    cargando: boolean;
    error: string | null;
    guardando: boolean;
    guardar: () => Promise<void>;
    descartar: () => void;
    sucio: boolean;
    recargar: () => Promise<void>;
}

const VACIO: BorradorCatalogosEstrategia = { tipos: [], etapas: [] };

export function useCatalogosEstrategia({ activo, avisar, confirmar, onGuardado }: Opciones): EstadoCatalogosEstrategia {
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [inicial, setInicial] = useState<string>(() => JSON.stringify(VACIO));
    const [borrador, setBorrador] = useState<BorradorCatalogosEstrategia>(VACIO);
    const [guardando, setGuardando] = useState(false);
    const cargadoUnaVez = useRef(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        try {
            const datos = await leerCatalogosEstrategiaAdmin();
            const b: BorradorCatalogosEstrategia = { tipos: datos.tipos, etapas: datos.etapas };
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

    const cambiar = useCallback((fn: (b: BorradorCatalogosEstrategia) => BorradorCatalogosEstrategia) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const problemas = [
            ...problemasDeFichas(borrador.tipos, 'tipo de estrategia'),
            ...problemasDeFichas(borrador.etapas, 'etapa')
        ];
        if (problemas.length > 0) {
            avisar?.(`No se puede guardar: ${problemas.join('; ')}.`,
                { estado: 'sin-registrar', ms: 8000 });
            return;
        }

        const seguir = (confirmar ?? ((m: string) => window.confirm(m)))(
            'Esto cambia las opciones de "Estrategia" y "Etapa" que ve TODA la instalación al '
            + 'capturar. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        const original: BorradorCatalogosEstrategia = JSON.parse(inicial);

        setGuardando(true);
        setError(null);
        try {
            // Choque con otro administrador: mismo riesgo que en `useFlujos` — se manda el
            // estado completo, no un diff. Se compara contra un vistazo fresco antes de
            // escribir; los cambios locales no se tocan, solo se avisa.
            const fresco = await leerCatalogosEstrategiaAdmin();
            const enServidor = JSON.stringify({ tipos: fresco.tipos, etapas: fresco.etapas });
            if (enServidor !== inicial) {
                setInicial(enServidor);
                avisar?.(
                    'Alguien más guardó cambios en Estrategias desde que abriste esta pantalla. ' +
                    'Tus cambios siguen aquí sin guardar — revísalos contra lo más reciente antes de guardar de nuevo.',
                    { estado: 'sin-registrar', ms: 9000 }
                );
                return;
            }

            const tipos = fichasParaGuardar(original.tipos, borrador.tipos);
            const respTipos = await guardarEstrategiaTiposAdmin({ tipos: tipos.fichas, eliminar: tipos.eliminar }) as
                { status?: string; message?: string };
            if (respTipos?.status === 'error') throw new Error(respTipos.message || 'No se pudieron guardar los tipos de estrategia.');

            const etapas = fichasParaGuardar(original.etapas, borrador.etapas);
            const respEtapas = await guardarEtapasAdmin({ etapas: etapas.fichas, eliminar: etapas.eliminar }) as
                { status?: string; message?: string };
            if (respEtapas?.status === 'error') throw new Error(respEtapas.message || 'No se pudieron guardar las etapas.');

            // Se relee: el servidor puede rellenar valores por defecto que no tienen por qué
            // ser exactamente lo que se envió.
            await cargar();
            avisar?.('Catálogos de Estrategia actualizados.', { estado: 'completa' });
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
