/**
 * Conexión con Google Calendar, compartida por el calendario y "Mi día".
 *
 * El consentimiento se dio una sola vez, en el login (`js/auth.js`): a partir de ahí, "conectar"
 * es solo pedirle al servidor un access_token fresco (`js/googleCalendar.js`), sin ningún popup.
 * Al montar intenta esa reconexión de fondo; si por lo que sea falla (red caída, servidor
 * ocupado), `conectar()` sigue disponible para reintentar desde el botón visible.
 * `necesitaReautenticar` solo se enciende si el servidor confirma que el permiso ya no sirve.
 */

import { useCallback, useEffect, useState } from 'react';
import {
    tieneAccesoCalendar, conectarCalendar, intentarReconexionCalendar, sesionActual, CALENDAR_CLIENT_ID,
    alReautenticarCalendar
} from '@core/puente';

export function useConexionCalendar() {
    const [conectado, setConectado] = useState(() => tieneAccesoCalendar());
    const [conectando, setConectando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Solo se enciende cuando el servidor confirma que el permiso de Google ya no sirve
    // (contraseña cambiada, acceso revocado). Es el único caso en el que hace falta volver a
    // iniciar sesión — ya no hay ningún botón de "Conectar" que abra un popup de consentimiento.
    const [necesitaReautenticar, setNecesitaReautenticar] = useState(false);
    const correo = sesionActual()?.correo;

    useEffect(() => {
        alReautenticarCalendar(() => setNecesitaReautenticar(true));
        return () => alReautenticarCalendar(() => {});
    }, []);

    useEffect(() => {
        if (conectado) return;
        let vivo = true;
        // La deduplicación de intentos en vuelo vive en `googleCalendar.js` (a nivel de
        // módulo, no de componente): montar Calendario y "Mi día" casi al mismo tiempo ya no
        // dispara dos llamadas al SDK, así que no hace falta repetir ese guard aquí.
        intentarReconexionCalendar(CALENDAR_CLIENT_ID, correo).then((ok) => {
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
            intentarReconexionCalendar(CALENDAR_CLIENT_ID, correo).then((ok) => {
                if (vivo && !ok) setConectado(false);
            });
        }, 60000);
        return () => { vivo = false; clearInterval(reloj); };
    }, [conectado, correo]);

    const conectar = useCallback(async () => {
        setError(null);
        setConectando(true);
        try {
            const ok = await conectarCalendar(CALENDAR_CLIENT_ID, correo);
            setConectado(ok);
            if (!ok) setError('No se pudo conectar con Google Calendar. Intenta de nuevo en un momento.');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo conectar con Google Calendar.');
        } finally {
            setConectando(false);
        }
    }, [correo]);

    return { conectado, conectar, conectando, error, necesitaReautenticar };
}
