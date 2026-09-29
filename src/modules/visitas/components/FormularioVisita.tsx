/**
 * Captura de una visita en borrador.
 *
 * Solo aparece mientras la visita es borrador. Una vez guardada, cliente, hospital, educador,
 * fecha y horario son lo que la visita AFIRMA y dejan de editarse: para moverla está
 * Reagendar, que deja historial.
 */

import { useCallback, useMemo, useRef } from 'react';
import { Combo, filtrar } from '@shared/components/Combo';
import {
    fechaCorta, esVisitaCliente,
    etiquetaVisita, zonaDeCliente, ejecutivoDeZona, clientesEnMisZonas, leerEstrategias,
    type Avisar
} from '@core/puente';
import { moverInicio, cambiarFin } from '../services/horario';
import { AvisoChoque } from './AvisoChoque';
import { CampoFecha } from '@shared/components/CampoFecha';
import * as repo from '../repository/visitasRepo';
import { idsEstrategiasDe, aplicarSeleccion } from '@modules/estrategias/services/vinculo';
import { HistoricoCliente } from './HistoricoCliente';
import type { Visita } from '@core/tipos';

interface Props {
    visita: Visita;
    editar: (mutador: (v: Visita) => void) => void;
    avisar: Avisar;
}

export function FormularioVisita({ visita, editar, avisar }: Props) {
    const cliente = esVisitaCliente(visita);

    return (
        <>
            <CampoEducador visita={visita} />
            <CampoTipo visita={visita} editar={editar} />

            {cliente ? (
                <>
                    <CampoCliente visita={visita} editar={editar} />
                    <SubindiceZonaEjecutivo visita={visita} />
                    <CampoEstrategia visita={visita} editar={editar} />
                    <CampoHospital visita={visita} editar={editar} />
                    <HistoricoCliente visita={visita} />
                </>
            ) : (
                <CampoMotivo visita={visita} editar={editar} />
            )}

            <CampoFechaVisita visita={visita} editar={editar} />

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

    const marcadas = new Set(idsEstrategiasDe(visita));

    // Marcar/desmarcar también agrega o quita el sector del plan (ver `aplicarSeleccion`): así
    // elegir la estrategia deja la visita lista para trabajarla, sin capturar el sector aparte.
    const alternar = (id: string) => editar(v => {
        const siguiente = new Set(idsEstrategiasDe(v));
        if (siguiente.has(id)) siguiente.delete(id); else siguiente.add(id);
        aplicarSeleccion(v, leerEstrategias().filter(e => e.cliente === v.cliente), [...siguiente], repo.nuevoId);
    });

    return (
        <fieldset className="campo campo-estrategias">
            <legend className="campo-lbl">Estrategias</legend>
            {/* Recordatorio, no un candado: este cliente ya tiene un plan en Estrategias, y de
                ahí también se puede generar la visita completa (cliente + sectores del plan de
                un solo golpe). Vincular aquí sigue siendo válido — capturar primero y enlazar
                después es un flujo tan legítimo como el otro. */}
            <p className="ayuda">
                {activas.length === 1
                    ? 'Este cliente tiene una estrategia activa.'
                    : `Este cliente tiene ${activas.length} estrategias activas.`}
                {' '}También puedes generar la visita directamente desde Estrategias.
            </p>
            {activas.map(e => (
                <label className="estrategia-opcion" key={e.id}>
                    <input type="checkbox" checked={marcadas.has(e.id)} onChange={() => alternar(e.id)} />
                    <span>
                        {[e.sector, e.grupo_articulo, e.proyecto].filter(Boolean).join(' · ') || 'Sin detalle'}
                    </span>
                </label>
            ))}
            <p className="ayuda">
                Marca todas las que vas a trabajar; su sector se agrega a la visita. El avance cuenta
                solo para las que de verdad se trabajen.
            </p>
        </fieldset>
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

function CampoFechaVisita({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    return (
        <label className="campo">
            <span className="campo-lbl">Fecha</span>
            <CampoFecha
                className="inp"
                value={visita.dia}
                onChange={(e) => editar(v => { v.dia = e.target.value; })}
                aria-label="Fecha de la visita"
            />
        </label>
    );
}

const TIPOS_VISITA = [
    { valor: 'cliente' as const, etiqueta: 'Cliente' },
    { valor: 'administrativo' as const, etiqueta: 'Administrativo' },
    { valor: 'evento' as const, etiqueta: 'Evento' }
];

/**
 * A qué se dedica el tiempo. Cliente es el default —lo que la app hace desde siempre— y
 * cambiarlo reemplaza Cliente/Hospital/Sectores por un solo campo de Motivo: no hay a quién
 * visitar, así que pedir esos datos no tendría sentido.
 */
function CampoTipo({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    const actual = visita.tipo || 'cliente';

    return (
        <div className="campo">
            <span className="campo-lbl">Tipo</span>
            <div className="seg" role="group" aria-label="Tipo de visita">
                {TIPOS_VISITA.map(t => (
                    <button
                        key={t.valor}
                        type="button"
                        aria-pressed={actual === t.valor}
                        onClick={() => editar(v => {
                            v.tipo = t.valor;
                            // Cambiar de tipo no debe dejar a medias lo del tipo anterior: un
                            // administrativo con un `cliente` colgado de un cambio de opinión
                            // seguiría contando como visita a ese cliente en los indicadores.
                            if (t.valor === 'cliente') {
                                v.motivo = undefined;
                            } else {
                                v.cliente = undefined;
                                v.hospital = undefined;
                                v.zona = undefined;
                                v.ejecutivo = undefined;
                                v.id_estrategia = undefined;
                                v.ids_estrategias = undefined;
                            }
                        })}
                    >
                        {t.etiqueta}
                    </button>
                ))}
            </div>
        </div>
    );
}

function CampoMotivo({ visita, editar }: { visita: Visita; editar: Props['editar'] }) {
    return (
        <label className="campo">
            <span className="campo-lbl">Motivo</span>
            <input
                type="text"
                className="inp"
                placeholder={visita.tipo === 'evento' ? 'Ej. Congreso anual de la zona' : 'Ej. Papeleo mensual, capacitación interna…'}
                value={visita.motivo || ''}
                onChange={(e) => editar(v => { v.motivo = e.target.value; })}
            />
        </label>
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

    const prospecto = Boolean(visita.es_prospecto);

    return (
        <>
            <Combo
                etiqueta="Cliente"
                valor={prospecto ? 'Prospecto' : (visita.cliente || '')}
                placeholder="Busca N° o razón social…"
                deshabilitado={prospecto}
                opciones={opciones}
                total={clientes.length}
                onElegir={(c) => editar(v => {
                    v.cliente = c;
                    // Zona y Ejecutivo se resuelven solos al ELEGIR un cliente real del
                    // catálogo: escribir texto libre no lo hace, porque un texto suelto no es
                    // necesariamente un cliente que exista en el catálogo — ver validación en
                    // `faltaParaGuardar`, que bloquea Guardar si no coincide con uno real.
                    v.zona = zonaDeCliente(c);
                    v.ejecutivo = ejecutivoDeZona(v.zona);
                })}
                onEscribir={(texto) => editar(v => { v.cliente = texto; })}
            />

            <label className="campo-check">
                <input
                    type="checkbox"
                    checked={prospecto}
                    onChange={(e) => editar(v => {
                        v.es_prospecto = e.target.checked;
                        if (e.target.checked) {
                            // Un prospecto no está en el catálogo: Cliente pasa a ser un valor
                            // fijo y se bloquea — lo que identifica al prospecto de verdad
                            // (Hospital y el resto de campos) se llena a mano, como ya funciona.
                            // Zona/Ejecutivo/Estrategia son datos QUE VIENEN del catálogo, así
                            // que tampoco hay nada honesto que resolver para ellos.
                            v.cliente = 'Prospecto';
                            v.zona = undefined;
                            v.ejecutivo = undefined;
                            v.id_estrategia = undefined;
                            v.ids_estrategias = undefined;
                        } else {
                            // Al desmarcar, "Prospecto" no es un cliente real: se limpia para
                            // obligar a elegir uno de verdad del catálogo.
                            v.cliente = '';
                        }
                    })}
                />
                Es un prospecto (aún no está dado de alta en el catálogo)
            </label>
        </>
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
            <AvisoChoque {...visita} />
        </div>
    );
}

/** Lo que identifica a la visita, en frío. Reemplaza al formulario una vez guardada. */
export function PanelInformacion({ visita, editar }: { visita: Visita; editar?: Props['editar'] }) {
    const cliente = esVisitaCliente(visita);

    // Zona y Ejecutivo van pegados al Cliente, como en el formulario: son un dato derivado
    // de él (Cliente → Zona → Ejecutivo), no dos campos independientes que buscar aparte.
    const filas: Array<[string, string]> = cliente
        ? [
            ['Educador', visita.educador || '—'],
            ['Cliente', (visita.cliente || '—') + (visita.es_prospecto ? ' (prospecto)' : '')],
            ['Zona · Ejecutivo', visita.es_prospecto
                ? 'No aplica — prospecto, sin catálogo'
                : `${visita.zona || '—'} · ${visita.ejecutivo || '—'}`],
            ['Hospital', visita.hospital || '—'],
            ['Fecha', fechaCorta(visita.dia)],
            ['Horario', `${visita.hora_inicio}–${visita.hora_fin}`],
            ['Sectores', String((visita.sectores || []).length)]
        ]
        : [
            ['Educador', visita.educador || '—'],
            ['Tipo', visita.tipo === 'evento' ? 'Evento' : 'Administrativo'],
            ['Motivo', visita.motivo || '—'],
            ['Fecha', fechaCorta(visita.dia)],
            ['Horario', `${visita.hora_inicio}–${visita.hora_fin}`]
        ];

    // Solo si esta visita quedó vinculada a una — la mayoría de los clientes no tienen plan.
    const idsEstrategias = idsEstrategiasDe(visita);
    if (cliente && idsEstrategias.length) {
        const todas = leerEstrategias();
        const descripcion = (id: string) => {
            const e = todas.find(x => x.id === id);
            return e ? [e.sector, e.grupo_articulo, e.proyecto].filter(Boolean).join(' · ') || 'Sin detalle' : '—';
        };
        filas.splice(3, 0, [idsEstrategias.length > 1 ? 'Estrategias' : 'Estrategia',
            idsEstrategias.map(descripcion).join(' | ')]);
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
