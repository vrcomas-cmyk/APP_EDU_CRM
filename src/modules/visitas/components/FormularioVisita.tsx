/**
 * Captura de una visita en borrador.
 *
 * Solo aparece mientras la visita es borrador. Una vez guardada, cliente, hospital, educador,
 * fecha y horario son lo que la visita AFIRMA y dejan de editarse: para moverla está
 * Reagendar, que deja historial.
 */

import { useCallback, useMemo } from 'react';
import { Combo, filtrar } from '@shared/components/Combo';
import { etiquetaDiaLarga, buscarSolapes, estadoDe, ESTADOS, type Avisar } from '@core/puente';
import { moverInicio, cambiarFin } from '../services/horario';
import * as repo from '../repository/visitasRepo';
import type { Visita } from '@core/tipos';

interface Props {
    visita: Visita;
    editar: (mutador: (v: Visita) => void) => void;
    avisar: Avisar;
}

export function FormularioVisita({ visita, editar, avisar }: Props) {
    return (
        <>
            <CampoEducador visita={visita} />
            <CampoCliente visita={visita} editar={editar} />
            <CampoHospital visita={visita} editar={editar} />

            <label className="campo">
                <span className="campo-lbl">Fecha</span>
                <input
                    type="date"
                    className="inp"
                    value={visita.dia || ''}
                    onChange={(e) => editar(v => { v.dia = e.target.value; })}
                />
            </label>

            <CampoHoras visita={visita} editar={editar} avisar={avisar} />
        </>
    );
}

/**
 * El educador no se elige: es quien tiene la sesión abierta.
 *
 * Se muestra —hay que poder verlo antes de guardar— pero como dato, no como campo. Dejar
 * escribir aquí permitiría registrar una visita a nombre de otra persona.
 */
function CampoEducador({ visita }: { visita: Visita }) {
    const nombre = (visita.educador || '').trim();

    return (
        <div className="campo">
            <span className="campo-lbl">Educador</span>
            {nombre
                ? <p className="dato-val">{nombre}</p>
                : <p className="ayuda">
                    No se pudo leer tu nombre de la sesión. Vuelve a entrar antes de agendar.
                  </p>}
        </div>
    );
}

function CampoCliente({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    // Se lee una vez: son ~11,500 y releerlos en cada tecla recorre el arreglo entero.
    const clientes = useMemo(() => repo.clientesDelCatalogo(), []);
    const opciones = useCallback((q: string) => filtrar(clientes, q), [clientes]);

    return (
        <Combo
            etiqueta="Cliente"
            valor={visita.cliente || ''}
            placeholder="Busca N° o razón social…"
            opciones={opciones}
            total={clientes.length}
            onElegir={(c) => editar(v => { v.cliente = c; })}
            onEscribir={(texto) => editar(v => { v.cliente = texto; })}
        />
    );
}

function CampoHospital({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    // El hospital es texto libre por decisión de producto. Sugerir lo ya escrito no impide
    // que "Hosp. Ángeles" y "H. Angeles" se vuelvan dos, pero hace que converjan solos.
    const previos = useMemo(() => repo.historialHospitales(), []);
    const opciones = useCallback((q: string) => filtrar(previos, q), [previos]);

    return (
        <Combo
            etiqueta="Hospital"
            valor={visita.hospital || ''}
            placeholder="Escribe el hospital…"
            opciones={opciones}
            ayuda={previos.length ? 'Se sugiere lo que ya has escrito antes' : null}
            onElegir={(h) => editar(v => { v.hospital = h; })}
            onEscribir={(texto) => editar(v => { v.hospital = texto; })}
        />
    );
}

function CampoHoras({ visita, editar, avisar }: Props) {
    /**
     * El fin NUNCA se calcula solo: una capacitación de 2h y una entrega de 20min no duran
     * igual. Pero mover el inicio MUEVE el bloque conservando la duración.
     */
    function alCambiarInicio(nuevo: string) {
        const rango = moverInicio(
            { hora_inicio: visita.hora_inicio, hora_fin: visita.hora_fin },
            nuevo
        );
        editar(v => {
            v.hora_inicio = rango.hora_inicio;
            v.hora_fin = rango.hora_fin;
        });
    }

    function alCambiarFin(nuevo: string) {
        const r = cambiarFin(visita.hora_inicio, nuevo);
        if (!r.ok) {
            // Se avisa y NO se corrige: mover la hora que el usuario no tocó produce un
            // horario que nadie eligió y que se descubre tarde.
            avisar(r.error, { estado: 'sin-registrar' });
            return;
        }
        editar(v => { v.hora_fin = r.hora_fin; });
    }

    return (
        <div className="campo">
            <span className="campo-lbl">Horario</span>
            <div className="horas">
                <input
                    type="time"
                    className="inp mono"
                    aria-label="Hora de inicio"
                    value={visita.hora_inicio || ''}
                    onChange={(e) => alCambiarInicio(e.target.value)}
                />
                <span className="guion">–</span>
                <input
                    type="time"
                    className="inp mono"
                    aria-label="Hora de fin"
                    value={visita.hora_fin || ''}
                    onChange={(e) => alCambiarFin(e.target.value)}
                />
            </div>
            <AvisoSolape visita={visita} />
        </div>
    );
}

/** Avisa, no bloquea: a veces las visitas se solapan de verdad. */
function AvisoSolape({ visita }: { visita: Visita }) {
    const choques = useMemo(() => {
        if (!visita.dia || !visita.hora_inicio || !visita.hora_fin) return [];
        const vivas = repo.leerVisitas().filter(v => estadoDe(v) !== ESTADOS.CANCELADA);
        return buscarSolapes(vivas, visita, visita.id);
    }, [visita]);

    if (choques.length === 0) return null;

    const quien = choques
        .map(v => `${v.hora_inicio} ${v.cliente || 'Sin cliente'}`)
        .join(', ');

    return (
        <p className="aviso">
            {choques.length === 1
                ? `Se encima con ${quien}.`
                : `Se encima con ${choques.length} visitas: ${quien}.`}
        </p>
    );
}

/** Lo que identifica a la visita, en frío. Reemplaza al formulario una vez guardada. */
export function PanelInformacion({ visita }: { visita: Visita }) {
    const filas: Array<[string, string]> = [
        ['Educador', visita.educador || '—'],
        ['Cliente', visita.cliente || '—'],
        ['Hospital', visita.hospital || '—'],
        ['Fecha', etiquetaDiaLarga(visita.dia)],
        ['Horario', `${visita.hora_inicio}–${visita.hora_fin}`],
        ['Sectores', String((visita.sectores || []).length)]
    ];

    return (
        <div className="campo panel-info">
            <span className="campo-lbl">Información de la visita</span>
            <div className="datos">
                {filas.map(([etiqueta, valor]) => (
                    <div className="dato" key={etiqueta}>
                        <span className="dato-lbl">{etiqueta}</span>
                        <span className="dato-val">{valor}</span>
                    </div>
                ))}
            </div>
            {/*
              Nunca lleva botón de editar, y no por olvido: estos campos son lo que la visita
              AFIRMA. Cambiarlos en silencio la convertiría en otra visita conservando su
              historial —su check-in, sus actividades— que ya no le corresponde.
            */}
            <p className="ayuda">
                Estos datos identifican la visita y no se editan. Usa Reagendar o Cancelar.
            </p>
        </div>
    );
}
