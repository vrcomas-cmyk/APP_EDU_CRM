/**
 * Conexión con Google Calendar, compartida por el calendario y "Mi día".
 *
 * Al montar intenta una reconexión de fondo (sin clic) si ya se había conectado antes; si el
 * navegador no lo permite sin interacción o no hay sesión activa, se queda `conectado: false`
 * y `conectar()` sigue disponible para el botón visible.
 */

import { useCallback, useEffect, useState } from 'react';
import { tieneAccesoCalendar, conectarCalendar, intentarReconexionCalendar, CALENDAR_CLIENT_ID } from '@core/puente';

/**
 * El intento silencioso, UNA sola vez por pestaña — no una por montaje.
 *
 * Este hook se usa en Calendario Y en "Mi día"; sin esto, cada vez que alguien cambia entre
 * esas dos pantallas (algo que pasa todo el tiempo, no es un caso raro) se dispara OTRA
 * llamada al SDK de Google pidiendo el token, aunque la anterior acabe de fallar hace un
 * segundo. Un módulo compartido —no estado de React, que se reinicia por componente— es lo
 * único que puede recordar "ya se intentó en esta pestaña" entre montajes independientes.
 * Si el intento tuvo éxito, además queda en caché: no hay razón para volver a pedirlo.
 */
let intentoPorPestaña: Promise<boolean> | null = null;

function reconexionUnaVezPorPestaña(): Promise<boolean> {
    if (tieneAccesoCalendar()) return Promise.resolve(true);
    if (!intentoPorPestaña) {
        // Si este intento falla, se limpia la caché: antes un solo fallo (por ejemplo, sin
        // señal justo al abrir la app) dejaba la promesa fallida cacheada para el resto de la
        // vida de la pestaña, y ningún montaje posterior de Calendario o Mi día volvía a
        // intentarlo — Calendar se quedaba "no conectado" aunque la señal volviera.
        intentoPorPestaña = intentarReconexionCalendar(CALENDAR_CLIENT_ID).then((ok) => {
            if (!ok) intentoPorPestaña = null;
            return ok;
        });
    }
    return intentoPorPestaña;
}

export function useConexionCalendar() {
    const [conectado, setConectado] = useState(() => tieneAccesoCalendar());
    const [conectando, setConectando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (conectado) return;
        let vivo = true;
        reconexionUnaVezPorPestaña().then((ok) => {
            if (vivo && ok) setConectado(true);
        });
        return () => { vivo = false; };
        // Solo al montar: reintentar en cada render provocaría llamadas repetidas al SDK.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // El token dura ~1h; sin esto, `conectado` se quedaba en `true` para siempre tras la
        // primera conexión exitosa, aunque el token ya hubiera vencido — la UI seguía diciendo
        // "conectado" mientras `reflejarEnCalendar` salía en silencio por falta de acceso real.
        if (!conectado) return;
        const reloj = setInterval(() => {
            if (!tieneAccesoCalendar()) setConectado(false);
        }, 60000);
        return () => clearInterval(reloj);
    }, [conectado]);

    const conectar = useCallback(async () => {
        setError(null);
        setConectando(true);
        try {
            await conectarCalendar(CALENDAR_CLIENT_ID);
            setConectado(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo conectar con Google Calendar.');
        } finally {
            setConectando(false);
        }
    }, []);

    return { conectado, conectar, conectando, error };
}
