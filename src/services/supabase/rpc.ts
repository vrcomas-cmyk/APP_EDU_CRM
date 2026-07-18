/**
 * Cliente de Supabase, limitado a llamar funciones (RPC).
 *
 * La app NO consulta tablas directamente, y no es por comodidad: la clave anónima viaja en el
 * paquete que descarga el navegador, así que cualquier permiso de lectura sobre una tabla es
 * un permiso concedido a internet entero. Todo pasa por funciones con `security definer` a
 * las que se les ha revocado el `execute` público.
 *
 * Lo que este cliente puede leer sin identidad verificada es deliberadamente poco: el perfil
 * del propio usuario y la aceptación de una invitación. Las visitas de otras personas se leen
 * por Apps Script, que sí valida el id_token de Google.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import { pedirJSON, ErrorDeRed } from '../http';

/**
 * Llama una función de Postgres.
 *
 * Devuelve `null` en vez de lanzar cuando la llamada falla. Es intencional y acotado a este
 * cliente: lo que se pide por aquí —permisos, invitación— tiene siempre un camino degradado
 * (el perfil de respaldo), y hacer que un Supabase caído tumbe el arranque dejaría sin app a
 * un educador que solo quiere capturar offline.
 *
 * Quien necesite distinguir "falló" de "devolvió vacío" usa `rpcEstricto`.
 */
export async function rpc<T = unknown>(
    funcion: string,
    parametros: Record<string, unknown> = {}
): Promise<T | null> {
    try {
        return await rpcEstricto<T>(funcion, parametros);
    } catch (err) {
        console.error(`RPC ${funcion} falló:`, err);
        return null;
    }
}

/** Igual, pero propaga el error. Para quien sí puede actuar ante el fallo. */
export async function rpcEstricto<T = unknown>(
    funcion: string,
    parametros: Record<string, unknown> = {}
): Promise<T> {
    if (!SUPABASE_ANON_KEY) {
        throw new ErrorDeRed('Falta la clave pública de Supabase.', funcion);
    }

    return pedirJSON<T>(`${SUPABASE_URL}/rest/v1/rpc/${funcion}`, {
        metodo: 'POST',
        cuerpo: parametros,
        cabeceras: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
    });
}
