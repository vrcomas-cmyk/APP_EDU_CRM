/** Avisa, no bloquea: a veces las visitas se solapan de verdad. */

import { etiquetaVisita } from '@core/puente';
import { useChoqueHorario } from '../hooks/useChoqueHorario';

interface Props {
    id?: string;
    dia?: string;
    hora_inicio?: string;
    hora_fin?: string;
    educador_correo?: string;
}

function horaLocal(iso: string): string {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Solo lo propio: las otras visitas de la persona y sus eventos de Google Calendar. Lo de otras
 * personas del equipo no es un choque para quien agenda.
 */
export function AvisoChoque(horario: Props) {
    const { visitas, eventos } = useChoqueHorario(horario);

    const partes = [
        ...visitas.map(v => `${v.hora_inicio}–${v.hora_fin} ${etiquetaVisita(v)}`),
        ...eventos.map(e => `${horaLocal(e.inicio)}–${horaLocal(e.fin)} ${e.titulo} (Calendar)`)
    ];
    if (partes.length === 0) return null;

    return (
        <p className="aviso">
            {partes.length === 1
                ? `Se encima con ${partes[0]}.`
                : `Se encima con ${partes.length} compromisos: ${partes.join(', ')}.`}
        </p>
    );
}
