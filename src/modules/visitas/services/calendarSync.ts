/**
 * Puente entre una visita y su evento espejo en Google Calendar.
 *
 * Silencioso por diseño, igual que el espejo de Supabase: si Calendar no responde o el
 * educador nunca lo conectó, la visita YA se guardó donde de verdad importa (Sheets/
 * localStorage). Esto es un extra que se intenta y, si falla, no interrumpe nada — solo se
 * avisa una vez, para que quien sí lo conectó sepa que algo no llegó.
 *
 * Antes, sin Calendar conectado esta función simplemente salía (`if (!tieneAccesoCalendar())
 * return;`) sin dejar ningún rastro: una visita guardada mientras la reconexión OAuth todavía
 * no resolvía (habitual al abrir la app) se quedaba sin evento PARA SIEMPRE, porque no había
 * cola ni reintento en ningún otro lugar del código. Ahora marca `calendar_pendiente` — lo que
 * lee `sincronizarCalendar()` (`js/sync.js`) en el loop de fondo para crear el evento en cuanto
 * Calendar esté disponible, sin que el usuario tenga que volver a tocar nada.
 */

import { tieneAccesoCalendar, sincronizarEventoVisita, borrarEventoVisita, type Avisar } from '@core/puente';
import type { Visita } from '@core/tipos';

/** Tras guardar o reagendar: crea o actualiza el evento, y persiste el id que devuelva. */
export async function reflejarEnCalendar(
    visita: Visita,
    editar: (mutador: (v: Visita) => void) => void,
    avisar?: Avisar
): Promise<void> {
    if (!tieneAccesoCalendar()) {
        if (!visita.calendar_pendiente) editar(v => { v.calendar_pendiente = true; });
        return;
    }

    try {
        const id = await sincronizarEventoVisita(visita);
        if (id && id !== visita.calendar_event_id) {
            editar(v => { v.calendar_event_id = id; delete v.calendar_pendiente; });
        }
    } catch (err) {
        console.error('No se pudo reflejar la visita en Google Calendar:', err);
        editar(v => { v.calendar_pendiente = true; });
        avisar?.('La visita se guardó, pero no se pudo reflejar en Google Calendar.',
            { estado: 'sin-registrar' });
    }
}

/** Tras cancelar: borra el evento, si había uno y si Calendar está conectado. */
export async function quitarDeCalendar(visita: Visita, avisar?: Avisar): Promise<void> {
    if (!tieneAccesoCalendar() || !visita.calendar_event_id) return;

    try {
        await borrarEventoVisita(visita.calendar_event_id);
    } catch (err) {
        console.error('No se pudo quitar el evento de Google Calendar:', err);
        avisar?.('La visita se canceló, pero su evento en Google Calendar sigue ahí.',
            { estado: 'sin-registrar' });
    }
}
