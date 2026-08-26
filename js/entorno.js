/**
 * Aislamiento de almacenamiento local entre la app oficial y la de prueba.
 *
 * Las dos pueden acabar abiertas en el mismo navegador (misma máquina, misma persona probando
 * y trabajando a la vez) y sin esto compartirían claves de `localStorage` y la misma base de
 * IndexedDB: una visita capturada en la app de prueba aparecería en la oficial, o viceversa.
 * Esto no es hipotético — es justo lo que la separación oficial/prueba (Supabase, rama, .env)
 * existe para evitar, y el almacenamiento del navegador es la única pieza que esos tres no
 * cubren por sí solos.
 */

import { ENTORNO } from '../src/services/config';

/**
 * Núcleo puro (recibe el entorno en vez de leer `ENTORNO`): así se puede probar el
 * aislamiento con las dos ramas sin depender de qué `.env` cargó el proceso que corre la
 * prueba. `clave()` y `nombreDB()` de abajo son el atajo que usa el resto de la app.
 */
export function claveEn(entornoActual, nombre) {
    return entornoActual === 'pruebas' ? `pruebas:${nombre}` : nombre;
}

export function nombreDBEn(entornoActual, base) {
    return entornoActual === 'pruebas' ? `${base}-pruebas` : base;
}

/** Antepone el prefijo de entorno a una clave de `localStorage`. */
export function clave(nombre) {
    return claveEn(ENTORNO, nombre);
}

/** Nombre de base de IndexedDB para este entorno. */
export function nombreDB(base) {
    return nombreDBEn(ENTORNO, base);
}
