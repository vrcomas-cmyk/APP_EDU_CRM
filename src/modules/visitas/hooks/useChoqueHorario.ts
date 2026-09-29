/**
 * Choques de horario de UNA persona: sus otras visitas y sus eventos de Google Calendar que
 * se traslapan con el horario dado.
 *
 * Solo avisa de lo propio. Las visitas o eventos de otras personas del equipo no son un
 * conflicto para quien agenda: cada quien tiene su propia agenda.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    buscarSolapes, estadoDe, ESTADOS, consultarVisitas, listarCompromisos, sesionActual,
    type CompromisoCalendar
} from '@core/puente';
import { useConexionCalendar } from '@modules/agenda/hooks/useConexionCalendar';
import type { Visita } from '@core/tipos';

interface Horario {
    id?: string;
    dia?: string;
    hora_inicio?: string;
    hora_fin?: string;
    educador_correo?: string;
}

const norm = (c?: string) => String(c || '').trim().toLowerCase();

/** ¿Se traslapan [aIni, aFin) y [bIni, bFin)? Tocarse en el borde no cuenta. */
function traslapa(aIni: Date, aFin: Date, bIni: Date, bFin: Date): boolean {
    return aIni < bFin && bIni < aFin;
}

export function useChoqueHorario(visita: Horario): { visitas: Visita[]; eventos: CompromisoCalendar[] } {
    const { dia, hora_inicio: horaInicio, hora_fin: horaFin, id } = visita;
    const propio = norm(sesionActual()?.correo);
    // Quien agenda para otra persona (un gerente) no ve sus eventos de Calendar: el token es
    // el suyo, así que solo se revisa Calendar cuando la visita es del propio usuario.
    const duenio = norm(visita.educador_correo) || propio;
    const esPropia = duenio === propio;

    const { conectado } = useConexionCalendar();
    const [delDia, setDelDia] = useState<{ dia: string; eventos: CompromisoCalendar[] } | null>(null);

    useEffect(() => {
        if (!dia || !conectado || !esPropia) { setDelDia(null); return; }
        let vivo = true;
        const desde = new Date(`${dia}T00:00:00`).toISOString();
        const hasta = new Date(`${dia}T23:59:59`).toISOString();
        listarCompromisos(desde, hasta)
            .then((eventos) => { if (vivo) setDelDia({ dia, eventos }); })
            // Es un aviso de cortesía: si Calendar no responde, simplemente no se avisa.
            .catch(() => { if (vivo) setDelDia(null); });
        return () => { vivo = false; };
    }, [dia, conectado, esPropia]);

    const visitas = useMemo(() => {
        if (!dia || !horaInicio || !horaFin) return [];
        const propias = consultarVisitas().filter(
            v => norm(v.educador_correo) === duenio && estadoDe(v) !== ESTADOS.CANCELADA
        );
        return buscarSolapes(propias, { id, dia, hora_inicio: horaInicio, hora_fin: horaFin } as Visita, id);
    }, [dia, horaInicio, horaFin, id, duenio]);

    const eventos = useMemo(() => {
        if (!dia || !horaInicio || !horaFin || !delDia || delDia.dia !== dia) return [];
        const ini = new Date(`${dia}T${horaInicio}:00`);
        const fin = new Date(`${dia}T${horaFin}:00`);
        return delDia.eventos.filter(
            e => !e.todoElDia && traslapa(ini, fin, new Date(e.inicio), new Date(e.fin))
        );
    }, [dia, horaInicio, horaFin, delDia]);

    return { visitas, eventos };
}
