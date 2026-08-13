/**
 * Conexión con Google Calendar, compartida por el calendario y "Mi día".
 *
 * Al montar intenta una reconexión de fondo (sin clic) si ya se había conectado antes; si el
 * navegador no lo permite sin interacción o no hay sesión activa, se queda `conectado: false`
 * y `conectar()` sigue disponible para el botón visible.
 */

import { useCallback, useEffect, useState } from 'react';
import { tieneAccesoCalendar, conectarCalendar, intentarReconexionCalendar, CALENDAR_CLIENT_ID } from '@core/puente';

export function useConexionCalendar() {
    const [conectado, setConectado] = useState(() => tieneAccesoCalendar());
    const [conectando, setConectando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (conectado) return;
        let vivo = true;
        // La deduplicación de intentos en vuelo vive en `googleCalendar.js` (a nivel de
        // módulo, no de componente): montar Calendario y "Mi día" casi al mismo tiempo ya no
        // dispara dos llamadas al SDK, así que no hace falta repetir ese guard aquí.
        intentarReconexionCalendar(CALENDAR_CLIENT_ID).then((ok) => {
            if (vivo && ok) setConectado(true);
        });
        return () => { vivo = false; };
        // Solo al montar: reintentar en cada render provocaría llamadas repetidas al SDK.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        // El token dura ~1h. Antes esto solo apagaba `conectado`; ahora primero intenta
        // renovarlo en silencio (el consentimiento ya está dado, ver `js/app.js`) y solo
        // avisa que se perdió la conexión si esa renovación también falla — si no, la UI
        // decía "no conectado" cada hora aunque el reconciliador de fondo (`js/sync.js`)
        // se las arreglara solo un instante después.
        if (!conectado) return;
        let vivo = true;
        const reloj = setInterval(() => {
            if (tieneAccesoCalendar()) return;
            intentarReconexionCalendar(CALENDAR_CLIENT_ID).then((ok) => {
                if (vivo && !ok) setConectado(false);
            });
        }, 60000);
        return () => { vivo = false; clearInterval(reloj); };
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
