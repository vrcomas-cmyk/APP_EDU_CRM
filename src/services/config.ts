/**
 * Configuración por entorno.
 *
 * Todo sale de variables `VITE_*` (ver `.env`). Están AQUÍ y en ningún otro lugar: antes la
 * URL de Apps Script vivía en `sync.js` y la de Supabase en `permisos.js`, y esa es justo la
 * dependencia que impide cambiar de origen de datos sin editar quince archivos.
 *
 * ── Nada de esto es secreto ──────────────────────────────────────────────────────────
 *
 * El prefijo `VITE_` significa que el valor se INCRUSTA en el paquete que descarga el
 * navegador. La clave anónima de Supabase es pública por diseño; lo que protege los datos son
 * las políticas de la base y los `revoke execute` sobre las funciones, no esconder la cadena.
 *
 * La clave `service_role` NUNCA aparece aquí. Vive en las propiedades del script de Apps
 * Script, del lado del servidor.
 */

type Entorno = Record<string, string | undefined>;

/** `import.meta.env` no existe fuera de Vite; se lee con cuidado para no romper en Node. */
function entorno(): Entorno {
    return (import.meta as unknown as { env?: Entorno }).env ?? {};
}

/**
 * Lee una variable obligatoria.
 *
 * Falla en vez de caer en un valor por defecto, y la razón es concreta: un respaldo apuntando
 * a producción convierte un entorno mal configurado en escrituras silenciosas sobre los datos
 * reales. Es preferible que la app no arranque a que arranque contra la base equivocada.
 */
function requerida(nombre: string): string {
    const valor = entorno()[nombre]?.trim();
    if (!valor) {
        throw new Error(
            `Falta la variable de entorno ${nombre}. ` +
            'Cópiala de .env.example a .env.local, o revisa que .env esté presente.'
        );
    }
    return valor;
}

/** Lee una variable opcional numérica. Un valor absurdo cae al default en vez de propagarse. */
function numero(nombre: string, porDefecto: number): number {
    const crudo = entorno()[nombre];
    if (crudo === undefined || crudo === '') return porDefecto;

    const n = Number(crudo);
    if (!Number.isFinite(n) || n <= 0) {
        console.warn(`${nombre}="${crudo}" no es un número válido; se usa ${porDefecto}.`);
        return porDefecto;
    }
    return n;
}

export const APPS_SCRIPT_URL = requerida('VITE_APPS_SCRIPT_URL');
export const SUPABASE_URL = requerida('VITE_SUPABASE_URL');
export const SUPABASE_ANON_KEY = requerida('VITE_SUPABASE_ANON_KEY');

/**
 * Cuánto se espera a una respuesta antes de darla por perdida.
 *
 * Sin tope, un `fetch` en una red de hospital —señal intermitente, no ausente— se queda
 * colgado indefinidamente y la app parece congelada. Es peor que fallar: al menos un fallo
 * deja reintentar.
 */
export const TIMEOUT_MS = numero('VITE_TIMEOUT_MS', 20_000);

/**
 * Comprobación de seguridad, no de configuración.
 *
 * Una clave de Supabase lleva su rol dentro del JWT. Si alguien pega por error la
 * `service_role` en una variable `VITE_`, quedaría publicada en el paquete con permiso para
 * saltarse TODAS las políticas de la base. Es un error plausible —las dos cadenas se ven
 * iguales— y de consecuencias totales, así que se detecta al arrancar y no se deja pasar.
 */
export function verificarClaveAnonima(clave: string): void {
    try {
        const carga = clave.split('.')[1];
        if (!carga) return;
        const json = JSON.parse(atob(carga.replace(/-/g, '+').replace(/_/g, '/')));
        if (json.role && json.role !== 'anon') {
            throw new Error(
                `VITE_SUPABASE_ANON_KEY tiene rol "${json.role}", no "anon". ` +
                'Esa clave se publicaría en el navegador con permisos de servidor. Sustitúyela.'
            );
        }
    } catch (err) {
        // Un JWT ilegible no es motivo para tumbar la app: puede ser una clave de otro
        // formato. Solo se detiene el caso que sí se pudo leer Y resultó ser privilegiado.
        if (err instanceof Error && err.message.startsWith('VITE_SUPABASE_ANON_KEY')) throw err;
    }
}

verificarClaveAnonima(SUPABASE_ANON_KEY);
