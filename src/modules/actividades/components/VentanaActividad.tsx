/**
 * Ventana de una actividad. Una a la vez.
 *
 * Antes se pintaban todas desplegadas dentro del sector, y el sector se volvía un formulario
 * larguísimo donde no se sabía qué campo pertenecía a cuál. Capturar de pie, con el cliente
 * esperando, exige una sola pregunta a la vez.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    estaGuardada, sesionActual, describirDispositivo, registrar, TIPOS_EVENTO, type Avisar
} from '@core/puente';

import { faltantesDe, resumenDeFaltantes, estaVacia } from '../validators/requisitos';
import { selloDeActividad } from '../services/fabricas';
import { FormularioActividad } from './FormularioActividad';
import { ActividadSellada } from './ActividadSellada';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Actividad, Visita, Sector } from '@core/tipos';

export interface PropsVentana {
    visitaId: string;
    sectorId: string;
    actividadId: string;
    avisar: Avisar;
    alCambiar: () => void;
    onCerrar: () => void;
    /** Abre la ventana de materiales, que todavía es vanilla. */
    abrirVentanaMaterial: (sector: string, onAgregar: (m: { id: string }) => void) => void;
    construirEvidencia: (a: Actividad) => Node | null;
    construirComentarios: (a: Actividad, v: Visita) => Node | null;
}

export function VentanaActividad({
    visitaId, sectorId, actividadId, avisar, alCambiar, onCerrar,
    abrirVentanaMaterial, construirEvidencia, construirComentarios
}: PropsVentana) {
    // Solo existe para forzar el repintado tras escribir en el almacén, que es la fuente de
    // verdad. No se usa como `key`: eso remontaría el formulario en cada tecla y tiraría el
    // foco del campo que se está escribiendo.
    const [, setVersion] = useState(0);
    const [errores, setErrores] = useState<Record<string, string>>({});
    const cajaRef = useRef<HTMLDivElement>(null);

    const leer = useCallback(() => {
        const visita = repo.obtenerVisita(visitaId);
        const sector = visita?.sectores?.find(s => s.id === sectorId) ?? null;
        const actividad = sector?.actividades?.find(a => a.id === actividadId) ?? null;
        return { visita, sector, actividad };
    }, [visitaId, sectorId, actividadId]);

    const { visita, sector, actividad } = leer();

    const editar = useCallback((mutador: (a: Actividad) => void) => {
        repo.actualizarVisita(visitaId, v => {
            const s = v.sectores?.find(x => x.id === sectorId);
            const a = s?.actividades?.find(x => x.id === actividadId);
            if (a) mutador(a);
        });
        setVersion(n => n + 1);
        alCambiar();
    }, [visitaId, sectorId, actividadId, alCambiar]);

    const eliminar = useCallback(() => {
        repo.actualizarVisita(visitaId, v => {
            const s = v.sectores?.find(x => x.id === sectorId);
            if (s) s.actividades = (s.actividades || []).filter(a => a.id !== actividadId);
        });
        alCambiar();
    }, [visitaId, sectorId, actividadId, alCambiar]);

    /**
     * Un borrador en el que no se escribió nada se descarta al cerrar. No es trabajo perdido:
     * es un botón presionado por error, y dejarlo llenaría el sector de tarjetas vacías que
     * después nadie sabe si borrar.
     */
    const cerrar = useCallback(() => {
        const { actividad: act } = leer();
        if (act && !estaGuardada(act) && estaVacia(act)) eliminar();
        onCerrar();
        alCambiar();
    }, [leer, eliminar, onCerrar, alCambiar]);

    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            cerrar();
        }
        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [cerrar]);

    useEffect(() => {
        cajaRef.current?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
    }, []);

    function intentarGuardar() {
        const { actividad: act, visita: v, sector: s } = leer();
        if (!act || !v || !s) { cerrar(); return; }

        const faltantes = faltantesDe(act);

        if (faltantes.length > 0) {
            setErrores(Object.fromEntries(faltantes.map(f => [f.campoId, f.mensaje])));
            avisar(resumenDeFaltantes(faltantes), { estado: 'sin-registrar' });

            // Se lleva la vista al primero: en un teléfono el campo en falta puede estar fuera
            // de pantalla, y el rojo no sirve si no se ve.
            cajaRef.current?.querySelector('.es-error')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        setErrores({});
        const sello = selloDeActividad(sesionActual(), describirDispositivo());
        editar(a => { a.guardada = sello; delete (a as { borrador?: boolean }).borrador; });

        emitirEventos(v, s, act);
        avisar('Actividad guardada. Queda registrada y ya no se edita.', { estado: 'completa' });
    }

    /**
     * Los eventos se emiten AQUÍ, al sellar, no al crear el borrador.
     *
     * La bitácora registra hechos, y hasta este momento no había ninguno. En una versión
     * anterior el contacto emitía un evento por cada tecla escrita en su nombre, y la bitácora
     * se llenaba de estados intermedios que no ocurrieron.
     */
    function emitirEventos(v: Visita, s: Sector, act: Actividad) {
        registrar(TIPOS_EVENTO.ACTIVIDAD ?? 'actividad', v, {
            sector: s.nombre, id_actividad: act.id,
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
                sector: s.nombre, id_actividad: act.id,
                material: m.material, cantidad: m.cantidad, unidad: m.unidad, origen: m.origen
            });
        }
    }

    function descartar() {
        const { actividad: act } = leer();
        if (act && !estaVacia(act)
            && !confirm('¿Descartar esta actividad? Lo capturado se pierde.')) return;

        eliminar();
        onCerrar();
    }

    if (!visita || !sector || !actividad) return null;

    const sellada = estaGuardada(actividad);

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
            <div className="modal-caja es-actividad" ref={cajaRef}>
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{sellada ? 'Actividad registrada' : 'Registrar actividad'}</h3>
                        <span className="eyebrow">{sector.nombre}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={cerrar}>✕</button>
                </div>

                {sellada ? (
                    <ActividadSellada
                        visita={visita}
                        sector={sector}
                        actividad={actividad}
                        construirEvidencia={() => construirEvidencia(actividad)}
                        construirComentarios={() => construirComentarios(actividad, visita)}
                        onCerrar={cerrar}
                    />
                ) : (
                    <>
                        <FormularioActividad
                            visita={visita}
                            sector={sector}
                            actividad={actividad}
                            editar={editar}
                            errores={errores}
                            onAgregarMaterial={() => abrirVentanaMaterial(sector.nombre, (nuevo) => {
                                editar(a => { a.materiales = [...(a.materiales || []), nuevo as never]; });
                            })}
                            onQuitarMaterial={(id) => editar(a => {
                                a.materiales = (a.materiales || []).filter(m => m.id !== id);
                            })}
                        />

                        <div className="modal-foot">
                            <span className="sello es-borrador">BORRADOR · sin guardar</span>
                            <span style={{ flex: 1 }} />
                            <button type="button" className="btn-txt peligro" onClick={descartar}>
                                Descartar
                            </button>
                            <button type="button" className="btn btn-principal" onClick={intentarGuardar}>
                                Guardar actividad
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
