/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const ruta = (r: string) => fileURLToPath(new URL(r, import.meta.url));

export default defineConfig({
    plugins: [react()],

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
        environment: 'node',
        setupFiles: ['./tests/entorno.js'],
        include: ['tests/**/*.test.{js,ts}'],
        // Las pruebas comparten `localStorage` y el estado de módulo de los singletons. En
        // paralelo se pisarían entre archivos y fallarían de forma no reproducible, que es
        // peor que fallar: enseña a ignorar la suite.
        fileParallelism: false
    }
});
