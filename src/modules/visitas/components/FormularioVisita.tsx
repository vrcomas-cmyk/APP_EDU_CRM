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
    zonaDeCliente, ejecutivoDeZona, clientesEnMisZonas, leerEstrategias, type Avisar
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
            <SubindiceZonaEjecutivo visita={visita} />
            <CampoEstrategia visita={visita} editar={editar} />
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
 * Zona y Ejecutivo: 100% automáticos (Cliente → Zona → Ejecutivo), en una sola línea como
 * subíndice del Cliente. NO se escriben — antes la Zona era un Combo editable "por si el
 * catálogo no traía al cliente", pero eso abría la puerta a inventar zonas que no existen en
 * la hoja de Clientes y a desalinear el Ejecutivo. Si el cliente no está en el catálogo, la
 * línea lo dice y el dato queda vacío hasta que el catálogo lo traiga: mejor un hueco honesto
 * que un dato escrito a mano que ningún reporte puede cruzar.
 */
function SubindiceZonaEjecutivo({ visita }: { visita: Visita }) {
    if (!visita.zona && !visita.ejecutivo) {
        return (
            <p className="ayuda subindice-zona">
                Zona y Ejecutivo se llenan solos al elegir un cliente del catálogo.
            </p>
        );
    }

    return (
        <p className="subindice-zona">
            <span className="subindice-lbl">Zona</span> {visita.zona || '—'}
            <span className="subindice-sep"> · </span>
            <span className="subindice-lbl">Ejecutivo</span> {visita.ejecutivo || '—'}
        </p>
    );
}

/**
 * Qué Estrategia avanza esta visita, si el cliente tiene alguna activa (etapa distinta de
 * "Consolidado" — una vez consolidada, ya no hay objetivo pendiente que las próximas visitas
 * tengan que empujar). Opcional a propósito: no todo cliente tiene un plan, y forzar el enlace
 * inventaría una relación que nadie definió.
 */
function CampoEstrategia({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    const activas = useMemo(
        () => leerEstrategias().filter(e => e.cliente === visita.cliente && e.etapa !== 'Consolidado'),
        [visita.cliente]
    );

    if (!visita.cliente?.trim() || activas.length === 0) return null;

    return (
        <label className="campo">
            <span className="campo-lbl">Estrategia</span>
            <select
                className="inp"
                value={visita.id_estrategia || ''}
                onChange={(e) => editar(v => { v.id_estrategia = e.target.value || undefined; })}
            >
                <option value="">Sin vincular</option>
                {activas.map(e => (
                    <option key={e.id} value={e.id}>
                        {[e.sector, e.grupo_articulo, e.proyecto].filter(Boolean).join(' · ') || 'Sin detalle'}
                    </option>
                ))}
            </select>
            <p className="ayuda">Esta visita cuenta para el avance de la estrategia elegida.</p>
        </label>
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
    // Solo los clientes de MIS zonas (titular + cobertura vigente) — sin ninguna asignada,
    // `clientesEnMisZonas` ya cae sola al catálogo completo. Se lee una vez: son hasta ~11,500
    // y releerlos en cada tecla recorre el arreglo entero.
    const clientes = useMemo(() => clientesEnMisZonas(), []);
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
    // Zona y Ejecutivo van pegados al Cliente, como en el formulario: son un dato derivado
    // de él (Cliente → Zona → Ejecutivo), no dos campos independientes que buscar aparte.
    const filas: Array<[string, string]> = [
        ['Educador', visita.educador || '—'],
        ['Cliente', visita.cliente || '—'],
        ['Zona · Ejecutivo', `${visita.zona || '—'} · ${visita.ejecutivo || '—'}`],
        ['Hospital', visita.hospital || '—'],
        ['Fecha', etiquetaDiaLarga(visita.dia)],
        ['Horario', `${visita.hora_inicio}–${visita.hora_fin}`],
        ['Sectores', String((visita.sectores || []).length)]
    ];

    // Solo si esta visita quedó vinculada a una — la mayoría de los clientes no tienen plan.
    if (visita.id_estrategia) {
        const estrategia = leerEstrategias().find(e => e.id === visita.id_estrategia);
        filas.splice(3, 0, ['Estrategia', estrategia
            ? [estrategia.sector, estrategia.grupo_articulo, estrategia.proyecto].filter(Boolean).join(' · ') || 'Sin detalle'
            : '—']);
    }

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
