/**
 * Los tres gestos del calendario: crear arrastrando, mover una visita y redimensionarla.
 *
 * ── Por qué esto NO pasa por el estado de React ──────────────────────────────────────
 *
 * Un `setState` por cada `pointermove` re-renderizaría el calendario entero sesenta veces por
 * segundo, con sus tarjetas, su reparto en columnas y su rejilla. En un teléfono de gama media
 * eso se siente como que el arrastre "se pega", que es justo el gesto donde peor se tolera.
 *
 * Así que durante el arrastre se mutan directamente las propiedades CSS de un elemento
 * FANTASMA, y solo al soltar se toca el estado —una vez, con el resultado final—. Es la misma
 * técnica del calendario anterior; no era un atajo, era la decisión correcta.
 *
 * El fantasma además deja la tarjeta original quieta en su sitio, que es lo que permite
 * cancelar el gesto sin haber movido nada de verdad.
 */

import { useCallback, useRef } from 'react';
import {
    rangoDeCreacion, rangoDeMovimiento, nuevoFinPorRedimension, esArrastre, type Rango
} from '../services/arrastre';
import { UMBRAL_ARRASTRE, yAHora, horaADecimal, type Ventana } from '../services/ventana';

/** Alto de una hora en píxeles, según la variable CSS. El 46 es el valor de la hoja. */
function altoDeHoraPx(): number {
    if (typeof getComputedStyle !== 'function') return 46;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--hour-h').trim();
    return parseFloat(v) || 46;
}

function ponerPosicion(nodo: HTMLElement, desplazamiento: number, duracion: number) {
    nodo.style.setProperty('--s', desplazamiento.toFixed(3));
    nodo.style.setProperty('--dur', duracion.toFixed(3));
}

// ---------- crear arrastrando sobre un hueco ----------

export interface OpcionesCreacion {
    ventana: Ventana;
    /** Clic seco: crear con la duración por defecto. Arrastre: crear con la del gesto. */
    onCrear: (dia: string, inicio: string, fin: string | null) => void;
}

export function useArrastreCreacion({ ventana, onCrear }: OpcionesCreacion) {
    return useCallback((e: React.PointerEvent<HTMLDivElement>, dia: string) => {
        // Solo botón principal, y nunca sobre una tarjeta: ahí manda el gesto de la tarjeta.
        if (e.button !== 0) return;
        if ((e.target as HTMLElement).closest('.ev')) return;

        const columna = e.currentTarget;
        const rect = columna.getBoundingClientRect();
        const horaInicial = yAHora(e.clientY, rect, ventana);
        const inicioY = e.clientY;

        let arrastrando = false;
        let fantasma: HTMLDivElement | null = null;

        const rangoEn = (clientY: number): Rango =>
            rangoDeCreacion(horaInicial, yAHora(clientY, rect, ventana), ventana);

        const mover = (e2: PointerEvent) => {
            if (!arrastrando && Math.abs(e2.clientY - inicioY) < UMBRAL_ARRASTRE) return;

            if (!arrastrando) {
                arrastrando = true;
                fantasma = document.createElement('div');
                fantasma.className = 'ev ev-ghost';
                fantasma.style.setProperty('--col', '0');
                fantasma.style.setProperty('--cols', '1');
                const etiqueta = document.createElement('span');
                etiqueta.className = 'ev-time';
                fantasma.appendChild(etiqueta);
                columna.appendChild(fantasma);
            }

            const { inicio, fin } = rangoEn(e2.clientY);
            ponerPosicion(fantasma!,
                horaADecimal(inicio) - ventana.desde,
                horaADecimal(fin) - horaADecimal(inicio));
            fantasma!.querySelector('.ev-time')!.textContent = `${inicio}–${fin}`;
        };

        const soltar = (e2: PointerEvent) => {
            document.removeEventListener('pointermove', mover);
            document.removeEventListener('pointerup', soltar);

            if (!arrastrando) {
                // Un clic seco no dice duración: la decide el formulario.
                onCrear(dia, rangoDeCreacion(horaInicial, horaInicial, ventana).inicio, null);
                return;
            }

            const { inicio, fin } = rangoEn(e2.clientY);
            fantasma?.remove();
            onCrear(dia, inicio, fin);
        };

        document.addEventListener('pointermove', mover);
        document.addEventListener('pointerup', soltar);
    }, [ventana, onCrear]);
}

// ---------- mover y redimensionar una tarjeta ----------

export interface OpcionesTarjeta {
    ventana: Ventana;
    onAbrir: (id: string) => void;
    onReagendar: (id: string, cambios: { dia?: string; hora_inicio?: string; hora_fin?: string }, pregunta: string) => void;
}

function clonarFantasma(tarjeta: HTMLElement, destino: HTMLElement): HTMLElement {
    const fantasma = tarjeta.cloneNode(true) as HTMLElement;
    fantasma.classList.add('ev-ghost-mover');
    fantasma.querySelector('.ev-resize')?.remove();
    fantasma.style.setProperty('--col', '0');
    fantasma.style.setProperty('--cols', '1');
    destino.appendChild(fantasma);
    return fantasma;
}

export function useArrastreTarjeta({ ventana, onAbrir, onReagendar }: OpcionesTarjeta) {
    // Los datos de la visita en curso se guardan en un ref y no en estado: leerlos no debe
    // provocar un render, y cambian dentro del propio manejador.
    const gesto = useRef<{ dia: string; inicio: string; fin: string } | null>(null);

    /** Arrastrar el CUERPO: mueve la visita conservando su duración. */
    const alMover = useCallback((
        e: React.PointerEvent<HTMLElement>,
        visita: { id: string; dia?: string; hora_inicio?: string },
        duracionH: number
    ) => {
        if (e.button !== 0) return;

        const tarjeta = e.currentTarget;
        const columnaOrigen = tarjeta.closest<HTMLElement>('.col');
        if (!columnaOrigen) return;

        const inicioX = e.clientX;
        const inicioY = e.clientY;
        const altoHora = altoDeHoraPx();

        let arrastrando = false;
        let fantasma: HTMLElement | null = null;
        let columnaDestino = columnaOrigen;

        const mover = (e2: PointerEvent) => {
            const dx = e2.clientX - inicioX;
            const dy = e2.clientY - inicioY;
            if (!arrastrando && !esArrastre(dx, dy, UMBRAL_ARRASTRE)) return;

            if (!arrastrando) {
                arrastrando = true;
                tarjeta.classList.add('es-arrastrando');
                fantasma = clonarFantasma(tarjeta, columnaOrigen);
            }

            // Cambiar de columna es cambiar de DÍA: en vista semana se reagenda arrastrando
            // de lunes a miércoles sin abrir nada.
            const bajoCursor = document.elementFromPoint(e2.clientX, e2.clientY)
                ?.closest<HTMLElement>('.col');
            if (bajoCursor && bajoCursor !== columnaDestino) {
                columnaDestino = bajoCursor;
                columnaDestino.appendChild(fantasma!);
            }

            const rango = rangoDeMovimiento(visita.hora_inicio, duracionH, dy, altoHora);
            ponerPosicion(fantasma!, horaADecimal(rango.inicio) - ventana.desde, duracionH);

            gesto.current = {
                dia: columnaDestino.dataset.dia || visita.dia || '',
                inicio: rango.inicio,
                fin: rango.fin
            };
        };

        const soltar = () => {
            document.removeEventListener('pointermove', mover);
            document.removeEventListener('pointerup', soltar);
            tarjeta.classList.remove('es-arrastrando');

            if (!arrastrando) { onAbrir(visita.id); return; }

            const resultado = gesto.current;
            fantasma?.remove();
            gesto.current = null;
            if (!resultado) return;

            // Soltar donde estaba no es reagendar: no debe pedir motivo ni dejar rastro.
            if (resultado.dia === visita.dia && resultado.inicio === visita.hora_inicio) return;

            onReagendar(visita.id,
                { dia: resultado.dia, hora_inicio: resultado.inicio, hora_fin: resultado.fin },
                '¿Por qué se mueve esta visita? Queda en el historial.');
        };

        document.addEventListener('pointermove', mover);
        document.addEventListener('pointerup', soltar);
    }, [ventana, onAbrir, onReagendar]);

    /** Arrastrar la MANIJA inferior: cambia solo la duración. */
    const alRedimensionar = useCallback((
        e: React.PointerEvent<HTMLElement>,
        visita: { id: string; hora_inicio?: string; hora_fin?: string },
        duracionH: number
    ) => {
        if (e.button !== 0) return;
        e.stopPropagation();   // si no, el cuerpo también empezaría a moverse

        const tarjeta = e.currentTarget.closest<HTMLElement>('.ev');
        const columna = tarjeta?.closest<HTMLElement>('.col');
        if (!tarjeta || !columna) return;

        const inicioY = e.clientY;
        const altoHora = altoDeHoraPx();
        const desplazamiento = horaADecimal(visita.hora_inicio) - ventana.desde;

        let arrastrando = false;
        let fantasma: HTMLElement | null = null;
        let finNuevo: string | null = null;

        const mover = (e2: PointerEvent) => {
            const dy = e2.clientY - inicioY;
            if (!arrastrando && Math.abs(dy) < UMBRAL_ARRASTRE) return;

            if (!arrastrando) {
                arrastrando = true;
                tarjeta.classList.add('es-arrastrando');
                fantasma = clonarFantasma(tarjeta, columna);
            }

            const r = nuevoFinPorRedimension(visita.hora_inicio, duracionH, dy, altoHora);
            ponerPosicion(fantasma!, desplazamiento, r.duracionH);
            finNuevo = r.fin;
        };

        const soltar = () => {
            document.removeEventListener('pointermove', mover);
            document.removeEventListener('pointerup', soltar);
            tarjeta.classList.remove('es-arrastrando');

            if (!arrastrando) { onAbrir(visita.id); return; }

            fantasma?.remove();
            if (!finNuevo || finNuevo === visita.hora_fin) return;

            onReagendar(visita.id, { hora_fin: finNuevo },
                '¿Por qué cambia la duración? Queda en el historial.');
        };

        document.addEventListener('pointermove', mover);
        document.addEventListener('pointerup', soltar);
    }, [ventana, onAbrir, onReagendar]);

    return { alMover, alRedimensionar };
}
