/**
 * Búsqueda de sectores.
 *
 * Empareja por PALABRAS SUELTAS y en cualquier orden, no por subcadena. Es la misma regla que
 * el buscador de materiales, y por el mismo motivo: quien escribe "gasa simple" debe encontrar
 * "GASA DE ALGODÓN SIMPLE", que no contiene esa cadena literal.
 */

export const MAX_SUGERENCIAS = 60;

export function filtrarSectores(
    lista: string[],
    consulta: string,
    limite = MAX_SUGERENCIAS
): string[] {
    const q = (consulta || '').trim().toLowerCase();
    if (!q) return lista.slice(0, limite);

    const palabras = q.split(/\s+/).filter(Boolean);
    const salida: string[] = [];

    for (const item of lista) {
        const texto = item.toLowerCase();
        if (palabras.every(p => texto.includes(p))) {
            salida.push(item);
            if (salida.length === limite) break;
        }
    }

    return salida;
}
