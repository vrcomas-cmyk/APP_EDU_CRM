/**
 * El único lugar del proyecto donde se llama a `fetch`.
 *
 * Existe para que ningún componente ni módulo de dominio hable con la red directamente. Su
 * trabajo es aburrido a propósito: poner un tope de tiempo, normalizar los errores y no
 * inventarse reintentos que la capa de arriba no pidió.
 */

import { TIMEOUT_MS } from './config';

/**
 * Error de red o de protocolo.
 *
 * Lleva `estado` para que quien llame pueda distinguir lo que se arregla reintentando (no
 * hubo red) de lo que no (401, 403, 422). Reintentar un 403 para siempre es cómo se hace una
 * cola que nunca vacía.
 */
export class ErrorDeRed extends Error {
    readonly estado: number | null;
    readonly url: string;

    constructor(mensaje: string, url: string, estado: number | null = null) {
        super(mensaje);
        this.name = 'ErrorDeRed';
        this.estado = estado;
        this.url = url;
    }

    /** ¿Vale la pena volver a intentarlo más tarde? */
    get esTransitorio(): boolean {
        if (this.estado === null) return true;               // no hubo respuesta: pudo ser la señal
        if (this.estado === 408 || this.estado === 429) return true;
        return this.estado >= 500;
    }
}

export interface OpcionesPeticion {
    metodo?: 'GET' | 'POST';
    cuerpo?: unknown;
    cabeceras?: Record<string, string>;
    /** Ms antes de abortar. Se pasa explícito solo cuando una llamada es legítimamente lenta. */
    timeoutMs?: number;
    señal?: AbortSignal;
}

/**
 * Petición JSON. Devuelve el cuerpo ya interpretado, o lanza `ErrorDeRed`.
 *
 * El timeout se implementa con `AbortController` y no con una carrera de promesas: una
 * carrera deja la petición viva consumiendo datos móviles aunque su resultado ya se descartó.
 */
export async function pedirJSON<T = unknown>(url: string, opciones: OpcionesPeticion = {}): Promise<T> {
    const { metodo = 'GET', cuerpo, cabeceras = {}, timeoutMs = TIMEOUT_MS, señal } = opciones;

    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), timeoutMs);
    if (señal) señal.addEventListener('abort', () => control.abort(), { once: true });

    let respuesta: Response;
    try {
        respuesta = await fetch(url, {
            method: metodo,
            headers: cuerpo !== undefined
                ? { 'Content-Type': 'application/json', ...cabeceras }
                : cabeceras,
            body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
            signal: control.signal
        });
    } catch (err) {
        const abortado = err instanceof Error && err.name === 'AbortError';
        throw new ErrorDeRed(
            abortado ? `La petición tardó más de ${timeoutMs} ms.` : 'No se pudo conectar.',
            url,
            null
        );
    } finally {
        clearTimeout(reloj);
    }

    if (!respuesta.ok) {
        // El cuerpo de un error suele traer la razón real; si no se puede leer, no importa.
        const detalle = await respuesta.text().catch(() => '');
        throw new ErrorDeRed(
            `${respuesta.status} ${respuesta.statusText}${detalle ? ` — ${detalle.slice(0, 300)}` : ''}`,
            url,
            respuesta.status
        );
    }

    const texto = await respuesta.text();
    if (!texto) return undefined as T;

    try {
        return JSON.parse(texto) as T;
    } catch {
        throw new ErrorDeRed('La respuesta no es JSON válido.', url, respuesta.status);
    }
}

/** ¿Hay señal? Se pregunta aquí para que nadie más toque `navigator` directamente. */
export function hayConexion(): boolean {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}
