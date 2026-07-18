/**
 * Cliente de Google Apps Script.
 *
 * Es el backend operativo: escribe en Google Sheets y guarda los archivos en Drive. Seguirá
 * siéndolo mientras no haya una decisión explícita de cambiarlo, aunque el espejo de lectura
 * ya viva en Supabase.
 *
 * ── Dos trampas que hay que respetar ─────────────────────────────────────────────────
 *
 * 1. `Content-Type: text/plain`. Apps Script NO responde al preflight OPTIONS, así que
 *    cualquier cabecera que lo dispare —`application/json` incluido— rompe la sincronización
 *    entera. El cuerpo sigue siendo JSON; lo que se miente es el tipo declarado.
 *
 * 2. El id_token viaja en el CUERPO, no en `Authorization`. Un header de autorización
 *    dispararía el mismo preflight que se está evitando. Quien de verdad lo valida es el
 *    servidor (ver apps-script/Codigo.gs), contra el CLIENT_ID y el dominio permitido.
 *
 * Se manda el token que haya en caché aunque esté vencido: el servidor lo rechaza con un
 * mensaje claro y la fila queda pendiente para el siguiente intento. Comprobarlo aquí solo
 * duplicaría la regla en un lugar donde no se puede confiar en ella.
 */

import { APPS_SCRIPT_URL, TIMEOUT_MS } from '../config';
import { ErrorDeRed } from '../http';

export interface RespuestaAppsScript {
    status?: 'ok' | 'error';
    message?: string;
    [clave: string]: unknown;
}

/** De dónde saca el token la capa de servicios, sin importarle cómo se obtuvo la sesión. */
export type ProveedorDeToken = () => string;

let obtenerToken: ProveedorDeToken = () => '';

/**
 * Inyecta el proveedor de token. Lo llama el arranque de la app.
 *
 * Se inyecta en vez de importar el módulo de sesión para que la dependencia apunte hacia
 * afuera: los servicios no deben saber que existe Google Identity, solo que alguien les
 * puede dar una cadena.
 */
export function configurarToken(proveedor: ProveedorDeToken): void {
    obtenerToken = proveedor;
}

/**
 * POST al Apps Script. Devuelve el cuerpo interpretado.
 *
 * No usa `pedirJSON` justo por la cabecera `text/plain`: meter la excepción en el helper
 * genérico obligaría a todos los demás servicios a cargar con una rareza que solo aplica
 * aquí.
 */
export async function postear<T extends RespuestaAppsScript = RespuestaAppsScript>(
    cuerpo: Record<string, unknown>
): Promise<T> {
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);

    let respuesta: Response;
    try {
        respuesta = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...cuerpo, id_token: obtenerToken() }),
            signal: control.signal
        });
    } catch (err) {
        const abortado = err instanceof Error && err.name === 'AbortError';
        throw new ErrorDeRed(
            abortado ? 'El servidor no respondió a tiempo.' : 'No se pudo conectar con el servidor.',
            APPS_SCRIPT_URL
        );
    } finally {
        clearTimeout(reloj);
    }

    if (!respuesta.ok) {
        throw new ErrorDeRed(`Respuesta del servidor: ${respuesta.status}`, APPS_SCRIPT_URL, respuesta.status);
    }

    const resultado = (await respuesta.json().catch(() => null)) as T | null;

    // Apps Script contesta 200 con `status: 'error'` en el cuerpo: un fallo de negocio no es
    // un fallo de HTTP. Si no se mirara, un error se tomaría por éxito y la fila se marcaría
    // como sincronizada sin haberse escrito.
    if (resultado && resultado.status === 'error') {
        throw new ErrorDeRed(resultado.message || 'Apps Script reportó un error.', APPS_SCRIPT_URL, respuesta.status);
    }

    return (resultado ?? ({} as T));
}

/** GET sin parámetros: devuelve los catálogos. Es la única lectura pública del script. */
export async function leerCatalogos<T = unknown>(): Promise<T> {
    const respuesta = await fetch(APPS_SCRIPT_URL);
    if (!respuesta.ok) {
        throw new ErrorDeRed(`Error al descargar catálogos: ${respuesta.status}`, APPS_SCRIPT_URL, respuesta.status);
    }
    return (await respuesta.json()) as T;
}
