/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { generarSW } from './src/app/generarSW';

const ruta = (r: string) => fileURLToPath(new URL(r, import.meta.url));

/**
 * Genera `sw.js` con los nombres reales del build.
 *
 * La lista de precache ya no se mantiene a mano: con los archivos hasheados sería imposible,
 * y antes de los hashes ya era una fuente de errores —olvidar un módulo funcionaba en el
 * escritorio y rompía la app offline en los teléfonos ya instalados.
 */
function serviceWorkerGenerado(): Plugin {
    return {
        name: 'sw-generado',
        apply: 'build',
        generateBundle(_opciones, paquete) {
            // `public/` lo copia Vite aparte y no aparece en el bundle, así que hay que
            // leerlo del disco. Sin esto el ícono y el manifiesto quedarían fuera del
            // precache y la app instalada perdería su identidad al abrirse sin señal.
            const publicos = readdirSync(ruta('./public'), { withFileTypes: true })
                .filter(e => e.isFile())
                .map(e => e.name);

            const archivos = [...Object.keys(paquete), ...publicos];

            // La versión sale del contenido: dos builds idénticos no invalidan la caché de
            // nadie, y cualquier cambio real sí la purga.
            const version = 'v' + createHash('sha256')
                .update(archivos.sort().join('|'))
                .digest('hex')
                .slice(0, 8);

            this.emitFile({
                type: 'asset',
                fileName: 'sw.js',
                source: generarSW({ archivos, version })
            });
        }
    };
}

export default defineConfig({
    plugins: [react(), serviceWorkerGenerado()],

    resolve: {
        alias: {
            '@core': ruta('./src/core'),
            '@shared': ruta('./src/shared'),
            '@services': ruta('./src/services'),
            '@modules': ruta('./src/modules')
        }
    },

    build: {
        // Los navegadores objetivo son teléfonos Android de gama media en hospitales. No hay
        // razón para transpilar a ES5 y engordar el paquete: todos soportan módulos ES.
        target: 'es2022',
        outDir: 'dist',
        sourcemap: true,

        rollupOptions: {
            output: {
                /**
                 * React cambia de versión un par de veces al año; el código de la app, a
                 * diario. Separarlos deja que el navegador conserve el trozo grande en caché
                 * entre despliegues, que es lo que se nota en una red de hospital.
                 */
                manualChunks(id) {
                    if (id.includes('node_modules/react')) return 'react';
                    return undefined;
                }
            }
        }
    },

    test: {
        // Node por defecto: la mayoría de las pruebas son de dominio y no necesitan DOM.
        // Las de componentes piden `happy-dom` con una anotación al inicio del archivo.
        environment: 'node',
        setupFiles: ['./tests/entorno.js'],
        include: ['tests/**/*.test.{js,ts,tsx}'],
        // Las pruebas comparten `localStorage` y el estado de módulo de los singletons. En
        // paralelo se pisarían entre archivos y fallarían de forma no reproducible, que es
        // peor que fallar: enseña a ignorar la suite.
        fileParallelism: false
    }
});
