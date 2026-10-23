/** Formato de moneda de las estrategias (pesos mexicanos). */

const formato = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

/** `1234.5` → "$1,234.50"; sin valor → "—". */
export function moneda(valor?: number | null): string {
    return typeof valor === 'number' && Number.isFinite(valor) ? formato.format(valor) : '—';
}

/** Lo que el usuario teclea ("$1,234.50", "1234.5") → número; vacío o inválido → `undefined`. */
export function aNumeroMoneda(texto: string): number | undefined {
    const limpio = texto.replace(/[^0-9.]/g, '');
    if (!limpio) return undefined;
    const n = Number(limpio);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}
