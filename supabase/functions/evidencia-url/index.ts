// Emite URLs firmadas del bucket privado `evidencias`, tras validar la sesión de la PWA.
//
//   { accion: 'subir', sesion_token, id_actividad, nombre }  → { ruta, token, signedUrl }
//   { accion: 'ver',   sesion_token, id_actividad }          → { url }
//
// La autorización vive en Postgres (pdt_evidencia_autorizar_sesion / pdt_evidencia_puede_ver_sesion,
// que validan el token contra pdt_sesiones y el alcance por jerarquía); aquí solo se firma.
// La ruta es fija por actividad (`<id_actividad><ext>`): un reintento sobrescribe, no duplica.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const BUCKET = 'evidencias';
const VIGENCIA_LECTURA_S = 3600;

function responder(cuerpo: unknown, status = 200): Response {
    return new Response(JSON.stringify(cuerpo), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json' }
    });
}

/** Solo la extensión (minúsculas, alfanumérica): el resto del nombre nunca entra a la ruta. */
function extension(nombre: unknown): string {
    const m = String(nombre ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? `.${m[1]}` : '';
}

/** El id de actividad forma parte de la ruta: solo caracteres inocuos. */
function idSeguro(id: unknown): string | null {
    const s = String(id ?? '');
    return /^[A-Za-z0-9_-]{1,80}$/.test(s) ? s : null;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return responder({ error: 'Método no permitido' }, 405);

    try {
        const { accion, sesion_token: token, id_actividad: idCrudo, nombre } = await req.json();
        const id = idSeguro(idCrudo);
        if (!token || !id) return responder({ error: 'Faltan datos' }, 400);

        const admin = createClient(
            Deno.env.get('SUPABASE_URL')!,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
            { auth: { persistSession: false } }
        );

        if (accion === 'subir') {
            const { data, error } = await admin.rpc('pdt_evidencia_autorizar_sesion', {
                p_sesion_token: token, p_id_actividad: id
            });
            if (error || !data?.ok) return responder({ error: 'Sesión no reconocida' }, 401);

            const ruta = `${id}${extension(nombre)}`;
            const { data: firma, error: errFirma } = await admin.storage
                .from(BUCKET).createSignedUploadUrl(ruta, { upsert: true });
            if (errFirma || !firma) return responder({ error: 'No se pudo preparar la subida' }, 500);

            return responder({ ruta, token: firma.token, signedUrl: firma.signedUrl });
        }

        if (accion === 'ver') {
            const { data: ruta, error } = await admin.rpc('pdt_evidencia_puede_ver_sesion', {
                p_sesion_token: token, p_id_actividad: id
            });
            if (error) return responder({ error: 'Sesión no reconocida' }, 401);
            if (!ruta) return responder({ error: 'Sin acceso o sin archivo' }, 404);

            const { data: firma, error: errFirma } = await admin.storage
                .from(BUCKET).createSignedUrl(ruta, VIGENCIA_LECTURA_S);
            if (errFirma || !firma) return responder({ error: 'No se pudo firmar la lectura' }, 500);

            return responder({ url: firma.signedUrl, expira_en: VIGENCIA_LECTURA_S });
        }

        return responder({ error: 'Acción desconocida' }, 400);
    } catch (err) {
        console.error('evidencia-url falló:', err);
        return responder({ error: 'Error interno' }, 500);
    }
});
