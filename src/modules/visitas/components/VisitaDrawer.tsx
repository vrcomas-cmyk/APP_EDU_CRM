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
    sesionActual, registrar, TIPOS_EVENTO, cancelarVisita, reactivarVisita,
    hiloComentarios, AMBITOS, type Avisar
} from '@core/puente';

import { useVisita } from '../hooks/useVisita';
import { selloDeGuardado, sellarVisita, duplicarVisita } from '../services/fabricas';
import { faltaParaGuardar, tieneCapturaPerdible } from '../validators/requisitos';
import { reflejarEnCalendar, quitarDeCalendar } from '../services/calendarSync';
import { puedeEditarVisita, motivoDeBloqueo } from '../permissions/edicion';
import * as repo from '../repository/visitasRepo';
import { NodoVanilla } from '@shared/components/NodoVanilla';

import { FormularioVisita, PanelInformacion } from './FormularioVisita';
import { BloqueCheck, AvisoCancelada } from './BloqueCheck';
import { ListaSectores } from './ListaSectores';
import { CabeceraSector, CuerpoSector } from './NivelSector';
import { BloqueReagendar, HistorialReagendas } from './BloqueReagendar';
import { PieVisita } from './PieVisita';
import type { Visita } from '@core/tipos';

export interface PropsDrawer {
    visitaId: string;
    /**
     * Cambia cuando algo FUERA de React escribe en el almacén — la ventana de sector y la de
     * actividad lo hacen directamente. Sin esto el drawer se queda con la copia que leyó al
     * montarse: los sectores recién agregados no aparecen y Guardar sigue deshabilitado
     * aunque ya no falte nada.
     */
    version?: number;
    avisar: Avisar;
    /** Avisa al resto de la app (calendario, contadores) que algo cambió. */
    alCambiar: () => void;
    onCerrar: () => void;
    /** Abre la ventana vanilla de sector. `null` = agregar uno nuevo. */
    abrirVentanaSector: (sectorId: string | null, alTerminar: () => void, anfitrion: HTMLElement | null) => void;
    abrirVentanaActividad: (
        sectorId: string, actividadId: string | null, alTerminar: () => void,
        anfitrion: HTMLElement | null, soloLectura?: boolean
    ) => void;
    /** Abre otra visita en este mismo drawer (para duplicar). */
    abrirOtraVisita: (id: string) => void;
}

export function VisitaDrawer({
    visitaId, version = 0, avisar, alCambiar, onCerrar,
    abrirVentanaSector, abrirVentanaActividad, abrirOtraVisita
}: PropsDrawer) {
    const { visita, editar, refrescar } = useVisita(visitaId, alCambiar);

    /**
     * Anfitrión de las ventanas que todavía son vanilla (sector, actividad, material).
     *
     * Tiene que vivir DENTRO de `.drawer-raiz`, y el motivo es de apilado: `.drawer-raiz` es
     * `z-index: 50` y crea un contexto propio; `.modal` es `z-index: 20`. Colgando el modal
     * fuera de ese contexto queda por DEBAJO del drawer — visible a medias, y los clics se los
     * come el scrim, que responde cerrando la visita. Era exactamente eso: al intentar agregar
     * un sector aparecía "¿Descartarla?" en vez de la ventana.
     *
     * React renderiza este div siempre vacío, así que nunca reconcilia sus hijos y los nodos
     * que se le cuelguen a mano sobreviven a los repintados.
     */
    const anfitrionVentanas = useRef<HTMLDivElement>(null);

    const [sectorId, setSectorId] = useState<string | null>(null);
    const [reagendando, setReagendando] = useState(false);
    const [guardadoReciente, setGuardadoReciente] = useState(false);
    const [pidiendoCancelacion, setPidiendoCancelacion] = useState(false);
    /**
     * Pestaña del drawer para una visita ya GUARDADA (en borrador sólo hay Captura +
     * Sectores, meter pestañas sería ruido de una sola opción).
     *
     * Vuelve a "captura" al cambiar de visita: una pestaña elegida en una visita aplicada a
     * otra confunde — "Cerré la visita de Ana en Historial, abrí la de Juan y sigo en
     * Historial aunque最早 Juan ni tenga reagendas".
     */
    const [pestana, setPestana] = useState<'captura' | 'sectores' | 'historial'>('captura');

    const panelRef = useRef<HTMLElement>(null);
    const relojGuardado = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // Al cambiar de visita se vuelve al nivel raíz: quedarse dentro de un sector que pertenece
    // a otra visita mostraría datos que no corresponden.
    useEffect(() => {
        setSectorId(null);
        setReagendando(false);
        setPestana('captura');
    }, [visitaId]);

    useEffect(() => () => clearTimeout(relojGuardado.current), []);

    // Las ventanas vanilla escriben directo en el almacén; esto es lo que hace que el drawer
    // se entere.
    useEffect(() => { refrescar(); }, [version, refrescar]);

    /**
     * Rellena el educador de un BORRADOR cuando la sesión llegó tarde.
     *
     * Google Identity resuelve de forma asíncrona: una visita creada en esa ventana nace sin
     * educador. Y eso no es un detalle cosmético — el educador es uno de los siete requisitos
     * para guardar, y NO es un campo escribible (dejarlo escribir permitiría registrar a
     * nombre de otra persona). Sin esto, ese borrador queda imposible de guardar y sin ninguna
     * forma de arreglarlo desde la pantalla: trabajo muerto.
     *
     * Solo aplica a borradores. Una visita ya guardada afirmó quién la hizo, y reescribirlo
     * cambiaría de quién es el trabajo.
     */
    useEffect(() => {
        if (!visita?.borrador) return;
        if ((visita.educador || '').trim()) return;

        const sesion = sesionActual();
        if (!sesion?.nombre) return;

        editar(v => {
            v.educador = sesion.nombre || '';
            v.educador_correo = sesion.correo || '';
        }, { silencioso: true });
    }, [visita, editar]);

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

        if (guardada) void reflejarEnCalendar(guardada, editar, avisar);
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
        }, anfitrionVentanas.current);
    }

    /**
     * `confirm`/`prompt` nativos no aparecen en una PWA instalada (`display: standalone`):
     * devuelven `null` de inmediato y la cancelación quedaba imposible de completar. El motivo
     * —obligatorio, y la propia confirmación de que se quiere cancelar— se pide con un modal.
     */
    function confirmarCancelacion(motivo: string) {
        setPidiendoCancelacion(false);

        const r = cancelarVisita(visitaId, motivo);
        if (!r.ok) { avisar(r.error || 'No se pudo cancelar.', { estado: 'sin-registrar' }); return; }

        avisar('Visita cancelada.', {
            estado: 'programada',
            accion: { texto: 'Deshacer', fn: () => { reactivarVisita(visitaId); refrescar(); alCambiar(); } }
        });
        if (visita) void quitarDeCalendar(visita, avisar);
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

    /**
     * Visita de otra persona: se ve completa, no se le agrega ni modifica nada. Antes esta
     * regla solo existía del lado de la ESCRITURA (`visitasRepo.actualizarVisita` la rechaza en
     * silencio) — quien mira la visita de su equipo veía cada botón habilitado, lo usaba
     * creyendo que funcionaba, y el cambio simplemente no se guardaba. Calcularlo aquí también
     * deja apagar esos controles y decir POR QUÉ, en vez de dejar que fallen callados.
     */
    const soloLectura = !visita.borrador && !puedeEditarVisita(visita);

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
                            avisar={avisar}
                            soloLectura={soloLectura}
                            onAbrirActividad={(actividadId) =>
                                abrirVentanaActividad(sector.id, actividadId,
                                    () => { refrescar(); alCambiar(); },
                                    anfitrionVentanas.current, soloLectura)}
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
                                    {soloLectura && (
                                        <p className="aviso">{motivoDeBloqueo(visita)}</p>
                                    )}

                                    {/* Pestañas en visita guardada: el historial (reagendas) es lo
                                        último que se consulta y estaba enterrado abajo del todo.
                                        Moverlo a su solapa lleva a un vistazo lo que hoy exige
                                        scrollear al fondo. El `.seg` reutiliza el mismo gesto del
                                        calendario (Día/Semana/Mes): no se introduce un control nuevo
                                        para una sola pantalla. "Captura" aloja lo de hoy y los
                                        comentarios — se ve de corrido en uso de pie; separarlos en
                                        solapa propia obligaría a cambiar para agregar uno y verlo
                                        recién escrito. */}
                                    <div className="seg drawer-seg" role="tablist" aria-label="Secciones de la visita">
                                        <button type="button" role="tab"
                                                aria-selected={pestana === 'captura'}
                                                onClick={() => setPestana('captura')}>
                                            Captura
                                        </button>
                                        <button type="button" role="tab"
                                                aria-selected={pestana === 'sectores'}
                                                onClick={() => setPestana('sectores')}>
                                            Sectores
                                        </button>
                                        <button type="button" role="tab"
                                                aria-selected={pestana === 'historial'}
                                                onClick={() => setPestana('historial')}>
                                            Historial
                                        </button>
                                    </div>

                                    {pestana === 'captura' && (
                                        <>
                                            {cancelada
                                                ? <AvisoCancelada visita={visita} avisar={avisar}
                                                                  alTerminar={() => { refrescar(); alCambiar(); }} />
                                                : <BloqueCheck visita={visita} avisar={avisar} soloLectura={soloLectura}
                                                               alTerminar={() => { refrescar(); alCambiar(); }} />}

                                            <PanelInformacion visita={visita} editar={editar} />

                                            <div className="campo">
                                                <span className="campo-lbl">Comentarios de la visita</span>
                                                <NodoVanilla
                                                    clave={visita.id}
                                                    construir={() => hiloComentarios({
                                                        ambito: AMBITOS.VISITA,
                                                        idAmbito: visita.id,
                                                        visita,
                                                        alToast: avisar
                                                    })}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {pestana === 'sectores' && (
                                        <ListaSectores
                                            visita={visita}
                                            soloLectura={soloLectura}
                                            onAbrirSector={(id) => setSectorId(id)}
                                            onAgregarSector={() => abrirSector(null)}
                                        />
                                    )}

                                    {pestana === 'historial' && (
                                        <>
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
                                </>
                            )}

                            {/* En el borrador los sectores siguen en raíz: su "Venana"
                                todavía los edita, no los exhibe. */}
                            {visita.borrador && (
                                <ListaSectores
                                    visita={visita}
                                    soloLectura={soloLectura}
                                    onAbrirSector={(id) => abrirSector(id)}
                                    onAgregarSector={() => abrirSector(null)}
                                />
                            )}
                        </div>
                    </>
                )}

                <PieVisita
                    visita={visita}
                    enSector={Boolean(sector)}
                    reagendando={reagendando}
                    guardadoReciente={guardadoReciente}
                    soloLectura={soloLectura}
                    onVolver={() => setSectorId(null)}
                    onCerrar={cerrar}
                    onGuardar={guardarVisita}
                    onDuplicar={() => duplicar(visita)}
                    onReagendar={() => setReagendando(r => !r)}
                    onCancelar={() => setPidiendoCancelacion(true)}
                />
            </aside>

            {/* Siempre vacío para React; las ventanas vanilla se cuelgan aquí. */}
            <div className="ventanas-host" ref={anfitrionVentanas} />

            {pidiendoCancelacion && (
                <ModalCancelacion
                    visita={visita}
                    onCancelar={() => setPidiendoCancelacion(false)}
                    onConfirmar={confirmarCancelacion}
                />
            )}
        </div>
    );
}

/** Reemplaza a `confirm`/`prompt`, que una PWA instalada no muestra. Motivo obligatorio. */
function ModalCancelacion({ visita, onCancelar, onConfirmar }: {
    visita: Visita;
    onCancelar: () => void;
    onConfirmar: (motivo: string) => void;
}) {
    const [motivo, setMotivo] = useState('');

    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') { e.stopPropagation(); onCancelar(); }
        }
        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [onCancelar]);

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
            <div className="modal-caja">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>¿Cancelar la visita?</h3>
                        <span className="eyebrow">
                            {visita.cliente || 'Este cliente'} · no se borra, queda en el calendario como registro
                        </span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCancelar}>✕</button>
                </div>
                <div className="modal-body">
                    <label className="campo">
                        <span className="campo-lbl">Motivo</span>
                        <input
                            type="text" className="inp" autoFocus
                            placeholder="¿Por qué se cancela?"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && motivo.trim()) onConfirmar(motivo.trim());
                            }}
                        />
                        <p className="ayuda">Obligatorio: queda en el registro</p>
                    </label>
                    <div className="modal-foot">
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn-txt" onClick={onCancelar}>Volver</button>
                        <button
                            type="button" className="btn-txt peligro"
                            disabled={!motivo.trim()}
                            onClick={() => onConfirmar(motivo.trim())}
                        >
                            Cancelar visita
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function CabeceraVisita({ visita, onCerrar }: { visita: Visita; onCerrar: () => void }) {
    const agarre = useSwipeCerrar(onCerrar);
    return (
        <div className="drawer-head">
            {/* Barra de agarre visible solo en móvil: comunica el affordance "esto se
                desliza hacia abajo" sin carteles. En escritorio no pinta nada. */}
            <div className="drawer-agarre" ref={agarre} aria-hidden="true" />
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

/**
 * Hook de swipe-to-close SOLO en móvil. En escritorio el `.drawer` es lateral derecho y
 * arrastrarlo hacia abajo no significa nada; aquí, en cambio, es un bottom-sheet y el usuario
 * espera cerrarlo bajándolo — el mismo gesto que cualquier bottom-sheet nativo.
 *
 * La zona activa es un "agarre" `.drawer-agarre`: una barrita visible arriba del sheet en
 * móvil. Arrastrar DESDE el cuerpo pelearía con su propio scroll; concentrar el gesto en el
 * agarre evita el conflicto y comunica la affordance — se ve en iOS y Android.
 *
 * `prefers-reduced-motion` desactiva la animación de seguimiento: el cierre sigue
 * funcionando (depende del desplazamiento, no de la transición), pero visualmente la hoja
 * aparece o desaparece sin seguirla.
 */
function useSwipeCerrar(onCerrar: () => void, umbral = 80) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const agarre = ref.current;
        const sheet = agarre?.closest<HTMLElement>('.drawer');
        if (!agarre || !sheet) return;
        // Sólo en móvil: en escritorio el drawer es lateral y el gesto no tiene sentido.
        const mq = window.matchMedia?.('(max-width: 720px)');
        if (!mq?.matches) return;

        const reducido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        let startY = 0;
        let activo = false;

        function onDown(e: PointerEvent) {
            if (e.pointerType === 'mouse') return;
            startY = e.clientY;
            activo = true;
        }

        function onMove(e: PointerEvent) {
            if (!activo) return;
            const dy = e.clientY - startY;
            if (dy <= 0) { sheet!.style.transform = ''; return; }
            // El 0.6 suaviza: a 100px arrastrados, la hoja sigue 60. Sensación elástica
            // sin onTap-too-loose: medio close al rato de empezar.
            if (!reducido) sheet!.style.transform = `translateY(${Math.min(dy * 0.6, 200)}px)`;
        }

        function onUp(e: PointerEvent) {
            if (!activo) { activo = false; return; }
            activo = false;
            const dy = e.clientY - startY;
            sheet!.style.transform = '';
            // Umbral o flick: una sacudida rápida también cuenta, aunque no llegue a 80px.
            if (dy > umbral || (dy > 30 && Math.abs(e.clientY - startY) > 60)) {
                onCerrar();
            }
        }

        agarre.addEventListener('pointerdown', onDown);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            agarre.removeEventListener('pointerdown', onDown);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [onCerrar, umbral]);

    return ref;
}
