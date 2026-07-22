/**
 * Captura de una visita en borrador.
 *
 * Solo aparece mientras la visita es borrador. Una vez guardada, cliente, hospital, educador,
 * fecha y horario son lo que la visita AFIRMA y dejan de editarse: para moverla está
 * Reagendar, que deja historial.
 */

import { useCallback, useMemo } from 'react';
import { Combo, filtrar } from '@shared/components/Combo';
import {
    etiquetaDiaLarga, buscarSolapes, estadoDe, ESTADOS, consultarVisitas,
    zonaDeCliente, ejecutivoDeZona, type Avisar
} from '@core/puente';
import { moverInicio, cambiarFin } from '../services/horario';
import * as repo from '../repository/visitasRepo';
import { HistoricoCliente } from './HistoricoCliente';
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
            <HistoricoCliente visita={visita} />

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

            <div className="grid-2">
                <CampoZona visita={visita} editar={editar} />
                <DatoEjecutivo visita={visita} />
            </div>

            <label className="campo">
                <span className="campo-lbl">Notas</span>
                <textarea
                    className="inp notas-area" rows={2}
                    placeholder="Nota de planeación (no es un comentario)"
                    value={visita.notas || ''}
                    onChange={(e) => editar(v => { v.notas = e.target.value; })}
                />
            </label>
        </>
    );
}

/**
 * Zona automática: se resuelve sola al elegir el Cliente (ver `CampoCliente`), desde
 * "Gpo. vendedores" de la hoja Clientes. Sigue siendo un Combo editable —no un dato fijo—
 * porque un cliente que el catálogo todavía no trae deja la Zona vacía, y alguien tiene que
 * poder escribirla a mano para que la visita no se quede sin Ejecutivo tampoco.
 */
function CampoZona({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    const previas = useMemo(() => repo.historialDeCampo('zona'), []);
    const opciones = useCallback((q: string) => filtrar(previas, q), [previas]);

    /** Corregir la Zona a mano recalcula el Ejecutivo: son un salto, no dos datos sueltos. */
    function fijarZona(zona: string) {
        editar(v => { v.zona = zona; v.ejecutivo = ejecutivoDeZona(zona); });
    }

    return (
        <Combo
            etiqueta="Zona"
            valor={visita.zona || ''}
            placeholder="Se llena sola al elegir el cliente"
            opciones={opciones}
            onElegir={fijarZona}
            onEscribir={fijarZona}
        />
    );
}

/** Ejecutivo: 100% automático (Zona → Ejecutivo). No se escribe, solo se muestra. */
function DatoEjecutivo({ visita }: { visita: Visita }) {
    return (
        <div className="campo">
            <span className="campo-lbl">Ejecutivo</span>
            <p className="dato-val">{visita.ejecutivo || '—'}</p>
        </div>
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
    // Minúsculas precalculadas una sola vez: si no, cada tecla vuelve a hacer `.toLowerCase()`
    // de las 11,500 entradas dentro de `filtrar`, y ese es el campo que más se escribe.
    const clientesLower = useMemo(() => clientes.map(c => c.toLowerCase()), [clientes]);
    const opciones = useCallback(
        (q: string) => filtrar(clientes, q, undefined, clientesLower),
        [clientes, clientesLower]
    );

    return (
        <Combo
            etiqueta="Cliente"
            valor={visita.cliente || ''}
            placeholder="Busca N° o razón social…"
            opciones={opciones}
            total={clientes.length}
            onElegir={(c) => editar(v => {
                v.cliente = c;
                // Zona y Ejecutivo se resuelven solos al ELEGIR un cliente real del catálogo:
                // escribir texto libre (abajo) no dispara la búsqueda, porque todavía no es
                // un cliente que exista en la hoja de Clientes.
                v.zona = zonaDeCliente(c);
                v.ejecutivo = ejecutivoDeZona(v.zona);
            })}
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
    const { dia, hora_inicio: horaInicio, hora_fin: horaFin, id } = visita;

    const choques = useMemo(() => {
        if (!dia || !horaInicio || !horaFin) return [];
        // `consultarVisitas()` (local + espejo de equipo), no solo local: si no, un choque
        // contra una visita capturada en otro dispositivo —o la de alguien más, para quien
        // agenda por su equipo— nunca se avisaba.
        const vivas = consultarVisitas().filter(v => estadoDe(v) !== ESTADOS.CANCELADA);
        return buscarSolapes(vivas, visita, id);
        // Deps por campo, no por el objeto `visita` completo: ese objeto es una referencia
        // nueva cada vez que `editar()` relee el almacén, así que escribir en CUALQUIER otro
        // campo (Hospital, Notas…) recalculaba este choque sobre todas las visitas locales sin
        // que el horario hubiera cambiado — el costo real de este aviso es por tecla, no por
        // cambio de horario.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dia, horaInicio, horaFin, id]);

    if (choques.length === 0) return null;

    const quien = choques
        .map(v => `${v.hora_inicio}–${v.hora_fin} ${v.cliente || 'Sin cliente'}`)
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
export function PanelInformacion({ visita, editar }: { visita: Visita; editar?: Props['editar'] }) {
    const filas: Array<[string, string]> = [
        ['Educador', visita.educador || '—'],
        ['Cliente', visita.cliente || '—'],
        ['Hospital', visita.hospital || '—'],
        ['Zona', visita.zona || '—'],
        ['Ejecutivo', visita.ejecutivo || '—'],
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

            {/* Notas SÍ se puede seguir corrigiendo: es una nota de planeación, no lo que la
                visita afirma haber hecho —a diferencia del resto de este panel, y a
                diferencia de los Comentarios, que son un hilo inmutable. */}
            {editar && (
                <label className="campo">
                    <span className="campo-lbl">Notas</span>
                    <textarea
                        className="inp notas-area" rows={2}
                        placeholder="Nota de planeación (no es un comentario)"
                        value={visita.notas || ''}
                        onChange={(e) => editar(v => { v.notas = e.target.value; })}
                    />
                </label>
            )}
        </div>
    );
}
