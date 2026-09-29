/**
 * Evidencias (fotos/PDF) en Supabase Storage.
 *
 * El archivo viaja como binario directo al bucket privado `evidencias`, con una URL firmada
 * que emite la Edge Function `evidencia-url` tras validar la sesión. Nada de base64 dentro de
 * un JSON ni de pasar por Apps Script (su candado global ponía las subidas en fila y las
 * pasaba del tiempo límite).
 *
 * La ruta es fija por actividad, así que reintentar sobrescribe en vez de duplicar.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import { pedirJSON, ErrorDeRed } from '../http';

const BUCKET = 'evidencias';
const FUNCION = `${SUPABASE_URL}/functions/v1/evidencia-url`;

// Firmar es una llamada corta; el archivo en sí puede tardar en señal débil.
const TIMEOUT_FIRMA_MS = 15_000;
const TIMEOUT_SUBIDA_MS = 90_000;
const ESPERAS_REINTENTO_MS = [1_000, 3_000];

let cliente: SupabaseClient | null = null;

function clienteStorage(): SupabaseClient {
    // Sin sesión propia: la identidad viaja en el token de sesión de la app, no en Supabase Auth.
    cliente ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: 'pdt-evidencias' }
    });
    return cliente;
}

const cabeceras = () => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` });

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reintenta lo que pudo ser la señal (sin respuesta, 408/429/5xx); un 401/403/404 no se reintenta. */
async function conReintentos<T>(operacion: () => Promise<T>): Promise<T> {
    let ultimo: unknown;
    for (let intento = 0; intento <= ESPERAS_REINTENTO_MS.length; intento++) {
        try {
            return await operacion();
        } catch (err) {
            ultimo = err;
            const transitorio = !(err instanceof ErrorDeRed) || err.esTransitorio;
            if (!transitorio || intento === ESPERAS_REINTENTO_MS.length) break;
            await dormir(ESPERAS_REINTENTO_MS[intento] ?? 0);
        }
    }
    throw ultimo;
}

function conTiempoLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolver, rechazar) => {
        const reloj = setTimeout(() => rechazar(new ErrorDeRed(`La subida tardó más de ${ms} ms.`, FUNCION, null)), ms);
        promesa.then(
            (v) => { clearTimeout(reloj); resolver(v); },
            (e) => { clearTimeout(reloj); rechazar(e); }
        );
    });
}

interface FirmaSubida { ruta: string; token: string; signedUrl: string; }

/** Sube el archivo y devuelve la ruta dentro del bucket. Lanza `ErrorDeRed` si no se pudo. */
export async function subirEvidenciaAStorage(
    sesionToken: string, idActividad: string, nombre: string, archivo: Blob
): Promise<{ ruta: string }> {
    const tipo = archivo.type || 'application/octet-stream';

    return conReintentos(async () => {
        const firma = await pedirJSON<FirmaSubida>(FUNCION, {
            metodo: 'POST',
            cuerpo: { accion: 'subir', sesion_token: sesionToken, id_actividad: idActividad, nombre },
            cabeceras: cabeceras(),
            timeoutMs: TIMEOUT_FIRMA_MS
        });

        const { error } = await conTiempoLimite(
            clienteStorage().storage.from(BUCKET)
                .uploadToSignedUrl(firma.ruta, firma.token, archivo, { contentType: tipo, upsert: true }),
            TIMEOUT_SUBIDA_MS
        );
        if (error) {
            const estado = Number((error as { statusCode?: string | number }).statusCode) || null;
            throw new ErrorDeRed(`No se pudo subir la evidencia: ${error.message}`, FUNCION, estado);
        }
        return { ruta: firma.ruta };
    });
}

// Las URLs firmadas duran una hora; se reutilizan 50 min para no pedir una por cada pintado.
const VIGENCIA_CACHE_MS = 50 * 60 * 1000;
const cacheLectura = new Map<string, { url: string; hasta: number }>();
const enVuelo = new Map<string, Promise<string>>();

/** URL temporal para ver la evidencia (imagen/PDF). Lanza si no hay acceso o no existe. */
export function urlDeLecturaEvidencia(sesionToken: string, idActividad: string): Promise<string> {
    const guardada = cacheLectura.get(idActividad);
    if (guardada && guardada.hasta > Date.now()) return Promise.resolve(guardada.url);

    const previa = enVuelo.get(idActividad);
    if (previa) return previa;

    const pedido = conReintentos(() => pedirJSON<{ url: string }>(FUNCION, {
        metodo: 'POST',
        cuerpo: { accion: 'ver', sesion_token: sesionToken, id_actividad: idActividad },
        cabeceras: cabeceras(),
        timeoutMs: TIMEOUT_FIRMA_MS
    })).then(({ url }) => {
        cacheLectura.set(idActividad, { url, hasta: Date.now() + VIGENCIA_CACHE_MS });
        return url;
    }).finally(() => enVuelo.delete(idActividad));

    enVuelo.set(idActividad, pedido);
    return pedido;
}
