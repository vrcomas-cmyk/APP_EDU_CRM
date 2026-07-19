/**
 * De quién es una visita, y por tanto quién puede escribirla.
 *
 * ── Por qué esto no es un permiso ────────────────────────────────────────────────────
 *
 * Ver, calificar y modificar son tres verbos distintos, y solo los dos primeros son
 * permisos. Un gerente VE las visitas de su equipo —`consultarVisitas` las filtra por
 * alcance— y las CALIFICA —cada flujo de revisión declara qué permiso lo habilita—. Pero
 * modificarlas no es cuestión de jerarquía: es que la fila del servidor se indexa por
 * `visita.id::sector.id` y `guardarVisitas` reescribe el correo con la identidad verificada.
 * Editar la visita de otro y sincronizar no la deja «editada por el jefe»: la pasa A NOMBRE
 * del jefe, y el registro del educador desaparece de su historial.
 *
 * Por eso **el administrador tampoco pasa**. No es una excepción olvidada: darle el paso
 * produciría exactamente la corrupción que esto evita, solo que con más frecuencia.
 * Corregir un dato ajeno se hace en la hoja, o pidiéndoselo a quien lo capturó.
 *
 * ── Por qué no basta con que hoy no se pueda ─────────────────────────────────────────
 *
 * Hoy es inalcanzable por accidente: el drawer lee de `localStorage`, que solo tiene lo
 * capturado en este teléfono, y las visitas del equipo viven en un espejo aparte que solo
 * `consultarVisitas` mezcla. Es decir, la regla la sostiene la FORMA DEL ALMACENAMIENTO.
 *
 * Y esa forma va a cambiar: `datos.js` declara `registrarFuente` como el punto por donde se
 * enchufa Supabase. En cuanto las visitas del equipo entren en el mismo almacén que lee el
 * drawer, no quedará nada que impida editarlas. El guardián tiene que existir antes de esa
 * migración, no después de la primera fila reatribuida.
 */

import { sesionActual } from '@core/puente';
import type { Visita } from '@core/tipos';

/**
 * ¿Puede la sesión actual escribir sobre esta visita?
 *
 * Ante la duda se permite, y es deliberado. Los dos casos dudosos —visita sin correo, sesión
 * sin resolver— son de captura local, y en ambos negar rompería lo único que esta app tiene
 * que hacer siempre: dejar registrar desde un pasillo sin señal. El riesgo que se ataja aquí
 * es escribir sobre lo AJENO, y eso exige un correo ajeno explícito.
 */
export function puedeEditarVisita(visita: Visita | null | undefined): boolean {
    if (!visita) return false;

    const dueno = String(visita.educador_correo || '').trim().toLowerCase();

    // Sin dueño declarado es local: capturada en este teléfono antes de que existiera la
    // sesión, o mientras Google todavía no había resuelto la identidad.
    if (!dueno) return true;

    const yo = String(sesionActual()?.correo || '').trim().toLowerCase();

    // Sin sesión resuelta no se bloquea la captura. La identidad llega de forma asíncrona y
    // negar durante esa ventana dejaría al educador sin poder guardar lo que acaba de hacer.
    if (!yo) return true;

    return dueno === yo;
}

/** El motivo, para poder decirlo en vez de fallar en silencio. */
export function motivoDeBloqueo(visita: Visita): string {
    return `Esta visita la registró ${visita.educador || visita.educador_correo || 'otra persona'}.`
        + ' Puedes consultarla y revisarla, pero no modificarla.';
}
