/**
 * "Subir Actividad": llenar la actividad UNA sola vez y aplicarla a varios sectores a la vez.
 *
 * Antes, capturar la misma actividad en 3 sectores trabajados exigía entrar a los 3 sectores y
 * repetir el formulario 3 veces — con evidencia por sector, aunque fuera la misma foto. Aquí se
 * llena una vez y se elige a cuáles sectores aplica — los que ya estaban programados en la
 * visita, y/o sectores que se trabajaron sin haber sido programados (se agregan aquí mismo,
 * buscándolos en el catálogo).
 *
 * Es UN SOLO registro (una evidencia, un resultado), no una copia por sector: vive físicamente
 * en un sector "ancla" y `Actividad.sectores_ids` lista TODOS los que cubre. Los demás sectores
 * quedan en segundo plano — se ven en su lista de actividades (`actividadesDeSector`) y se
 * pueden abrir desde cualquiera de ellos, pero es la misma actividad, no una repetida.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    sectores as catalogoSectores, sesionActual, describirDispositivo,
    registrar, TIPOS_EVENTO, type Avisar
} from '@core/puente';
import { sectoresLibres } from '@modules/sectores/validators/requisitos';
import { filtrarSectores } from '@modules/sectores/services/busqueda';
import { faltantesDe, resumenDeFaltantes, type Faltante } from '../validators/requisitos';
import { nuevaActividad, selloDeActividad } from '../services/fabricas';
import { FormularioActividad } from './FormularioActividad';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Actividad, Sector, Visita } from '@core/tipos';

export interface PropsSubirActividad {
    visitaId: string;
    avisar: Avisar;
    alCambiar: () => void;
    onCerrar: () => void;
    abrirVentanaMaterial: (sector: string, onAgregar: (m: { id: string }) => void) => void;
}

/** Sector "de mentiras" solo para que `FormularioActividad` tenga algo que mostrar en el
 *  contexto automático — todavía no se sabe a cuáles sectores reales va a aplicar. */
const SECTOR_PLACEHOLDER: Sector = { id: '', nombre: 'Varios sectores' };

export function VentanaSubirActividad({
    visitaId, avisar, alCambiar, onCerrar, abrirVentanaMaterial
}: PropsSubirActividad) {
    const [actividad, setActividad] = useState<Actividad>(() => nuevaActividad(repo.nuevoId));
    const [errores, setErrores] = useState<Record<string, string>>({});
    const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
    const [nuevosSectores, setNuevosSectores] = useState<string[]>([]);
    const [consulta, setConsulta] = useState('');
    const cajaRef = useRef<HTMLDivElement>(null);

    const visita = repo.obtenerVisita(visitaId);

    // Catálogo memoizado una vez, igual que en VentanaSector: el buscador filtra sobre esto.
    const catalogo = useMemo(() => catalogoSectores(), []);

    // Los mutadores de FormularioActividad reasignan propiedades de nivel superior (o uno
    // anidado, siempre con spread), nunca mutan en sitio — una copia superficial alcanza.
    const editarActividad = useCallback((mutador: (a: Actividad) => void) => {
        setActividad(prev => {
            const copia = { ...prev };
            mutador(copia);
            return copia;
        });
    }, []);

    const cerrar = useCallback(() => {
        onCerrar();
    }, [onCerrar]);

    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            cerrar();
        }
        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [cerrar]);

    if (!visita) return null;

    const sectoresVisita = visita.sectores || [];
    const libres = sectoresLibres(catalogo, visita).filter(n => !nuevosSectores.includes(n));
    const encontrados = filtrarSectores(libres, consulta);

    const toggleSeleccionado = (id: string) => {
        setSeleccionados(prev => {
            const copia = new Set(prev);
            if (copia.has(id)) copia.delete(id); else copia.add(id);
            return copia;
        });
    };

    const agregarSectorNuevo = (nombre: string) => {
        setNuevosSectores(prev => [...prev, nombre]);
        setConsulta('');
    };

    const quitarSectorNuevo = (nombre: string) => {
        setNuevosSectores(prev => prev.filter(n => n !== nombre));
    };

    const totalDestinos = seleccionados.size + nuevosSectores.length;

    function confirmar() {
        const faltantes: Faltante[] = faltantesDe(actividad);
        if (faltantes.length > 0) {
            setErrores(Object.fromEntries(faltantes.map(f => [f.campoId, f.mensaje])));
            avisar(resumenDeFaltantes(faltantes), { estado: 'sin-registrar' });
            cajaRef.current?.querySelector('.es-error')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        setErrores({});

        if (totalDestinos === 0) {
            avisar('Elige al menos un sector.', { estado: 'sin-registrar' });
            return;
        }

        const sello = selloDeActividad(sesionActual(), describirDispositivo());
        const idsExistentes = [...seleccionados];

        const v2 = repo.actualizarVisita(visitaId, (v) => {
            v.sectores ||= [];

            // Sectores NUEVOS (no programados) primero, para tener sus ids listos.
            const idsNuevos = nuevosSectores.map(nombre => {
                const id = repo.nuevoId('s');
                v.sectores!.push({
                    id, nombre, objetivo: '', origen: [], programado: false, actividades: []
                });
                return id;
            });

            const todosLosIds = [...idsExistentes, ...idsNuevos];
            // Ancla: el primer sector elegido (prioriza uno YA programado sobre uno agregado
            // aquí). Es solo dónde vive físicamente el registro — `sectores_ids` dice a
            // cuáles aplica de verdad, así que cuál sea la ancla no cambia nada para quien
            // lo ve desde otro sector.
            const idAncla = todosLosIds[0]!;
            const sectorAncla = v.sectores!.find(s => s.id === idAncla);
            if (!sectorAncla) return;

            const actividadFinal: Actividad = {
                ...actividad, id: repo.nuevoId('a'), guardada: sello,
                // Solo se marca cuando cubre más de un sector: una de un solo sector se
                // comporta exactamente como las de siempre, sin campo extra que explicar.
                sectores_ids: todosLosIds.length > 1 ? todosLosIds : undefined
            };
            (sectorAncla.actividades ||= []).push(actividadFinal);

            // Un solo evento, no uno por sector: es UN hecho que cubre varios sectores, igual
            // que hay una sola evidencia — repetir el evento por cada uno inflaría la
            // bitácora con "lo mismo" varias veces.
            const nombres = todosLosIds.map(id => v.sectores!.find(s => s.id === id)?.nombre || '');
            emitirEventos(v, nombres, actividadFinal);
        });

        if (!v2) { cerrar(); return; }

        avisar(
            `Actividad registrada en ${totalDestinos} sector${totalDestinos === 1 ? '' : 'es'}.`,
            { estado: 'completa' }
        );
        alCambiar();
        cerrar();
    }

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
            <div className="modal-caja es-actividad" ref={cajaRef}>
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>Subir actividad</h3>
                        <span className="eyebrow">
                            Se llena una vez y se aplica a los sectores que elijas
                        </span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={cerrar}>✕</button>
                </div>

                <FormularioActividad
                    visita={visita}
                    sector={SECTOR_PLACEHOLDER}
                    actividad={actividad}
                    editar={editarActividad}
                    errores={errores}
                    onAgregarMaterial={() => abrirVentanaMaterial(SECTOR_PLACEHOLDER.nombre, (nuevo) => {
                        editarActividad(a => { a.materiales = [...(a.materiales || []), nuevo as never]; });
                    })}
                    onQuitarMaterial={(id) => editarActividad(a => {
                        a.materiales = (a.materiales || []).filter(m => m.id !== id);
                    })}
                />

                <div className="modal-body">
                    <SeccionSectores
                        sectoresVisita={sectoresVisita}
                        seleccionados={seleccionados}
                        onToggle={toggleSeleccionado}
                        nuevosSectores={nuevosSectores}
                        onQuitarNuevo={quitarSectorNuevo}
                        consulta={consulta}
                        onConsulta={setConsulta}
                        encontrados={encontrados}
                        catalogo={catalogo}
                        onAgregarNuevo={agregarSectorNuevo}
                    />
                </div>

                <div className="modal-foot">
                    <span className="sello es-borrador">
                        {totalDestinos === 0 ? 'Elige al menos un sector' : `${totalDestinos} sector${totalDestinos === 1 ? '' : 'es'} elegido${totalDestinos === 1 ? '' : 's'}`}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn-txt" onClick={cerrar}>Cancelar</button>
                    <button type="button" className="btn btn-principal" onClick={confirmar}>
                        Registrar actividad
                    </button>
                </div>
            </div>
        </div>
    );
}

function emitirEventos(v: Visita, sectorNombres: string[], act: Actividad) {
    const sectores = sectorNombres.filter(Boolean).join(', ');

    registrar(TIPOS_EVENTO.ACTIVIDAD ?? 'actividad', v, {
        sector: sectores, id_actividad: act.id,
        tipo: act.tipo, area_visitada: act.area_visitada,
        materiales: (act.materiales || []).length
    });

    const nombre = (act.contacto?.nombre || '').trim();
    if (nombre) {
        registrar(TIPOS_EVENTO.CONTACTO ?? 'contacto', v, {
            id_actividad: act.id, contacto: nombre,
            cargo: act.contacto?.cargo || '', servicio: act.contacto?.servicio || ''
        });
    }

    for (const m of act.materiales || []) {
        registrar(TIPOS_EVENTO.MATERIAL ?? 'material', v, {
            sector: sectores, id_actividad: act.id,
            material: m.material, cantidad: m.cantidad, unidad: m.unidad, origen: m.origen
        });
    }
}

function SeccionSectores({
    sectoresVisita, seleccionados, onToggle, nuevosSectores, onQuitarNuevo,
    consulta, onConsulta, encontrados, catalogo, onAgregarNuevo
}: {
    sectoresVisita: Sector[];
    seleccionados: Set<string>;
    onToggle: (id: string) => void;
    nuevosSectores: string[];
    onQuitarNuevo: (nombre: string) => void;
    consulta: string;
    onConsulta: (v: string) => void;
    encontrados: string[];
    catalogo: string[];
    onAgregarNuevo: (nombre: string) => void;
}) {
    return (
        <>
            {sectoresVisita.length > 0 && (
                <div className="campo">
                    <span className="campo-lbl">Sectores programados de esta visita</span>
                    <div className="chips">
                        {sectoresVisita.map(s => (
                            <button
                                key={s.id}
                                type="button"
                                className={'chip' + (seleccionados.has(s.id) ? ' on' : '')}
                                onClick={() => onToggle(s.id)}
                            >
                                {s.nombre}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="campo">
                <span className="campo-lbl">
                    Se trabajó un sector que no estaba programado
                </span>
                <p className="ayuda">
                    Búscalo y agrégalo — se sumará a la visita marcado como trabajado sin haber
                    sido programado.
                </p>

                {nuevosSectores.length > 0 && (
                    <div className="chips">
                        {nuevosSectores.map(nombre => (
                            <button
                                key={nombre} type="button" className="chip on"
                                onClick={() => onQuitarNuevo(nombre)}
                                title="Quitar"
                            >
                                {nombre} ✕
                            </button>
                        ))}
                    </div>
                )}

                {catalogo.length === 0 ? (
                    <p className="ayuda">
                        El catálogo de sectores no ha cargado todavía. Conéctate para descargarlo.
                    </p>
                ) : (
                    <>
                        <input
                            type="text" className="inp" autoComplete="off"
                            placeholder="Buscar sector…"
                            value={consulta}
                            onChange={(e) => onConsulta(e.target.value)}
                        />
                        {consulta && (
                            <div className="mat-res">
                                {encontrados.length === 0 ? (
                                    <p className="ayuda">Ningún sector coincide con "{consulta}".</p>
                                ) : (
                                    encontrados.map(nombre => (
                                        <button
                                            key={nombre} type="button" className="mat-opt"
                                            onClick={() => onAgregarNuevo(nombre)}
                                        >
                                            {nombre}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}
