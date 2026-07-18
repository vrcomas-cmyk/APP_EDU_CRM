/**
 * Endpoints y credenciales públicas.
 *
 * Están AQUÍ y en ningún otro lugar. Antes vivían dentro de los módulos que los usaban
 * —la URL de Apps Script en `sync.js`, la de Supabase en `permisos.js`, cada uno con su
 * propio `fetch`—, y esa es exactamente la dependencia que estorba para migrar a DuckDB o R2:
 * no se puede cambiar el origen de los datos si el origen está escrito en quince archivos.
 *
 * ── Sobre la clave anónima ───────────────────────────────────────────────────────────
 *
 * `SUPABASE_ANON_KEY` es pública por diseño: viaja en el paquete que descarga el navegador y
 * cualquiera puede leerla. NO es un secreto y no debe tratarse como tal. Lo que protege los
 * datos son las políticas de la base y los `revoke execute` sobre las funciones, no esconder
 * esta cadena. Los datos de otros usuarios se leen a través de Apps Script, que sí verifica
 * el id_token de Google contra el dominio permitido.
 *
 * La clave de servicio (`service_role`) NUNCA aparece aquí. Vive en las propiedades del script
 * de Apps Script, del lado del servidor.
 */

/** Lee una variable de entorno de Vite sin romperse en Node (pruebas, scripts). */
function env(nombre: string): string | undefined {
    const meta = (import.meta as unknown as { env?: Record<string, string> }).env;
    return meta?.[nombre] ?? undefined;
}

export const APPS_SCRIPT_URL = env('VITE_APPS_SCRIPT_URL')
    ?? 'https://script.google.com/macros/s/AKfycbyRdGq_Tef6GGg8MWr7_VNLS-VLvx439MTWPpmjJQ3kjXk_6OvtrFc19ehh7_GoVBZZ/exec';

export const SUPABASE_URL = env('VITE_SUPABASE_URL')
    ?? 'https://fiplfsuhsqibzrpvjvbx.supabase.co';

export const SUPABASE_ANON_KEY = env('VITE_SUPABASE_ANON_KEY')
    ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcGxmc3Voc3FpYnpycHZqdmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODAyNjgsImV4cCI6MjA4OTg1NjI2OH0.YG3Fk8XJ_n9PGIYUHtoiy-MJNuWqJTsFBwooKnt1X5s';

/**
 * Cuánto se espera a una respuesta antes de darla por perdida.
 *
 * Sin tope, un `fetch` en una red de hospital —señal intermitente, no ausente— se queda
 * colgado indefinidamente y la app parece congelada. Es peor que fallar: al menos un fallo
 * deja reintentar.
 */
export const TIMEOUT_MS = 20_000;
