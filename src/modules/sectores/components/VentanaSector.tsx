/**
 * Captura de sectores, en ventana propia y en dos pasos.
 *
 * Antes los sectores del catálogo se pintaban como una fila de chips dentro del formulario de
 * la visita. Con un catálogo de verdad eso es una pared de botones encima de los campos que sí
 * importan, y al tocar uno se entraba a otra pantalla de la que había que volver a mano:
 * capturar tres sectores costaba seis cambios de pantalla.
 *
 *   ELEGIR     buscador con los que faltan por agregar.
 *   COMPLETAR  objetivo, origen y quién lo pidió. Los tres obligatorios.
 *   GUARDAR    vuelve solo al buscador, con el sector ya en la lista.
 *
 * El ciclo se cierra sin salir de la ventana: encadenar sectores es el caso normal, y cada
 * "volver" intermedio era un clic que no aportaba nada.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { sectores as catalogoSectores, origenes, leerEstrategias, type Avisar } from '@core/puente';

import { faltaEnSector, sectorCompleto, conservables, sectoresLibres } from '../validators/requisitos';
import { filtrarSectores } from '../services/busqueda';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Sector, Visita } from '@core/tipos';
import { Dato } from '@shared/components/Dato';

export interface PropsVentanaSector {
    visitaId: string;
    /** Con id se abre ese sector para corregirlo; sin él, arranca en el buscador. */
    sectorId?: string | null;
    avisar: Avisar;
    alCambiar: () => void;
    onCerrar: () => void;
}

type Paso = { tipo: 'elegir' } | { tipo: 'completar'; sectorId: string };

export function VentanaSector({
    visitaId, sectorId = null, avisar, alCambiar, onCerrar
}: PropsVentanaSector) {
    const [paso, setPaso] = useState<Paso>(
        sectorId ? { tipo: 'completar', sectorId } : { tipo: 'elegir' }
    );
    const [version, setVersion] = useState(0);

    const visita = repo.obtenerVisita(visitaId);

    const editar = useCallback((mutador: (v: Visita) => void) => {
        repo.actualizarVisita(visitaId, mutador);
        setVersion(n => n + 1);
        alCambiar();
    }, [visitaId, alCambiar]);

    /** Al cerrar, lo que quedó a medias se descarta. Ver `conservables`. */
    const cerrar = useCallback(() => {
        editar(v => { v.sectores = conservables(v.sectores || []); });
        onCerrar();
    }, [editar, onCerrar]);

    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            e.stopPropagation();

            // Escape desde el formulario regresa al buscador; solo cierra desde el buscador.
            if (paso.tipo === 'completar') {
                editar(v => { v.sectores = conservables(v.sectores || []); });
                setPaso({ tipo: 'elegir' });
            } else {
                cerrar();
            }
        }

        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [paso, editar, cerrar]);

    if (!visita) return null;

    const sectorActual = paso.tipo === 'completar'
        ? (visita.sectores || []).find(s => s.id === paso.sectorId) ?? null
        : null;

    // El sector desapareció (se quitó desde otra parte): se vuelve al buscador en vez de
    // dejar la ventana en blanco.
    if (paso.tipo === 'completar' && !sectorActual) {
        setPaso({ tipo: 'elegir' });
        return null;
    }

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
            <div className="modal-caja es-sector">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{sectorActual ? sectorActual.nombre : 'Agregar sector'}</h3>
                        <span className="eyebrow">
                            {sectorActual
                                ? 'Completa la información del sector'
                                : (visita.hospital || visita.cliente || 'Visita')}
                        </span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={cerrar}>✕</button>
                </div>

                {sectorActual ? (
                    <PasoCompletar
                        key={sectorActual.id}
                        visita={visita}
                        sector={sectorActual}
                        version={version}
                        editar={editar}
                        avisar={avisar}
                        onListo={() => setPaso({ tipo: 'elegir' })}
                    />
                ) : (
                    <PasoElegir
                        visita={visita}
                        onElegir={(nombre) => {
                            const id = repo.nuevoId('s');
                            editar(v => {
                                (v.sectores ||= []).push({
                                    id, nombre, objetivo: '', origen: [],
                                    solicitado_por: '', actividades: []
                                });
                            });
                            // Se entra directo a completarlo: elegirlo solo no sirve de nada.
                            setPaso({ tipo: 'completar', sectorId: id });
                        }}
                        onCorregir={(id) => setPaso({ tipo: 'completar', sectorId: id })}
                        onCerrar={cerrar}
                    />
                )}
            </div>
        </div>
    );
}

// ---------- paso 1: elegir ----------

function PasoElegir({ visita, onElegir, onCorregir, onCerrar }: {
    visita: Visita;
    onElegir: (nombre: string) => void;
    onCorregir: (id: string) => void;
    onCerrar: () => void;
}) {
    const [consulta, setConsulta] = useState('');

    const catalogo = useMemo(() => catalogoSectores(), []);
    const libres = useMemo(() => sectoresLibres(catalogo, visita), [catalogo, visita]);
    const encontrados = useMemo(() => filtrarSectores(libres, consulta), [libres, consulta]);

    const usados = visita.sectores || [];

    return (
        <div className="modal-body">
            {/* Lo ya agregado va arriba: es la respuesta a "¿cuál me falta?", que es la
                pregunta real de quien está encadenando sectores. */}
            {usados.length > 0 && (
                <div className="campo">
                    <span className="campo-lbl">Ya agregados · {usados.length}</span>
                    <div className="chips">
                        {usados.map(s => (
                            <button
                                key={s.id}
                                type="button"
                                className="chip on"
                                disabled={Boolean(s.guardado)}
                                title={s.guardado ? 'Sector sellado: ya no se edita' : 'Corregir este sector'}
                                onClick={() => onCorregir(s.id)}
                            >
                                {s.nombre}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {catalogo.length === 0 ? (
                <p className="ayuda">
                    El catálogo de sectores no ha cargado todavía. Conéctate para descargarlo.
                </p>
            ) : libres.length === 0 ? (
                <p className="ayuda">Ya agregaste todos los sectores del catálogo.</p>
            ) : (
                <div className="campo">
                    <label className="campo-lbl">
                        Sector · {libres.length} disponible{libres.length === 1 ? '' : 's'}
                        <input
                            type="text" className="inp" autoComplete="off"
                            placeholder="Escribe para buscar…"
                            value={consulta}
                            autoFocus
                            onChange={(e) => setConsulta(e.target.value)}
                            onKeyDown={(e) => {
                                // Enter con una sola coincidencia la elige: encadenar sectores
                                // no debería pedir ratón.
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                if (encontrados.length === 1) onElegir(encontrados[0]!);
                            }}
                        />
                    </label>

                    <div className="mat-res">
                        {encontrados.length === 0 ? (
                            <p className="ayuda">Ningún sector coincide con "{consulta}".</p>
                        ) : (
                            encontrados.map(nombre => (
                                <button
                                    key={nombre} type="button" className="mat-opt"
                                    onClick={() => onElegir(nombre)}
                                >
                                    {nombre}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}

            <div className="modal-foot">
                <span style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={onCerrar}>Listo</button>
            </div>
        </div>
    );
}

// ---------- paso 2: completar ----------

function PasoCompletar({ visita, sector, editar, avisar, onListo }: {
    visita: Visita;
    sector: Sector;
    version: number;
    editar: (m: (v: Visita) => void) => void;
    avisar: Avisar;
    onListo: () => void;
}) {
    const editarSector = useCallback((mutador: (s: Sector) => void) => {
        editar(v => {
            const s = (v.sectores || []).find(x => x.id === sector.id);
            if (s) mutador(s);
        });
    }, [editar, sector.id]);

    /**
     * Contexto, no relleno: si este cliente ya tiene una Estrategia activa para ESTE sector, se
     * muestra su proyecto/objetivo general arriba del campo — pero el Objetivo del sector sigue
     * en blanco y obligatorio. Son dos cosas distintas: el objetivo GENERAL del plan (la
     * estrategia) y el objetivo de ESTA visita puntual, que puede matizarlo o ser un paso
     * intermedio distinto. Auto-llenarlo borraría esa distinción.
     */
    const estrategiaDelSector = useMemo(() => leerEstrategias().find(e =>
        e.cliente === visita.cliente && e.sector === sector.nombre && e.etapa !== 'Consolidado'
    ), [visita.cliente, sector.nombre]);

    // Ya sellado: se abre para consultarlo, no para cambiarlo.
    if (sector.guardado) {
        return (
            <div className="modal-body">
                <div className="datos">
                    <Dato etiqueta="Sector" valor={sector.nombre} />
                    <Dato etiqueta="Objetivo" valor={sector.objetivo} />
                    <Dato etiqueta="Origen de la actividad" valor={(sector.origen || []).join(', ')} />
                    <Dato etiqueta="Solicitado por" valor={sector.solicitado_por} />
                </div>
                <div className="modal-foot">
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn" onClick={onListo}>Listo</button>
                </div>
            </div>
        );
    }

    const falta = faltaEnSector(sector);
    const listo = falta.length === 0;

    return (
        <div className="modal-body">
            <label className="campo">
                <span className="campo-lbl">Objetivo</span>
                {estrategiaDelSector && (
                    <p className="ayuda">
                        Estrategia en curso: {[estrategiaDelSector.grupo_articulo, estrategiaDelSector.proyecto]
                            .filter(Boolean).join(' · ') || 'sin más detalle'}
                    </p>
                )}
                <input
                    type="text" className="inp" placeholder="¿Qué se busca lograr aquí?"
                    value={sector.objetivo || ''}
                    autoFocus
                    onChange={(e) => editarSector(s => { s.objetivo = e.target.value; })}
                />
            </label>

            <ChipsOrigen sector={sector} editarSector={editarSector} />

            <label className="campo">
                <span className="campo-lbl">Solicitado por</span>
                <input
                    type="text" className="inp" placeholder="Nombre de quien pidió la actividad"
                    value={sector.solicitado_por || ''}
                    onChange={(e) => editarSector(s => { s.solicitado_por = e.target.value; })}
                />
                <p className="ayuda">
                    Quién originó la visita a este sector: el gerente de marca, el vendedor, el propio cliente…
                </p>
            </label>

            <div className="modal-foot">
                <span className={'pista' + (listo ? ' es-ok' : '')}>
                    {listo ? 'Listo para guardar.' : `Falta ${falta.join(' · ')}`}
                </span>
                <span style={{ flex: 1 }} />

                <button
                    type="button" className="btn-txt peligro"
                    onClick={() => {
                        editar(v => { v.sectores = (v.sectores || []).filter(s => s.id !== sector.id); });
                        onListo();
                    }}
                >
                    Quitar
                </button>

                <button
                    type="button" className="btn btn-principal"
                    disabled={!listo}
                    title={listo ? undefined : `Falta: ${falta.join(', ')}`}
                    onClick={() => {
                        if (!sectorCompleto(sector)) return;   // el botón ya está deshabilitado; cinturón

                        // El SELLO lo pone Guardar visita, no este botón: mientras la visita
                        // sea borrador todo sigue corrigiéndose, y sellar aquí mentiría.
                        avisar(`${sector.nombre} agregado a la visita.`, { estado: 'completa' });
                        onListo();
                    }}
                >
                    Guardar sector
                </button>
            </div>
        </div>
    );
}

function ChipsOrigen({ sector, editarSector }: {
    sector: Sector;
    editarSector: (m: (s: Sector) => void) => void;
}) {
    const lista = useMemo(() => origenes(), []);
    const activos = sector.origen || [];

    return (
        <div className="campo">
            <span className="campo-lbl">Origen de la actividad</span>
            <div className="chips">
                {lista.map(origen => {
                    const activo = activos.includes(origen);
                    return (
                        <button
                            key={origen}
                            type="button"
                            className={'chip' + (activo ? ' on' : '')}
                            aria-pressed={activo}
                            onClick={() => editarSector(s => {
                                s.origen = activo
                                    ? (s.origen || []).filter(o => o !== origen)
                                    : [...(s.origen || []), origen];
                            })}
                        >
                            {origen}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

