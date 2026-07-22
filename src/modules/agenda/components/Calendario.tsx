/**
 * El calendario. Es el producto, no una pantalla del producto.
 *
 * Día y Semana comparten rejilla. Mes tira el eje de horas. Móvil cambia de forma a agenda
 * vertical. Las tres decisiones están explicadas en sus componentes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    claveDia, claveHoy, diasDeSemana, etiquetaMes, etiquetaRangoSemana, etiquetaDiaLarga,
    inicioDe, finDe, reagendarVisita, listarCompromisos, consultarVisitas,
    aplicarFiltro, opcionesDeFiltro, tieneEquipo,
    type Avisar, type CompromisoCalendar, type Filtro
} from '@core/puente';

import { useCalendario, type ModoCalendario } from '../hooks/useCalendario';
import { useConexionCalendar } from '../hooks/useConexionCalendar';
import { useArrastreCreacion, useArrastreTarjeta } from '../hooks/useArrastre';
import { reflejarEnCalendar } from '@modules/visitas/services/calendarSync';
import { ComboFiltro } from '@shared/components/ComboFiltro';
import { calcularVentana } from '../services/ventana';
import { RejillaHoras } from './RejillaHoras';
import { VistaMes } from './VistaMes';
import { AgendaMovil } from './AgendaMovil';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Visita } from '@core/tipos';

export interface PropsCalendario {
    /** Cambia cuando algo de fuera modifica las visitas; fuerza releer el almacén. */
    version: number;
    onAbrirVisita: (id: string) => void;
    onCrearEn: (dia: string, inicio: string, fin: string | null) => void;
    onCambio: () => void;
    avisar: Avisar;
    /** Enlaza los controles que todavía viven en index.html. Ver `useControlesExternos`. */
    controles?: ControlesExternos;
    /** Publica los mandos de navegación para que `app.js` pueda seguir llamándolos. */
    publicarMandos?: (mandos: MandosNavegacion) => void;
}

export interface MandosNavegacion {
    irAHoy: () => void;
    irADia: (dia: string) => void;
    setModo: (m: ModoCalendario) => void;
}

export function Calendario({
    version, onAbrirVisita, onCrearEn, onCambio, avisar, controles, publicarMandos
}: PropsCalendario) {
    const { modo, movil, cursor, setModo, setCursor, irAHoy, irADia, mover } = useCalendario();

    /**
     * Las visitas visibles para quien mira: propias + equipo según jerarquía, igual que
     * "Mi día" y el resto del tablero — `consultarVisitas()` ya junta local + espejo de
     * Supabase y recorta por `alcance()`, así que lo que se guardó en Sheets/Supabase desde
     * otro dispositivo (o de la gente a cargo) aparece aquí también, no solo en este teléfono.
     *
     * Usar `repo.leerVisitas()` a secas (solo local) fue el bug original: un gerente veía a
     * su equipo en "Mi día" pero no en el Calendario, porque esa vista leía nada más lo
     * capturado en su propio dispositivo. Los BORRADORES tampoco cuentan aquí: una visita a
     * medio capturar todavía no ocupa ese hueco.
     */
    const todasVisibles = useMemo(
        () => consultarVisitas(),
        // `version` es la dependencia real: el almacén no avisa cuando cambia.
        [version]
    );

    /**
     * Filtro por educador/cliente — solo tiene sentido para quien ve a más de una persona.
     * Las opciones salen de TODO lo visible (antes de filtrar), igual que en `BarraFiltros`
     * del tablero: si salieran del resultado ya filtrado, el propio valor elegido sería la
     * única opción de su lista.
     */
    const [filtro, setFiltro] = useState<Pick<Filtro, 'educador' | 'cliente'>>({ educador: '', cliente: '' });
    const opciones = useMemo(() => opcionesDeFiltro(todasVisibles), [todasVisibles]);
    const visitas = useMemo(
        () => (filtro.educador || filtro.cliente ? aplicarFiltro(todasVisibles, filtro) : todasVisibles),
        [todasVisibles, filtro]
    );

    const porDia = useMemo(() => {
        const mapa = new Map<string, Visita[]>();
        for (const v of visitas) {
            if (!v.dia) continue;
            const lista = mapa.get(v.dia);
            if (lista) lista.push(v); else mapa.set(v.dia, [v]);
        }
        return mapa;
    }, [visitas]);

    const visitasDe = useCallback((clave: string) => porDia.get(clave) ?? [], [porDia]);

    const claves = useMemo(() => {
        if (modo === 'semana') return diasDeSemana(cursor).slice(0, 5);
        return [claveDia(cursor)];
    }, [modo, cursor]);

    // La ventana se recalcula por vista: una visita a las 06:00 tiene que verse, no dibujarse
    // fuera del lienzo y desaparecer.
    const ventana = useMemo(() => {
        const rangos = claves.flatMap(visitasDe).map(v => ({ inicio: inicioDe(v), fin: finDe(v) }));
        return calcularVentana(rangos, claves.includes(claveHoy()) ? new Date() : null);
    }, [claves, visitasDe]);

    /**
     * Lo que ya está en Google Calendar, agrupado por día. Silencioso si falla o si nadie lo
     * conectó: es un extra sobre la rejilla, no una condición para que el calendario funcione.
     */
    const { conectado: calendarConectado, conectar: conectarCalendarBtn, conectando, error: errorCalendar } = useConexionCalendar();
    const [compromisos, setCompromisos] = useState<Map<string, CompromisoCalendar[]>>(new Map());

    useEffect(() => {
        if (!calendarConectado || claves.length === 0) { setCompromisos(new Map()); return; }

        let vivo = true;
        const desde = new Date(`${claves[0]}T00:00:00`);
        const hasta = new Date(`${claves[claves.length - 1]}T23:59:59`);

        listarCompromisos(desde.toISOString(), hasta.toISOString())
            .then(lista => {
                if (!vivo) return;
                const mapa = new Map<string, CompromisoCalendar[]>();
                for (const c of lista) {
                    if (c.todoElDia) continue;
                    const clave = claveDia(new Date(c.inicio));
                    (mapa.get(clave) ?? mapa.set(clave, []).get(clave)!).push(c);
                }
                setCompromisos(mapa);
            })
            .catch((err) => {
                console.error('No se pudieron leer los compromisos de Calendar:', err);
                if (vivo) setCompromisos(new Map());
            });

        return () => { vivo = false; };
    }, [claves, calendarConectado]);

    const compromisosDe = useCallback(
        (clave: string) => compromisos.get(clave) ?? [],
        [compromisos]
    );

    const titulo = useMemo(() => {
        if (movil || modo === 'semana') return etiquetaRangoSemana(cursor);
        if (modo === 'mes') return etiquetaMes(cursor);
        return etiquetaDiaLarga(claveDia(cursor));
    }, [movil, modo, cursor]);

    /**
     * Reagendar SIEMPRE pide motivo: sin él no es un campo editable, es un rastro que se borra.
     *
     * `window.prompt` no sirve aquí: una PWA instalada (`display: standalone`) suele no mostrar
     * el diálogo nativo y `prompt()` devuelve `null` de inmediato, así que el arrastre se veía
     * pero el reagendado nunca se aplicaba. El motivo se pide con un modal propio en su lugar.
     */
    const [pendiente, setPendiente] = useState<{
        id: string;
        cambios: { dia?: string; hora_inicio?: string; hora_fin?: string };
        pregunta: string;
    } | null>(null);

    const pedirMotivoYReagendar = useCallback((
        id: string,
        cambios: { dia?: string; hora_inicio?: string; hora_fin?: string },
        pregunta: string
    ) => {
        setPendiente({ id, cambios, pregunta });
    }, []);

    const confirmarMotivo = useCallback((motivo: string) => {
        if (!pendiente) return;
        const { id, cambios } = pendiente;
        setPendiente(null);

        const r = reagendarVisita(id, {
            dia: cambios.dia ?? '',
            hora_inicio: cambios.hora_inicio ?? '',
            hora_fin: cambios.hora_fin ?? '',
            motivo
        });

        if (!r.ok) { avisar(r.error || 'No se pudo reagendar.', { estado: 'sin-registrar' }); return; }

        avisar('Visita reagendada. Queda el registro del cambio.', { estado: 'completa' });
        if (r.visita) {
            void reflejarEnCalendar(r.visita, (mutador) => repo.actualizarVisita(id, mutador), avisar);
        }
        onCambio();
    }, [pendiente, avisar, onCambio]);

    const alCrear = useArrastreCreacion({ ventana, onCrear: onCrearEn });
    const { alMover, alRedimensionar } = useArrastreTarjeta({
        ventana, onAbrir: onAbrirVisita, onReagendar: pedirMotivoYReagendar
    });

    useControlesExternos(controles, { titulo, modo, movil, setModo, irAHoy, mover });

    // Se publican en un efecto y no durante el render: llamar hacia fuera mientras React está
    // renderizando es justo lo que StrictMode existe para detectar.
    useEffect(() => {
        publicarMandos?.({ irAHoy, irADia, setModo });
    }, [publicarMandos, irAHoy, irADia, setModo]);

    const barraFiltros = tieneEquipo() && (
        <FiltrosCalendario filtro={filtro} opciones={opciones} onCambiar={setFiltro} />
    );

    if (movil) {
        return (
            <>
                {barraFiltros}
                <AgendaMovil
                    cursor={cursor}
                    visitasDe={visitasDe}
                    onElegirDia={setCursor}
                    onAbrir={onAbrirVisita}
                />
                {pendiente && (
                    <ModalMotivo
                        pregunta={pendiente.pregunta}
                        onCancelar={() => setPendiente(null)}
                        onConfirmar={confirmarMotivo}
                    />
                )}
            </>
        );
    }

    if (modo === 'mes') {
        return (
            <>
                {barraFiltros}
                <VistaMes cursor={cursor} visitasDe={visitasDe} onElegirDia={irADia} />
                {pendiente && (
                    <ModalMotivo
                        pregunta={pendiente.pregunta}
                        onCancelar={() => setPendiente(null)}
                        onConfirmar={confirmarMotivo}
                    />
                )}
            </>
        );
    }

    return (
        <>
            {barraFiltros}
            {!calendarConectado && (
                <div className="calendar-conectar-barra">
                    <span>
                        {conectando
                            ? 'Conectando con Google Calendar…'
                            : 'Conecta Google Calendar para ver tus juntas en la rejilla.'}
                    </span>
                    <button type="button" className="btn-txt" disabled={conectando} onClick={conectarCalendarBtn}>
                        Conectar Google Calendar
                    </button>
                    {errorCalendar && <span className="aviso">{errorCalendar}</span>}
                </div>
            )}
            <RejillaHoras
                claves={claves}
                clase={modo === 'semana' ? 'semana' : 'dia'}
                ventana={ventana}
                visitasDe={visitasDe}
                compromisosDe={compromisosDe}
                onPointerDownColumna={alCrear}
                onPointerDownCuerpo={alMover}
                onPointerDownManija={alRedimensionar}
                onAbrir={onAbrirVisita}
            />
            {pendiente && (
                <ModalMotivo
                    pregunta={pendiente.pregunta}
                    onCancelar={() => setPendiente(null)}
                    onConfirmar={confirmarMotivo}
                />
            )}
        </>
    );
}

// ---------- filtro por educador/cliente ----------

/**
 * Solo aparece si hay a quién filtrar: sin equipo a cargo, el educador es el único valor
 * posible y ofrecer el select sería un control decorativo.
 */
function FiltrosCalendario({ filtro, opciones, onCambiar }: {
    filtro: Pick<Filtro, 'educador' | 'cliente'>;
    opciones: ReturnType<typeof opcionesDeFiltro>;
    onCambiar: (f: Pick<Filtro, 'educador' | 'cliente'>) => void;
}) {
    const activos = (filtro.educador ? 1 : 0) + (filtro.cliente ? 1 : 0);

    return (
        <div className="filtros filtros-cal">
            <ComboFiltro
                etiqueta="Educador" opciones={opciones.educadores}
                valor={filtro.educador} onCambiar={(v) => onCambiar({ ...filtro, educador: v })}
            />
            <ComboFiltro
                etiqueta="Cliente" opciones={opciones.clientes}
                valor={filtro.cliente} onCambiar={(v) => onCambiar({ ...filtro, cliente: v })}
            />
            {activos > 0 && (
                <button type="button" className="btn-txt" onClick={() => onCambiar({ educador: '', cliente: '' })}>
                    Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                </button>
            )}
        </div>
    );
}

// ---------- modal del motivo de reagendado ----------

/** Reemplaza a `window.prompt`, que una PWA instalada no muestra. Motivo obligatorio. */
function ModalMotivo({ pregunta, onCancelar, onConfirmar }: {
    pregunta: string;
    onCancelar: () => void;
    onConfirmar: (motivo: string) => void;
}) {
    const [motivo, setMotivo] = useState('');

    useEffect(() => {
        function alEscape(e: KeyboardEvent) {
            if (e.key === 'Escape') onCancelar();
        }
        document.addEventListener('keydown', alEscape);
        return () => document.removeEventListener('keydown', alEscape);
    }, [onCancelar]);

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCancelar(); }}>
            <div className="modal-caja">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>Motivo del cambio</h3>
                        <span className="eyebrow">{pregunta}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCancelar}>✕</button>
                </div>
                <div className="modal-body">
                    <label className="campo">
                        <span className="campo-lbl">Motivo</span>
                        <input
                            type="text" className="inp" autoFocus
                            placeholder="¿Por qué se mueve esta visita?"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && motivo.trim()) onConfirmar(motivo.trim());
                            }}
                        />
                        <p className="ayuda">Obligatorio: queda en el historial</p>
                    </label>
                    <div className="modal-foot">
                        <span style={{ flex: 1 }} />
                        <button type="button" className="btn-txt" onClick={onCancelar}>Cancelar</button>
                        <button
                            type="button" className="btn btn-principal"
                            disabled={!motivo.trim()}
                            onClick={() => onConfirmar(motivo.trim())}
                        >
                            Reagendar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------- puente con los controles de index.html ----------

export interface ControlesExternos {
    /** El contenedor de fechas entero (flechas, título, «Hoy»). Solo tiene sentido en el calendario. */
    datenav: HTMLElement | null;
    titulo: HTMLElement | null;
    anterior: HTMLElement | null;
    siguiente: HTMLElement | null;
    hoy: HTMLElement | null;
    modos: HTMLElement | null;
}

/**
 * Enlaza la barra de navegación, que todavía vive en `index.html` fuera del árbol de React.
 *
 * Es un artefacto de la migración y se nota: React no debería estar poniendo `textContent` a
 * mano. Se hace así en vez de portar también el encabezado porque ese cambio arrastraría la
 * cabecera entera —sesión, contadores, botones de módulo— y esta iteración es del calendario.
 *
 * Cuando el shell se porte, este hook desaparece y los controles serán componentes normales.
 */
function useControlesExternos(
    controles: ControlesExternos | undefined,
    estado: {
        titulo: string;
        modo: ModoCalendario;
        movil: boolean;
        setModo: (m: ModoCalendario) => void;
        irAHoy: () => void;
        mover: (d: number) => void;
    }
) {
    const { titulo, modo, movil, setModo, irAHoy, mover } = estado;

    // Se muestra mientras el calendario esté montado. Que otro módulo la esconda al salir es
    // trabajo de `ContextoOculto`; esto solo la vuelve a mostrar al regresar.
    useEffect(() => {
        if (controles?.datenav) (controles.datenav as HTMLElement & { hidden: boolean }).hidden = false;
    }, [controles]);

    useEffect(() => {
        if (controles?.titulo) controles.titulo.textContent = titulo;
    }, [controles, titulo]);

    // El selector de modos no existe en móvil: ahí solo hay agenda, y ofrecer "Semana" sería
    // ofrecer una vista que no se puede dibujar.
    useEffect(() => {
        if (controles?.modos) (controles.modos as HTMLElement & { hidden: boolean }).hidden = movil;
    }, [controles, movil]);

    useEffect(() => {
        const botones = controles?.modos?.querySelectorAll<HTMLButtonElement>('button');
        botones?.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === modo)));
    }, [controles, modo]);

    useEffect(() => {
        if (!controles) return;

        const atras = () => mover(-1);
        const adelante = () => mover(1);

        controles.anterior?.addEventListener('click', atras);
        controles.siguiente?.addEventListener('click', adelante);
        controles.hoy?.addEventListener('click', irAHoy);

        const botones = [...(controles.modos?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const alElegirModo = botones.map(b => {
            const fn = () => setModo(b.dataset.modo as ModoCalendario);
            b.addEventListener('click', fn);
            return fn;
        });

        return () => {
            controles.anterior?.removeEventListener('click', atras);
            controles.siguiente?.removeEventListener('click', adelante);
            controles.hoy?.removeEventListener('click', irAHoy);
            botones.forEach((b, i) => b.removeEventListener('click', alElegirModo[i]!));
        };
    }, [controles, mover, irAHoy, setModo]);
}
