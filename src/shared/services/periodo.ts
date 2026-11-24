/**
 * Periodos de tiempo para filtrar (hoy, esta semana, un mes…) convertidos al rango `desde`/`hasta`
 * que ya usan todos los filtros de la app. Sin estado y sin DOM.
 *
 * Las fechas son 'YYYY-MM-DD' en HORA LOCAL: `toISOString()` corre al día anterior o siguiente
 * según la zona, y «hoy» tiene que ser el día que la persona está viendo.
 */

export type ClavePeriodo = 'hoy' | 'semana' | 'mes' | 'mes-anterior' | 'todo';

export interface Rango { desde: string; hasta: string }

export const PERIODOS: Array<{ clave: ClavePeriodo; etiqueta: string }> = [
    { clave: 'hoy', etiqueta: 'Hoy' },
    { clave: 'semana', etiqueta: 'Esta semana' },
    { clave: 'mes', etiqueta: 'Este mes' },
    { clave: 'mes-anterior', etiqueta: 'Mes anterior' },
    { clave: 'todo', etiqueta: 'Todo' }
];

const dos = (n: number) => String(n).padStart(2, '0');

export function aIso(d: Date): string {
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Del 1 al último día del mes que contiene a `ref` (desplazado `delta` meses). */
export function rangoDeMes(ref: Date, delta = 0): Rango {
    const inicio = new Date(ref.getFullYear(), ref.getMonth() + delta, 1);
    const fin = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    return { desde: aIso(inicio), hasta: aIso(fin) };
}

/** 'YYYY-MM' → rango de ese mes. Devuelve null si el valor no es un mes. */
export function rangoDeMesTexto(valor: string): Rango | null {
    const m = /^(\d{4})-(\d{2})$/.exec(valor);
    if (!m) return null;
    return rangoDeMes(new Date(Number(m[1]), Number(m[2]) - 1, 1));
}

export function rangoDePeriodo(clave: ClavePeriodo, ref: Date = new Date()): Rango {
    switch (clave) {
        case 'hoy': {
            const hoy = aIso(ref);
            return { desde: hoy, hasta: hoy };
        }
        case 'semana': {
            // La semana va de lunes a domingo.
            const dia = (ref.getDay() + 6) % 7;
            const lunes = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - dia);
            const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
            return { desde: aIso(lunes), hasta: aIso(domingo) };
        }
        case 'mes':
            return rangoDeMes(ref);
        case 'mes-anterior':
            return rangoDeMes(ref, -1);
        case 'todo':
            return { desde: '', hasta: '' };
    }
}

/** Qué periodo predefinido coincide con este rango, si alguno. Sin rango equivale a «todo». */
export function periodoActivo(desde: string, hasta: string, ref: Date = new Date()): ClavePeriodo | null {
    if (!desde && !hasta) return 'todo';
    for (const { clave } of PERIODOS) {
        if (clave === 'todo') continue;
        const r = rangoDePeriodo(clave, ref);
        if (r.desde === desde && r.hasta === hasta) return clave;
    }
    return null;
}

const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/** Los últimos `n` meses (el actual primero) como opciones 'YYYY-MM' → «octubre 2026». */
export function ultimosMeses(n = 12, ref: Date = new Date()): Array<{ valor: string; etiqueta: string }> {
    return Array.from({ length: n }, (_, i) => {
        const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
        return { valor: `${d.getFullYear()}-${dos(d.getMonth() + 1)}`, etiqueta: `${MESES[d.getMonth()]} ${d.getFullYear()}` };
    });
}

/** El mes completo que cubre exactamente el rango, como 'YYYY-MM' (para marcarlo en el selector). */
export function mesDelRango(desde: string, hasta: string): string {
    const m = /^(\d{4}-\d{2})-01$/.exec(desde);
    if (!m) return '';
    const r = rangoDeMesTexto(m[1]!);
    return r && r.hasta === hasta ? m[1]! : '';
}
