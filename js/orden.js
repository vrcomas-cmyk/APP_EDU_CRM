/**
 * Orden de las listas que ve la persona: alfabético en español, y los números como números.
 *
 * Un solo comparador para toda la app. `localeCompare` suelto ordenaba "Área" después de la "Z"
 * (con `.sort()` a secas) y "10" antes que "2"; con `numeric` y la configuración regional 'es'
 * queda "2, 10", "Área" junto a la "A", y sin distinguir mayúsculas ni acentos ("sensitivity:
 * base"). El `Collator` se crea una vez: es mucho más rápido que llamar `localeCompare` con
 * opciones en cada comparación, y estas listas llegan a miles de clientes.
 *
 * Para listas cuyo orden TIENE significado (etapas de una estrategia, horas, estados), no se usa.
 */

const COLLATOR = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function compararEs(a, b) {
    return COLLATOR.compare(String(a ?? ''), String(b ?? ''));
}

/** Copia ordenada; `clave` saca el texto por el que se ordena de cada elemento. */
export function ordenarEs(lista, clave) {
    const copia = [...lista];
    return clave
        ? copia.sort((a, b) => compararEs(clave(a), clave(b)))
        : copia.sort(compararEs);
}
