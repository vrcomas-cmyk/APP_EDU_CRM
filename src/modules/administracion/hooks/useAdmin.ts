/**
 * El borrador vivo de Administración y su guardado.
 *
 * El borrador se materializa al montar y NO se vuelve a leer del catálogo mientras la pantalla
 * está abierta: un sync en segundo plano no debe reescribir lo que alguien está editando.
 */

import { useCallback, useState } from 'react';
import { guardarCatalogosAdmin, descargarCatalogo, type Avisar } from '@core/puente';
import type { BorradorCatalogo } from '@core/tipos';
import { borradorDesdeCatalogo, problemasDe } from '../services/borrador';

interface Opciones {
    avisar?: Avisar;
    confirmar?: (mensaje: string) => boolean;
    onGuardado?: () => void;
}

export interface EstadoAdmin {
    borrador: BorradorCatalogo;
    /** Aplica un cambio. Recibe el borrador actual y devuelve el siguiente. */
    cambiar: (fn: (b: BorradorCatalogo) => BorradorCatalogo) => void;
    guardando: boolean;
    guardar: () => Promise<void>;
    /** Vuelve el borrador a como estaba al abrir. */
    descartar: () => void;
    /** `true` si el borrador difiere de lo que había al abrir. */
    sucio: boolean;
}

export function useAdmin({ avisar, confirmar, onGuardado }: Opciones = {}): EstadoAdmin {
    const [inicial, setInicial] = useState(() => JSON.stringify(borradorDesdeCatalogo()));
    const [borrador, setBorrador] = useState<BorradorCatalogo>(() => JSON.parse(inicial));
    const [guardando, setGuardando] = useState(false);

    const cambiar = useCallback((fn: (b: BorradorCatalogo) => BorradorCatalogo) => {
        setBorrador(fn);
    }, []);

    const guardar = useCallback(async () => {
        const problemas = problemasDe(borrador);

        if (problemas.length > 0) {
            avisar?.(`No se puede guardar: ${problemas.join('; ')}.`,
                { estado: 'sin-registrar', ms: 8000 });
            return;
        }

        // La confirmación se inyecta para poder probarla: `confirm` bloquea el hilo y en una
        // prueba dejaría la suite colgada esperando a alguien que no existe.
        const seguir = (confirmar ?? window.confirm.bind(window))(
            'Estos catálogos los usan TODOS los educadores. ¿Guardar los cambios?'
        );
        if (!seguir) return;

        setGuardando(true);
        try {
            // Choque con otro administrador: `guardarCatalogosAdmin` manda el arreglo COMPLETO,
            // no un diff, así que si alguien más guardó cambios aquí mientras esta pantalla
            // estaba abierta, escribir ahora los borraría en silencio — el que guarda al final
            // gana, sin que nadie se entere de que hubo un choque. Se baja el catálogo fresco y
            // se compara contra lo que había al abrir; si cambió, se avisa en vez de sobrescribir.
            const actual = JSON.stringify(await descargarCatalogo().then(() => borradorDesdeCatalogo()));
            if (actual !== inicial) {
                // No se descartan tus cambios: se quedan tal cual los dejaste, para que puedas
                // revisarlos contra lo nuevo tú mismo. Solo se actualiza la base de comparación,
                // para que el siguiente intento de guardar ya no choque con esto mismo.
                avisar?.(
                    'Alguien más guardó cambios en Catálogos desde que abriste esta pantalla. ' +
                    'Tus cambios siguen aquí sin guardar — revísalos contra lo más reciente antes de guardar de nuevo.',
                    { estado: 'sin-registrar', ms: 9000 }
                );
                setInicial(actual);
                return;
            }

            await guardarCatalogosAdmin(borrador);
            // Se vuelve a bajar para que la pantalla refleje lo que el servidor aceptó, que no
            // tiene por qué ser exactamente lo que se envió.
            await descargarCatalogo();
            avisar?.('Catálogos actualizados.', { estado: 'completa' });
            onGuardado?.();
        } catch (err) {
            avisar?.(`No se pudo guardar: ${(err as Error).message}`,
                { estado: 'sin-registrar', ms: 7000 });
        } finally {
            setGuardando(false);
        }
    }, [borrador, inicial, avisar, confirmar, onGuardado]);

    const descartar = useCallback(() => { setBorrador(JSON.parse(inicial)); }, [inicial]);

    return {
        borrador,
        cambiar,
        guardando,
        guardar,
        descartar,
        sucio: JSON.stringify(borrador) !== inicial
    };
}
