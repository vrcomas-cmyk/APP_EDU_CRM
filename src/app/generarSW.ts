/**
 * Generación del service worker.
 *
 * La lista de archivos a precachear dejó de mantenerse a mano. Antes era un arreglo literal en
 * `sw.js` y había que acordarse de agregar cada módulo nuevo; olvidarlo funcionaba perfecto en
 * el escritorio del desarrollador y rompía la app en los teléfonos ya instalados, que se
 * quedaban sin ese archivo al abrir sin señal.
 *
 * Con el build los nombres llevan hash de contenido, así que mantenerla a mano ya no es solo
 * frágil: es imposible.
 *
 * ── Por qué precache y no caché al vuelo ─────────────────────────────────────────────
 *
 * Cachear lo que se va pidiendo es más simple, pero deja la PRIMERA visita sin señal después
 * de cada despliegue sin los archivos nuevos. Esta app se usa dentro de hospitales, donde la
 * primera visita sin señal es el caso normal, no el borde.
 */

/** Extensiones que vale la pena precachear. Los mapas de fuente pesan y no se usan offline. */
const PRECACHEABLES = /\.(js|css|html|json|svg|png|webp|woff2?)$/;

export interface OpcionesSW {
    /** Rutas de los archivos construidos, relativas a la raíz del sitio. */
    archivos: string[];
    /** Identificador del despliegue. Cambia el nombre del caché y purga el anterior. */
    version: string;
}

/**
 * Decide qué entra al precache.
 *
 * `index.html` y la raíz van siempre: son el punto de entrada, y sin ellos el resto de la
 * caché no sirve de nada porque no hay desde dónde arrancar.
 */
export function listaDeAssets(archivos: string[]): string[] {
    const utiles = archivos
        .filter(f => PRECACHEABLES.test(f))
        .filter(f => !f.endsWith('.map'))
        .map(f => (f.startsWith('./') || f.startsWith('/') ? f : `./${f}`));

    const conRaiz = new Set<string>(['./', './index.html', ...utiles]);
    return [...conRaiz].sort();
}

/**
 * Escribe el service worker completo.
 *
 * Se genera entero en vez de sustituir dentro de una plantilla: una plantilla con marcadores
 * se puede editar a mano dejando el marcador intacto, y entonces el build lo pisa en silencio.
 */
export function generarSW({ archivos, version }: OpcionesSW): string {
    const assets = listaDeAssets(archivos);

    return `// Generado en el build. No editar a mano: se regenera en cada \`npm run build\`.
const CACHE_NAME = 'visitas-pwa-${version}';
const ASSETS = ${JSON.stringify(assets, null, 4)};

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((llaves) => Promise.all(
            llaves.map((llave) => llave !== CACHE_NAME ? caches.delete(llave) : undefined)
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // El backend y la identidad NUNCA se cachean. Una copia vieja del script de sesión deja
    // a alguien atascado con un login que ya no funciona, y no hay forma de que lo note.
    if (url.includes('script.google.com') || url.includes('accounts.google.com')
        || url.includes('supabase.co')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // Navegación: se responde con el shell. Los nombres llevan hash, así que la copia
    // cacheada de index.html siempre apunta a los archivos de su propio despliegue.
    if (e.request.mode === 'navigate') {
        e.respondWith(
            caches.match('./index.html').then((r) => r || fetch(e.request))
        );
        return;
    }

    e.respondWith(
        caches.match(e.request).then((r) => r || fetch(e.request).catch(() => {
            console.log('Sin red y sin copia en caché:', url);
        }))
    );
});
`;
}
