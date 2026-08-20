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
 * 2. La identidad viaja en el CUERPO, no en `Authorization`. Un header de autorización
 *    dispararía el mismo preflight que se está evitando. Quien de verdad la valida es el
 *    servidor (ver apps-script/Codigo.gs: `resolverIdentidad`), contra Supabase (sesión propia)
 *    o contra Google (id_token de una sesión vieja aún no migrada).
 *
 * Se manda el token que haya en caché aunque esté vencido: el servidor lo rechaza con un
 * mensaje claro y la fila queda pendiente para el siguiente intento. Comprobarlo aquí solo
 * duplicaría la regla en un lugar donde no se puede confiar en ella.
 */

import { APPS_SCRIPT_URL, TIMEOUT_MS } from '../config';
import { ErrorDeRed } from '../http';
import { simulacionActiva } from '../../../js/simulacion.js';

export interface RespuestaAppsScript {
    status?: 'ok' | 'error';
    message?: string;
    [clave: string]: unknown;
}

/**
 * De dónde saca la identidad la capa de servicios, sin importarle cómo se obtuvo la sesión.
 *
 * Devuelve `{ sesion_token }` para la sesión propia (el caso normal desde que existe el canje
 * en el servidor) o `{ id_token }` para una sesión vieja de Google aún no migrada — nunca los
 * dos a la vez. `resolverIdentidad` en Apps Script sabe leer cualquiera de los dos.
 */
export type ProveedorDeToken = () => { sesion_token: string } | { id_token: string };

let obtenerToken: ProveedorDeToken = () => ({ id_token: '' });

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
    // "Ver como" es de solo lectura: toda acción de escritura empieza con `guardar` o `subir`
    // (`guardarVisitas`, `subirEvidencia`…), las de lectura con `leer` (`leerRBAC`…). Cortar
    // aquí, y no solo escondiendo botones en la UI, es lo que hace la regla real: un botón
    // deshabilitado es cosmética, esta es la puerta de verdad hacia Apps Script.
    const accion = String(cuerpo.action || '');
    if (simulacionActiva() && !accion.startsWith('leer')) {
        throw new ErrorDeRed(
            'Estás viendo la app como otro rol o usuario: esto es solo lectura. Sal de "ver como" para guardar cambios de verdad.',
            APPS_SCRIPT_URL
        );
    }

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), TIMEOUT_MS);

    let respuesta: Response;
    try {
        respuesta = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ ...cuerpo, ...obtenerToken() }),
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
