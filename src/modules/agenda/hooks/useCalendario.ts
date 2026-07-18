/**
 * Navegación del calendario: qué se ve y desde dónde.
 *
 * El móvil no encoge la rejilla, CAMBIA DE FORMA: siete columnas con eje de horas son
 * ilegibles en 390px. Por eso "agenda" no es un modo que el usuario elija, es el modo que
 * existe en móvil — y por eso el selector de modos se esconde ahí.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { claveDia, desdeClave, sumarDias, sumarMeses } from '@core/puente';

export type ModoCalendario = 'dia' | 'semana' | 'mes' | 'agenda';

/** Por debajo de esto no hay rejilla que quepa. */
export const ANCHO_MOVIL = 720;

function esMovilAhora(): boolean {
    return typeof window !== 'undefined' && window.innerWidth <= ANCHO_MOVIL;
}

export function useCalendario(alCambiarDia?: (dia: string) => void) {
    const [movil, setMovil] = useState(esMovilAhora);
    const [modo, setModoInterno] = useState<ModoCalendario>(() => esMovilAhora() ? 'agenda' : 'dia');
    const [cursor, setCursor] = useState(() => new Date());

    /**
     * Solo se reacciona al CRUZAR el punto de quiebre, no a cada píxel.
     *
     * Redimensionar dispara decenas de eventos por segundo; recalcular la vista en cada uno
     * haría que arrastrar el borde de la ventana repintara el calendario sin parar.
     */
    useEffect(() => {
        function alRedimensionar() {
            const ahora = esMovilAhora();
            setMovil(previo => {
                if (previo === ahora) return previo;

                setModoInterno(m => {
                    if (ahora) return 'agenda';
                    return m === 'agenda' ? 'dia' : m;
                });
                return ahora;
            });
        }

        window.addEventListener('resize', alRedimensionar);
        return () => window.removeEventListener('resize', alRedimensionar);
    }, []);

    const setModo = useCallback((nuevo: ModoCalendario) => setModoInterno(nuevo), []);

    const irAHoy = useCallback(() => setCursor(new Date()), []);

    const irADia = useCallback((dia: string) => {
        if (!dia) return;
        setCursor(desdeClave(claveDia(dia)));
        // En escritorio, elegir un día del mes significa querer verlo en detalle. En móvil ya
        // se está en agenda: cambiar de modo ahí no significaría nada.
        if (!esMovilAhora()) setModoInterno('dia');
    }, []);

    const mover = useCallback((direccion: number) => {
        setCursor(actual => {
            if (modo === 'mes') return sumarMeses(actual, direccion);
            if (modo === 'semana') return sumarDias(actual, 7 * direccion);
            return sumarDias(actual, direccion);
        });
    }, [modo]);

    const diaVisible = useMemo(() => claveDia(cursor), [cursor]);

    useEffect(() => { alCambiarDia?.(diaVisible); }, [diaVisible, alCambiarDia]);

    return {
        modo: movil ? ('agenda' as const) : modo,
        movil,
        cursor,
        diaVisible,
        setModo,
        setCursor,
        irAHoy,
        irADia,
        mover
    };
}
