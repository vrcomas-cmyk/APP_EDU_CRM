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
 * Centinela de `VITE_APPS_SCRIPT_URL` para la app de prueba mientras no exista un despliegue
 * de Apps Script propio para ella: en vez de dejar la variable vacía (lo que tumbaría la app
 * entera, porque `requerida()` no lo permite) o apuntar por descuido al script real —que
 * escribiría en las hojas de Google de PRODUCCIÓN—, se usa este valor no-URL. `postear()` y
 * `leerCatalogos()` lo detectan y fallan con un mensaje claro en cada acción que lo necesite,
 * en vez de fallar como un `fetch` roto o, peor, escribir donde no debía.
 */
export const APPS_SCRIPT_PENDIENTE = APPS_SCRIPT_URL === 'PENDIENTE_PRUEBAS';

/**
 * Cuánto se espera a una respuesta antes de darla por perdida.
 *
 * Sin tope, un `fetch` en una red de hospital —señal intermitente, no ausente— se queda
 * colgado indefinidamente y la app parece congelada. Es peor que fallar: al menos un fallo
 * deja reintentar.
 */
export const TIMEOUT_MS = numero('VITE_TIMEOUT_MS', 20_000);

/**
 * Entorno declarado explícitamente por `.env`: qué app es esta, para el banner y para el
 * guardarraíl de abajo. No tiene valor por defecto — un default a "producción" convertiría
 * un `.env` mal copiado en escrituras silenciosas sobre los datos reales; mejor que la app no
 * arranque a que arranque sin saber quién es.
 */
export type EntornoApp = 'pruebas' | 'produccion';

function leerEntorno(): EntornoApp {
    const valor = entorno()['VITE_ENTORNO']?.trim().toLowerCase();
    if (valor === 'pruebas' || valor === 'produccion') return valor;
    throw new Error(
        `VITE_ENTORNO="${valor ?? ''}" no es válido (debe ser "pruebas" o "produccion"). ` +
        'Revisa el .env de esta rama.'
    );
}

export const ENTORNO: EntornoApp = leerEntorno();
export const ES_PRUEBAS = ENTORNO === 'pruebas';

const PROYECTO_OFICIAL_REF = 'fiplfsuhsqibzrpvjvbx';
const PROYECTO_PRUEBA_REF = 'cukxritzckostahasdsh';

/**
 * Guardarraíl de entorno: que `pruebas` y `produccion` sean dos apps de verdad, no una
 * bandera decorativa. Cruzar el par entorno↔proyecto (una `pruebas` apuntando a la base
 * oficial, o una `produccion` apuntando a la de prueba) es exactamente el error que este
 * guardarraíl existe para volver imposible — no advertirlo, impedir que la app arranque.
 */
// Función pura (recibe el entorno en vez de leer `ENTORNO` directamente) a propósito: así se
// puede probar el guardarraíl con las cuatro combinaciones sin depender de qué `.env` cargó
// el proceso que corre la prueba — exactamente el mismo motivo por el que `verificarClaveAnonima`
// recibe la clave como argumento en vez de leer `SUPABASE_ANON_KEY`.
export function verificarEntornoCoincideConProyecto(entornoActual: EntornoApp, url: string): void {
    if (entornoActual === 'produccion' && url.includes(PROYECTO_PRUEBA_REF)) {
        throw new Error(
            'VITE_ENTORNO=produccion pero VITE_SUPABASE_URL apunta al proyecto de PRUEBA ' +
            `(${PROYECTO_PRUEBA_REF}). Revisa el .env: esto dejaría "producción" sin sus datos reales.`
        );
    }
    if (entornoActual === 'pruebas' && url.includes(PROYECTO_OFICIAL_REF)) {
        throw new Error(
            'VITE_ENTORNO=pruebas pero VITE_SUPABASE_URL apunta al proyecto OFICIAL ' +
            `(${PROYECTO_OFICIAL_REF}). Esto escribiría sobre los datos reales. Revisa el .env.`
        );
    }
}

verificarEntornoCoincideConProyecto(ENTORNO, SUPABASE_URL);

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
