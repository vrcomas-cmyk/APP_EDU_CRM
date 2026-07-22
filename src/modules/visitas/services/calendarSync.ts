/**
 * Puente entre una visita y su evento espejo en Google Calendar.
 *
 * Silencioso por diseño, igual que el espejo de Supabase: si Calendar no responde o el
 * educador nunca lo conectó, la visita YA se guardó donde de verdad importa (Sheets/
 * localStorage). Esto es un extra que se intenta y, si falla, no interrumpe nada — solo se
 * avisa una vez, para que quien sí lo conectó sepa que algo no llegó.
 */

import { tieneAccesoCalendar, sincronizarEventoVisita, borrarEventoVisita, type Avisar } from '@core/puente';
import type { Visita } from '@core/tipos';

/** Tras guardar o reagendar: crea o actualiza el evento, y persiste el id que devuelva. */
export async function reflejarEnCalendar(
    visita: Visita,
    editar: (mutador: (v: Visita) => void) => void,
    avisar?: Avisar
): Promise<void> {
    if (!tieneAccesoCalendar()) return;

    try {
        const id = await sincronizarEventoVisita(visita);
        if (id && id !== visita.calendar_event_id) {
            editar(v => { v.calendar_event_id = id; });
        }
    } catch (err) {
        console.error('No se pudo reflejar la visita en Google Calendar:', err);
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
