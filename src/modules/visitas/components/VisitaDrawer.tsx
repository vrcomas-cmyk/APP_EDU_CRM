/**
 * Drawer de visita. Lateral en escritorio, bottom-sheet a altura completa en móvil. Nunca
 * modal centrado: al agendar la pregunta real es "¿dónde cabe esto?", y un modal tapa la
 * respuesta.
 *
 * Dos niveles que se empujan:
 *   VISITA    capturarla (borrador) o ver una ya guardada (congelada, con check-in/out).
 *   SECTOR    sus datos sellados y la lista de sus actividades. Solo en visitas guardadas.
 *
 * El sector, la actividad y el material NO se capturan aquí: cada uno abre su ventana propia.
 * El drawer los lista y los cuenta. Esas ventanas siguen siendo vanilla por ahora, así que se
 * abren a través del puente.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    saludDe, detalleEstado, estadoDe, ESTADOS, duracionTexto, etiquetaDiaLarga,
    sesionActual, registrar, TIPOS_EVENTO, cancelarVisita, reactivarVisita, type Avisar
} from '@core/puente';

import { useVisita } from '../hooks/useVisita';
import { selloDeGuardado, sellarVisita, duplicarVisita } from '../services/fabricas';
import { faltaParaGuardar, tieneCapturaPerdible } from '../validators/requisitos';
import * as repo from '../repository/visitasRepo';

import { FormularioVisita, PanelInformacion } from './FormularioVisita';
import { BloqueCheck, AvisoCancelada } from './BloqueCheck';
import { ListaSectores } from './ListaSectores';
import { CabeceraSector, CuerpoSector } from './NivelSector';
import { BloqueReagendar, HistorialReagendas } from './BloqueReagendar';
import { PieVisita } from './PieVisita';
import type { Visita } from '@core/tipos';

export interface PropsDrawer {
    visitaId: string;
    avisar: Avisar;
    /** Avisa al resto de la app (calendario, contadores) que algo cambió. */
    alCambiar: () => void;
    onCerrar: () => void;
    /** Abre la ventana vanilla de sector. `null` = agregar uno nuevo. */
    abrirVentanaSector: (sectorId: string | null, alTerminar: () => void) => void;
    abrirVentanaActividad: (sectorId: string, actividadId: string | null, alTerminar: () => void) => void;
    /** Abre otra visita en este mismo drawer (para duplicar). */
    abrirOtraVisita: (id: string) => void;
}

export function VisitaDrawer({
    visitaId, avisar, alCambiar, onCerrar,
    abrirVentanaSector, abrirVentanaActividad, abrirOtraVisita
}: PropsDrawer) {
    const { visita, editar, refrescar } = useVisita(visitaId, alCambiar);

    const [sectorId, setSectorId] = useState<string | null>(null);
    const [reagendando, setReagendando] = useState(false);
    const [guardadoReciente, setGuardadoReciente] = useState(false);

    const panelRef = useRef<HTMLElement>(null);
    const relojGuardado = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Al cambiar de visita se vuelve al nivel raíz: quedarse dentro de un sector que pertenece
    // a otra visita mostraría datos que no corresponden.
    useEffect(() => {
        setSectorId(null);
        setReagendando(false);
    }, [visitaId]);

    useEffect(() => () => clearTimeout(relojGuardado.current), []);

    /**
     * Cerrar sin guardar DESCARTA el borrador.
     *
     * Es lo contrario de lo que hace la actividad, que sí conserva el suyo. La diferencia es
     * que la actividad cuelga de una visita que ya existe y se ve en su lista; una visita a
     * medias no colgaría de nada. Guardarla la pondría en el calendario como una cita real que
     * nadie confirmó, y conservarla sin guardar la volvería invisible: trabajo atrapado en un
     * registro que ya no aparece por ningún lado.
     */
    const cerrar = useCallback(() => {
        const actual = repo.obtenerVisita(visitaId);

        if (actual?.borrador) {
            if (tieneCapturaPerdible(actual)
                && !confirm('Esta visita no se ha guardado.\n\n¿Descartarla? Lo capturado se pierde.')) {
                return;
            }
            repo.eliminarVisita(actual.id);
        }

        onCerrar();
        alCambiar();
    }, [visitaId, onCerrar, alCambiar]);

    /** Escape sube un nivel antes de cerrar: desde un sector no se pierde la visita. */
    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key !== 'Escape') return;
            // Las ventanas de sector/actividad/material se cierran solas y están por encima.
            if (document.querySelector('.modal')) return;

            if (sectorId) setSectorId(null);
            else cerrar();
        }

        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [sectorId, cerrar]);

    // El drawer bloquea el scroll del fondo mientras está abierto.
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    useEffect(() => {
        panelRef.current?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true });
    }, [visitaId]);

    const marcarGuardado = useCallback(() => {
        setGuardadoReciente(true);
        clearTimeout(relojGuardado.current);
        relojGuardado.current = setTimeout(() => setGuardadoReciente(false), 1400);
    }, []);

    /** Autoguardado del borrador. NO lo convierte en visita: eso solo lo hace Guardar visita. */
    const editarBorrador = useCallback((mutador: (v: Visita) => void) => {
        editar(mutador);
        marcarGuardado();
    }, [editar, marcarGuardado]);

    /** Aquí nace la visita: se valida, se le quita el borrador y se sellan sus sectores. */
    function guardarVisita() {
        const actual = repo.obtenerVisita(visitaId);
        if (!actual) return;

        const falta = faltaParaGuardar(actual);
        if (falta.length > 0) {
            avisar(`Falta ${falta.join(' · ')}.`, { estado: 'sin-registrar', ms: 6000 });
            return;
        }

        const sello = selloDeGuardado(sesionActual());
        const guardada = editar(v => sellarVisita(v, sello));

        if (guardada) {
            registrar(TIPOS_EVENTO.VISITA_PROGRAMADA ?? 'visita_programada', guardada, {
                dia: guardada.dia,
                hora_inicio: guardada.hora_inicio,
                hora_fin: guardada.hora_fin,
                sectores: (guardada.sectores || []).map(s => s.nombre).join(', ')
            });
        }

        avisar('Visita guardada. Sus sectores quedan registrados y ya no se editan.',
            { estado: 'completa', ms: 5000 });
    }

    /**
     * En una visita ya guardada, lo que se capture en la ventana de sector se sella al
     * cerrarla: la visita ya existe, así que un sector nuevo nace definitivo en vez de
     * esperar a un "Guardar visita" que ya ocurrió.
     */
    function abrirSector(id: string | null) {
        const eraBorrador = Boolean(repo.obtenerVisita(visitaId)?.borrador);

        abrirVentanaSector(id, () => {
            if (!eraBorrador) {
                const sello = selloDeGuardado(sesionActual());
                editar(v => {
                    (v.sectores || []).forEach(s => { if (!s.guardado) s.guardado = { ...sello }; });
                });
            } else {
                refrescar();
                alCambiar();
            }
        });
    }

    /** Doble confirmación: cancelar una visita nunca debe pasar por accidente. */
    function pedirCancelacion(v: Visita) {
        if (!confirm(`¿Cancelar la visita a ${v.cliente || 'este cliente'}?\n\nNo se borra: queda en el calendario como registro.`)) return;

        const motivo = prompt('¿Por qué se cancela? (queda en el registro)');
        if (motivo === null) return;

        const r = cancelarVisita(visitaId, motivo);
        if (!r.ok) { avisar(r.error || 'No se pudo cancelar.', { estado: 'sin-registrar' }); return; }

        avisar('Visita cancelada.', {
            estado: 'programada',
            accion: { texto: 'Deshacer', fn: () => { reactivarVisita(visitaId); refrescar(); alCambiar(); } }
        });
        refrescar();
        alCambiar();
    }

    function duplicar(v: Visita) {
        const copia = duplicarVisita(v, sesionActual(), repo.nuevoId);
        repo.agregarVisita(copia);
        abrirOtraVisita(copia.id);
    }

    if (!visita) return null;

    const sector = sectorId ? (visita.sectores || []).find(s => s.id === sectorId) ?? null : null;
    const cancelada = estadoDe(visita) === ESTADOS.CANCELADA;

    return (
        <div className="drawer-raiz">
            <div className="scrim" onClick={cerrar} />

            <aside className="drawer" role="dialog" aria-modal="true" aria-label="Visita" ref={panelRef}>
                {sector ? (
                    <>
                        <CabeceraSector
                            visita={visita}
                            sector={sector}
                            onVolver={() => setSectorId(null)}
                            onCerrar={cerrar}
                        />
                        <CuerpoSector
                            visita={visita}
                            sector={sector}
                            onAbrirActividad={(actividadId) =>
                                abrirVentanaActividad(sector.id, actividadId, () => { refrescar(); alCambiar(); })}
                        />
                    </>
                ) : (
                    <>
                        <CabeceraVisita visita={visita} onCerrar={cerrar} />

                        <div className="drawer-body">
                            {visita.borrador ? (
                                <FormularioVisita visita={visita} editar={editarBorrador} avisar={avisar} />
                            ) : (
                                <>
                                    {cancelada
                                        ? <AvisoCancelada visita={visita} avisar={avisar}
                                                          alTerminar={() => { refrescar(); alCambiar(); }} />
                                        : <BloqueCheck visita={visita} avisar={avisar}
                                                       alTerminar={() => { refrescar(); alCambiar(); }} />}

                                    <PanelInformacion visita={visita} />

                                    {reagendando && (
                                        <BloqueReagendar
                                            visita={visita}
                                            avisar={avisar}
                                            alReagendar={() => { setReagendando(false); refrescar(); alCambiar(); }}
                                        />
                                    )}
                                    <HistorialReagendas visita={visita} />
                                </>
                            )}

                            <ListaSectores
                                visita={visita}
                                onAbrirSector={(id) => {
                                    // Mientras la visita es borrador el sector todavía se corrige,
                                    // y eso pasa en su ventana. Ya guardada, entrar al sector es
                                    // entrar a sus actividades: no hay nada que editar.
                                    if (visita.borrador) abrirSector(id);
                                    else setSectorId(id);
                                }}
                                onAgregarSector={() => abrirSector(null)}
                            />
                        </div>
                    </>
                )}

                <PieVisita
                    visita={visita}
                    enSector={Boolean(sector)}
                    reagendando={reagendando}
                    guardadoReciente={guardadoReciente}
                    onVolver={() => setSectorId(null)}
                    onCerrar={cerrar}
                    onGuardar={guardarVisita}
                    onDuplicar={() => duplicar(visita)}
                    onReagendar={() => setReagendando(r => !r)}
                    onCancelar={() => pedirCancelacion(visita)}
                />
            </aside>
        </div>
    );
}

function CabeceraVisita({ visita, onCerrar }: { visita: Visita; onCerrar: () => void }) {
    return (
        <div className="drawer-head">
            <div className="drawer-head-txt">
                <h3>{visita.borrador ? 'Nueva visita' : (visita.hospital || visita.cliente || 'Visita')}</h3>

                {visita.borrador ? (
                    <span className="eyebrow">{etiquetaDiaLarga(visita.dia)}</span>
                ) : (
                    <>
                        <p className="drawer-sub">{visita.cliente || 'Sin cliente'}</p>
                        <p className="drawer-cuando mono">
                            {etiquetaDiaLarga(visita.dia)} · {visita.hora_inicio}–{visita.hora_fin} · {duracionTexto(visita)}
                        </p>
                        <span className={`pill st-${saludDe(visita)}`}>{detalleEstado(visita)}</span>
                    </>
                )}
            </div>

            <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
        </div>
    );
}
