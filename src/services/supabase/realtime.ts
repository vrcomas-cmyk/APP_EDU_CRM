/**
 * Sincronía instantánea: un PING sin datos por Realtime en vez de esperar al poll de 60s.
 *
 * El servidor (trigger `pdt_avisar_cambio`, ver `supabase/migrations/20260826_pdt_realtime.sql`)
 * manda un broadcast vacío —`{ tabla, momento }`, nunca la fila— al topic de quien capturó y al
 * de cada jefe que lo alcanza. Aquí solo hace falta reaccionar: al oír el ping, bajar el espejo
 * con los RPC que YA existen y YA resuelven alcance jerárquico. Este módulo no sabe nada de
 * jerarquía ni de qué cambió — eso es del servidor y de quien nos pasa el callback.
 *
 * No se usa `postgres_changes`: eso exigiría abrir SELECT sobre las tablas a la clave anónima
 * (pública), justo lo que el resto de la app evita a propósito con RLS sin políticas.
 */

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import { rpc } from './rpc';

/** Agrupa ráfagas de avisos (varios cambios seguidos) en una sola bajada. */
const DEBOUNCE_MS = 500;

let cliente: SupabaseClient | null = null;

function clienteRealtime(): SupabaseClient {
    if (!cliente) {
        // Un solo cliente para toda la pestaña: crear uno por conexión abriría un socket
        // nuevo cada vez que `conectarCanal` se llama (recuperar señal, volver a primer plano).
        cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return cliente;
}

export interface ConexionRealtime {
    /** Cierra el canal. Se usa al cerrar sesión o antes de reconectar con otro token. */
    desconectar(): void;
}

/**
 * Se conecta al canal de esta sesión y llama a `alCambio` (agrupado) cada vez que el servidor
 * avisa que algo suyo —o de su equipo, si tiene gente a cargo— cambió.
 *
 * `alEstado` informa si el canal quedó realmente conectado. No es cosmético: si falla (red
 * corporativa que bloquea WebSocket, por ejemplo) la app sigue funcionando igual gracias al
 * poll de 60s que ya existía — esto solo es la vía rápida, no la única.
 */
export async function conectarCanal(
    sesionToken: string,
    alCambio: () => void,
    alEstado?: (conectado: boolean) => void
): Promise<ConexionRealtime> {
    let canal: RealtimeChannel | null = null;
    let temporizador: ReturnType<typeof setTimeout> | null = null;

    function avisarConRetraso() {
        if (temporizador) clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            temporizador = null;
            alCambio();
        }, DEBOUNCE_MS);
    }

    let topic: string | null = null;
    try {
        topic = await rpc<string>('pdt_canal_de_sesion', { p_sesion_token: sesionToken });
    } catch (err) {
        console.error('No se pudo obtener el canal de Realtime:', err);
    }

    if (!topic) {
        alEstado?.(false);
        return { desconectar() {} };
    }

    canal = clienteRealtime()
        .channel(topic)
        .on('broadcast', { event: 'cambio' }, avisarConRetraso)
        .subscribe((estado) => {
            alEstado?.(estado === 'SUBSCRIBED');
        });

    return {
        desconectar() {
            if (temporizador) clearTimeout(temporizador);
            canal?.unsubscribe();
            canal = null;
        }
    };
}
