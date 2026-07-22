/**
 * Set de iconos del producto.
 *
 * Antes el riel usaba emojis (🗓 ☀ 🎯 📊 ✓ ⚙): se ven distinto en cada sistema, no crecen
 * con la métrica/tema y rompen la uniformidad tipográfica `mono/sans` que define al resto de
 * la app. Aquí hay un único set lineal: trazo de 1.6 a 24px y `currentColor`, así hereda el
 * tono (`--ink`, `--muted`, `--st-*`) igual que cualquier texto.
 *
 * Las claves son deliberadamente idénticas a las de `ClaveModulo`, no un enum paralelo: un
 * icono que no exista para una clave es un bug, y TypeScript lo grita.
 *
 * El sprite se declara en JSX — dentro de un `<svg aria-hidden>` mero — y elijo dejarlo
 * dentro del árbol React en vez de colgarlo de `document.body` a mano. Razón: los paths se
 * declaran UNA vez en un solo sitio (este archivo) y cada `<Icono>` es solo una referencia
 * `<use href="#...">`. El navegador cachea el path y no duplica el DOM por nav-item.
 */

import { type JSX } from 'react';
import { type ClaveModulo } from '../../app/navegacion/modulos';

export type ClaveIcono = ClaveModulo;

const ICONOS: Record<ClaveIcono, { titulo: string; cuerpo: JSX.Element }> = {
    // Calendario: rejilla con días y un día marcado.
    calendario: {
        titulo: 'Calendario',
        cuerpo: (
            <>
                <rect x="3" y="4" width="18" height="17" rx="2" />
                <path d="M3 9h18" />
                <path d="M8 2v4M16 2v4" />
                <path d="M7 14h3M14 14h3M7 18h3" />
            </>
        )
    },
    // Mi día: sol con rayos — el "hoy" cobra relieve sin copiar el emoji ☀.
    'mi-dia': {
        titulo: 'Mi día',
        cuerpo: (
            <>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </>
        )
    },
    // Estrategias: diana concéntrica con flecha clavada en el centro.
    estrategias: {
        titulo: 'Estrategias',
        cuerpo: (
            <>
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="4" />
                <path d="M12 14l7-7" />
                <path d="M14 7h5v5" />
            </>
        )
    },
    // Indicadores: barras comparativas. Más cercano al lenguaje del Dashboard que un 📊.
    dashboard: {
        titulo: 'Indicadores',
        cuerpo: (
            <>
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
            </>
        )
    },
    // Revisión: check en círculo — mismo gesto que el `.dot` que ya vemos en el calendario
    // para una visita resuelta. La coherencia con ese punto pesa más que el ✓ por sí solo.
    revision: {
        titulo: 'Revisión',
        cuerpo: (
            <>
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5l3 3 5-6" />
            </>
        )
    },
    // Administración: engranaje. Sigue siendo el símbolo universal de "configuración".
    administracion: {
        titulo: 'Administración',
        cuerpo: (
            <>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
                <circle cx="12" cy="12" r="8" />
            </>
        )
    }
};

/**
 * Sprite único: un `<svg>` con `width=0 height=0` que solo contiene los `<symbol>` con cada
 * path. No se vé; vive en un rincón del DOM y cada `<Icono>` lo referencia por `<use>`.
 *
 * Lo MONTA quien lo necesite (hoy: `Navegacion`). La app no es servidor, así que no hay
 * riesgo de dos sprites a la vez; de haberlo, `<use href="#...">` resuelve al primero y
 * demás devienen moot.
 */
export function SpriteIconos() {
    return (
        <svg
            aria-hidden="true"
            width="0"
            height="0"
            style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        >
            {Object.entries(ICONOS).map(([clave, { titulo, cuerpo }]) => (
                <symbol
                    key={clave}
                    id={`ico-${clave}`}
                    viewBox="0 0 24 24"
                    role="img"
                    aria-label={titulo}
                >
                    <title>{titulo}</title>
                    {cuerpo}
                </symbol>
            ))}
        </svg>
    );
}

export interface PropsIcono {
    clave: ClaveIcono;
    /** En px. Por defecto 18, el tamaño del riel; la barra inferior y modales pueden pedir más. */
    tam?: number;
    /** Decorativo por defecto: el riel lleva el rótulo al lado. Ponerlo en `false` cuando
     *  el icono sea el único canal (un botón-icono) para que el lector lo anuncie. */
    decorativo?: boolean;
    className?: string;
}

export function Icono({ clave, tam = 18, decorativo = true, className }: PropsIcono) {
    return (
        <svg
            className={className ? `ico ${className}` : 'ico'}
            width={tam}
            height={tam}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden={decorativo ? 'true' : undefined}
            role={decorativo ? undefined : 'img'}
            aria-label={decorativo ? undefined : ICONOS[clave].titulo}
        >
            <use href={`#ico-${clave}`} />
        </svg>
    );
}
