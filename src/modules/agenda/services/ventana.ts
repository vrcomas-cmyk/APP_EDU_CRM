/**
 * La ventana de horas de la rejilla, y la conversión entre píxeles y horas.
 *
 * En el calendario anterior esto era una variable de módulo (`let ventana = …`) que media
 * docena de funciones leían sin recibirla. Aquí se pasa explícita: no es purismo, es que ese
 * estado escondido hacía imposible probar el redondeo sin montar la pantalla entera.
 */

/** La jornada donde de verdad ocurre el trabajo. La rejilla parte de aquí y se estira. */
export const HORA_MIN = 7;
export const HORA_MAX = 19;

/** Menos que esto es un dedo o un mouse que tiembla, no un gesto. */
export const UMBRAL_ARRASTRE = 4;

export interface Ventana {
    desde: number;
    hasta: number;
}

export interface RangoVisible {
    inicio: Date | null;
    fin: Date | null;
}

/**
 * Ventana a mostrar: la jornada normal, estirada lo necesario para que quepa lo que hay.
 *
 * Sin esto, una visita a las 06:00 se dibujaría por encima del lienzo y simplemente no se
 * vería — el educador la daría por perdida.
 */
export function calcularVentana(visitas: RangoVisible[], incluirAhora: Date | null = null): Ventana {
    let desde = HORA_MIN;
    let hasta = HORA_MAX;

    for (const { inicio, fin } of visitas) {
        if (inicio) desde = Math.min(desde, Math.floor(inicio.getHours() + inicio.getMinutes() / 60));
        if (fin) hasta = Math.max(hasta, Math.ceil(fin.getHours() + fin.getMinutes() / 60));
    }

    // La línea de "ahora" también merece caber, si el día visible es hoy.
    if (incluirAhora) {
        const h = incluirAhora.getHours();
        desde = Math.min(desde, h);
        hasta = Math.max(hasta, h + 1);
    }

    return { desde: Math.max(0, desde), hasta: Math.min(24, Math.max(hasta, desde + 1)) };
}

export function altoDeVentana(v: Ventana): number {
    return v.hasta - v.desde;
}

/** Posición vertical del puntero → hora decimal dentro de la ventana. */
export function yAHora(clientY: number, rect: { top: number; height: number }, v: Ventana): number {
    if (rect.height <= 0) return v.desde;
    return v.desde + ((clientY - rect.top) / rect.height) * altoDeVentana(v);
}

export const horaADecimal = (hora: string | undefined): number => {
    const [h, m] = (hora || '0:0').split(':').map(Number);
    return (h || 0) + (m || 0) / 60;
};

export const decimalAHora = (dec: number): string => {
    const total = Math.max(0, Math.min(Math.round(dec * 60), 24 * 60));
    const h = Math.floor(total / 60);
    return `${String(h).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Las visitas reales empiezan y terminan en :00 o :30, no en :07. */
export const redondearMedia = (dec: number): number => Math.round(dec * 2) / 2;

/**
 * Ajusta una hora decimal a media hora, dentro de la ventana.
 *
 * ── El extremo importa ───────────────────────────────────────────────────────────────
 *
 * `esFin` no es un detalle: un INICIO no puede caer en la última hora —no habría espacio para
 * la visita— pero un FIN sí puede llegar al borde superior de la ventana.
 *
 * El calendario anterior usaba el mismo tope para los dos, y eso producía rangos INVERTIDOS al
 * arrastrar contra el borde inferior: con la rejilla hasta las 19:00, arrastrar de 18:30 a
 * 19:00 daba inicio 18:30 y fin 18:00. La visita nacía con la hora de término antes que la de
 * inicio, y nada en el formulario lo impedía guardar.
 */
export function ajustarAMedia(dec: number, v: Ventana, { esFin = false } = {}): string {
    const total = redondearMedia(dec);
    const techo = esFin ? v.hasta : v.hasta - 0.5;
    const acotado = Math.max(v.desde, Math.min(techo, total));

    const h = Math.floor(acotado);
    const m = acotado - h >= 0.5 ? 30 : 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
