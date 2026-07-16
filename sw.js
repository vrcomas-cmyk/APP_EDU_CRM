// 🔴 CAMBIAMOS LA VERSIÓN A v3 PARA FORZAR LA ACTUALIZACIÓN
const CACHE_NAME = 'visitas-pwa-v3';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    './icon.svg'
];

// Instalar el SW y cachear los archivos base
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
    // Forzar al SW a tomar el control inmediatamente
    self.skipWaiting(); 
});

// Activar y limpiar cachés antiguas
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Interceptar peticiones
self.addEventListener('fetch', (e) => {
    // 1. Si la petición va a Google Script, NO usar caché
    if (e.request.url.includes('script.google.com')) {
        e.respondWith(fetch(e.request));
        return;
    }

    // 2. Para todo lo demás, intentar responder con caché, y si no, ir a la red
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            return cachedResponse || fetch(e.request).catch(() => {
                console.log("No hay internet y el recurso no está en caché:", e.request.url);
            });
        })
    );
});