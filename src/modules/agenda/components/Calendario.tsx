/**
 * El calendario. Es el producto, no una pantalla del producto.
 *
 * Día y Semana comparten rejilla. Mes tira el eje de horas. Móvil cambia de forma a agenda
 * vertical. Las tres decisiones están explicadas en sus componentes.
 */

import { useCallback, useEffect, useMemo } from 'react';
import {
    claveDia, claveHoy, diasDeSemana, etiquetaMes, etiquetaRangoSemana, etiquetaDiaLarga,
    inicioDe, finDe, reagendarVisita, type Avisar
} from '@core/puente';

import { useCalendario, type ModoCalendario } from '../hooks/useCalendario';
import { useArrastreCreacion, useArrastreTarjeta } from '../hooks/useArrastre';
import { calcularVentana } from '../services/ventana';
import { RejillaHoras } from './RejillaHoras';
import { VistaMes } from './VistaMes';
import { AgendaMovil } from './AgendaMovil';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Visita } from '@core/tipos';

export interface PropsCalendario {
    /** Cambia cuando algo de fuera modifica las visitas; fuerza releer el almacén. */
    version: number;
    onAbrirVisita: (id: string) => void;
    onCrearEn: (dia: string, inicio: string, fin: string | null) => void;
    onCambio: () => void;
    avisar: Avisar;
    /** Enlaza los controles que todavía viven en index.html. Ver `useControlesExternos`. */
    controles?: ControlesExternos;
    /** Publica los mandos de navegación para que `app.js` pueda seguir llamándolos. */
    publicarMandos?: (mandos: MandosNavegacion) => void;
}

export interface MandosNavegacion {
    irAHoy: () => void;
    irADia: (dia: string) => void;
    setModo: (m: ModoCalendario) => void;
}

export function Calendario({
    version, onAbrirVisita, onCrearEn, onCambio, avisar, controles, publicarMandos
}: PropsCalendario) {
    const { modo, movil, cursor, setModo, setCursor, irAHoy, irADia, mover } = useCalendario();

    /**
     * Las visitas del día. Los BORRADORES no cuentan: una visita a medio capturar todavía no
     * ocupa ese hueco, y pintarla haría que se planeara alrededor de algo que puede terminar
     * descartado.
     */
    const visitas = useMemo(
        () => repo.leerVisitas().filter(v => !v.borrador),
        // `version` es la dependencia real: el almacén no avisa cuando cambia.
        [version]
    );

    const porDia = useMemo(() => {
        const mapa = new Map<string, Visita[]>();
        for (const v of visitas) {
            if (!v.dia) continue;
            const lista = mapa.get(v.dia);
            if (lista) lista.push(v); else mapa.set(v.dia, [v]);
        }
        return mapa;
    }, [visitas]);

    const visitasDe = useCallback((clave: string) => porDia.get(clave) ?? [], [porDia]);

    const claves = useMemo(() => {
        if (modo === 'semana') return diasDeSemana(cursor).slice(0, 5);
        return [claveDia(cursor)];
    }, [modo, cursor]);

    // La ventana se recalcula por vista: una visita a las 06:00 tiene que verse, no dibujarse
    // fuera del lienzo y desaparecer.
    const ventana = useMemo(() => {
        const rangos = claves.flatMap(visitasDe).map(v => ({ inicio: inicioDe(v), fin: finDe(v) }));
        return calcularVentana(rangos, claves.includes(claveHoy()) ? new Date() : null);
    }, [claves, visitasDe]);

    const titulo = useMemo(() => {
        if (movil || modo === 'semana') return etiquetaRangoSemana(cursor);
        if (modo === 'mes') return etiquetaMes(cursor);
        return etiquetaDiaLarga(claveDia(cursor));
    }, [movil, modo, cursor]);

    /** Reagendar SIEMPRE pide motivo: sin él no es un campo editable, es un rastro que se borra. */
    const pedirMotivoYReagendar = useCallback((
        id: string,
        cambios: { dia?: string; hora_inicio?: string; hora_fin?: string },
        pregunta: string
    ) => {
        const motivo = prompt(pregunta);
        if (motivo === null) return;   // canceló: nada mutó, la tarjeta sigue en su sitio

        const r = reagendarVisita(id, {
            dia: cambios.dia ?? '',
            hora_inicio: cambios.hora_inicio ?? '',
            hora_fin: cambios.hora_fin ?? '',
            motivo
        });

        if (!r.ok) { avisar(r.error || 'No se pudo reagendar.', { estado: 'sin-registrar' }); return; }

        avisar('Visita reagendada. Queda el registro del cambio.', { estado: 'completa' });
        onCambio();
    }, [avisar, onCambio]);

    const alCrear = useArrastreCreacion({ ventana, onCrear: onCrearEn });
    const { alMover, alRedimensionar } = useArrastreTarjeta({
        ventana, onAbrir: onAbrirVisita, onReagendar: pedirMotivoYReagendar
    });

    useControlesExternos(controles, { titulo, modo, movil, setModo, irAHoy, mover });

    // Se publican en un efecto y no durante el render: llamar hacia fuera mientras React está
    // renderizando es justo lo que StrictMode existe para detectar.
    useEffect(() => {
        publicarMandos?.({ irAHoy, irADia, setModo });
    }, [publicarMandos, irAHoy, irADia, setModo]);

    if (movil) {
        return (
            <AgendaMovil
                cursor={cursor}
                visitasDe={visitasDe}
                onElegirDia={setCursor}
                onAbrir={onAbrirVisita}
            />
        );
    }

    if (modo === 'mes') {
        return <VistaMes cursor={cursor} visitasDe={visitasDe} onElegirDia={irADia} />;
    }

    return (
        <RejillaHoras
            claves={claves}
            clase={modo === 'semana' ? 'semana' : 'dia'}
            ventana={ventana}
            visitasDe={visitasDe}
            onPointerDownColumna={alCrear}
            onPointerDownCuerpo={alMover}
            onPointerDownManija={alRedimensionar}
            onAbrir={onAbrirVisita}
        />
    );
}

// ---------- puente con los controles de index.html ----------

export interface ControlesExternos {
    titulo: HTMLElement | null;
    anterior: HTMLElement | null;
    siguiente: HTMLElement | null;
    hoy: HTMLElement | null;
    modos: HTMLElement | null;
}

/**
 * Enlaza la barra de navegación, que todavía vive en `index.html` fuera del árbol de React.
 *
 * Es un artefacto de la migración y se nota: React no debería estar poniendo `textContent` a
 * mano. Se hace así en vez de portar también el encabezado porque ese cambio arrastraría la
 * cabecera entera —sesión, contadores, botones de módulo— y esta iteración es del calendario.
 *
 * Cuando el shell se porte, este hook desaparece y los controles serán componentes normales.
 */
function useControlesExternos(
    controles: ControlesExternos | undefined,
    estado: {
        titulo: string;
        modo: ModoCalendario;
        movil: boolean;
        setModo: (m: ModoCalendario) => void;
        irAHoy: () => void;
        mover: (d: number) => void;
    }
) {
    const { titulo, modo, movil, setModo, irAHoy, mover } = estado;

    useEffect(() => {
        if (controles?.titulo) controles.titulo.textContent = titulo;
    }, [controles, titulo]);

    // El selector de modos no existe en móvil: ahí solo hay agenda, y ofrecer "Semana" sería
    // ofrecer una vista que no se puede dibujar.
    useEffect(() => {
        if (controles?.modos) (controles.modos as HTMLElement & { hidden: boolean }).hidden = movil;
    }, [controles, movil]);

    useEffect(() => {
        const botones = controles?.modos?.querySelectorAll<HTMLButtonElement>('button');
        botones?.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    }, [controles, modo]);

    useEffect(() => {
        if (!controles) return;

        const atras = () => mover(-1);
        const adelante = () => mover(1);

        controles.anterior?.addEventListener('click', atras);
        controles.siguiente?.addEventListener('click', adelante);
        controles.hoy?.addEventListener('click', irAHoy);

        const botones = [...(controles.modos?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const alElegirModo = botones.map(b => {
            const fn = () => setModo(b.dataset.modo as ModoCalendario);
            b.addEventListener('click', fn);
            return fn;
        });

        return () => {
            controles.anterior?.removeEventListener('click', atras);
            controles.siguiente?.removeEventListener('click', adelante);
            controles.hoy?.removeEventListener('click', irAHoy);
            botones.forEach((b, i) => b.removeEventListener('click', alElegirModo[i]!));
        };
    }, [controles, mover, irAHoy, setModo]);
}
