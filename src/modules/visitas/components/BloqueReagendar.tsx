/**
 * Reagendar: mover la visita dejando constancia.
 *
 * El motivo es obligatorio, y esa es la razón de que este bloque exista en vez de simplemente
 * dejar editables la fecha y la hora. Mover una visita en silencio borra el rastro de que se
 * movió, y ese rastro es justo lo que después explica por qué no se cumplió el plan.
 */

import { useState } from 'react';
import { reagendarVisita, fechaCorta, fechaHoraCorta, type Avisar } from '@core/puente';
import { moverInicio } from '../services/horario';
import { AvisoChoque } from './AvisoChoque';
import { reflejarEnCalendar } from '../services/calendarSync';
import * as repo from '../repository/visitasRepo';
import type { Visita } from '@core/tipos';
import { CampoFecha } from '@shared/components/CampoFecha';

interface Props {
    visita: Visita;
    avisar: Avisar;
    alReagendar: () => void;
}

export function BloqueReagendar({ visita, avisar, alReagendar }: Props) {
    const [dia, setDia] = useState(visita.dia || '');
    const [inicio, setInicio] = useState(visita.hora_inicio || '');
    const [fin, setFin] = useState(visita.hora_fin || '');
    const [motivo, setMotivo] = useState('');

    /** Mover el inicio CORRE la visita conservando su duración; no la estira. */
    function alCambiarInicio(nuevo: string) {
        const rango = moverInicio({ hora_inicio: inicio, hora_fin: fin }, nuevo);
        setInicio(rango.hora_inicio);
        setFin(rango.hora_fin);
    }

    function aplicar() {
        const r = reagendarVisita(visita.id, {
            dia, hora_inicio: inicio, hora_fin: fin, motivo
        });

        if (!r.ok) {
            avisar(r.error || 'No se pudo reagendar.', { estado: 'sin-registrar' });
            return;
        }

        avisar('Visita reagendada. Queda el registro del cambio.', { estado: 'completa' });
        if (r.visita) {
            void reflejarEnCalendar(r.visita, (mutador) => repo.actualizarVisita(visita.id, mutador), avisar);
        }
        alReagendar();
    }

    return (
        <div className="reagendar">
            <span className="campo-lbl">Reagendar</span>

            <label className="campo">
                <span className="campo-lbl">Fecha</span>
                <CampoFecha className="inp" value={dia} onChange={(e) => setDia(e.target.value)} />
            </label>

            <div className="campo">
                <span className="campo-lbl">Horario</span>
                <div className="horas">
                    <input
                        type="time" className="inp mono" aria-label="Hora de inicio"
                        value={inicio} onChange={(e) => alCambiarInicio(e.target.value)}
                    />
                    <span className="guion">–</span>
                    <input
                        type="time" className="inp mono" aria-label="Hora de fin"
                        value={fin} onChange={(e) => setFin(e.target.value)}
                    />
                </div>
                <AvisoChoque
                    id={visita.id} dia={dia} hora_inicio={inicio} hora_fin={fin}
                    educador_correo={visita.educador_correo}
                />
            </div>

            <label className="campo">
                <span className="campo-lbl">Motivo del cambio</span>
                <input
                    type="text" className="inp" placeholder="¿Por qué se mueve?"
                    value={motivo} onChange={(e) => setMotivo(e.target.value)}
                />
                <p className="ayuda">Obligatorio: queda en el historial</p>
            </label>

            <button type="button" className="btn" onClick={aplicar}>Reagendar</button>
        </div>
    );
}

/** Lo que ya se movió, de lo más reciente a lo más viejo. */
export function HistorialReagendas({ visita }: { visita: Visita }) {
    const reagendas = visita.reagendas || [];
    if (reagendas.length === 0) return null;

    return (
        <details className="historial">
            <summary>
                Reagendada {reagendas.length} {reagendas.length === 1 ? 'vez' : 'veces'}
            </summary>

            {[...reagendas].reverse().map((r, i) => {
                // Lo que vuelve de Supabase solo trae un marcador por reagenda (`{ id }`), sin
                // el antes/después: leer `r.antes.dia` ahí lanzaba y, sin límite de error,
                // React desmontaba el drawer entero — "se cierra al darle Historial".
                if (!r.antes || !r.despues) {
                    return (
                        <div className="historial-item" key={`sin-detalle-${i}`}>
                            <p className="historial-meta">Reagenda sin detalle disponible</p>
                        </div>
                    );
                }
                return (
                    <div className="historial-item" key={`${r.momento}-${i}`}>
                        <p className="mono">
                            {fechaCorta(r.antes.dia)} {r.antes.hora_inicio}–{r.antes.hora_fin}
                            {'  →  '}
                            {fechaCorta(r.despues.dia)} {r.despues.hora_inicio}–{r.despues.hora_fin}
                        </p>
                        <p className="historial-meta">
                            {r.motivo} · {r.usuario || 'Sin usuario'} · {fechaHoraCorta(r.momento)}
                        </p>
                    </div>
                );
            })}
        </details>
    );
}
