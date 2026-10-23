/**
 * Estrategias: Cliente × Sector × Grupo de Artículo.
 *
 * Qué plan se va a trabajar con cada cliente, en cada sector, para cada grupo de artículo
 * (la familia comercial del producto — "Descr. Grupo de Art." del tablero de Gerencia de
 * Marca). No tiene dueño: cualquier educador o gerente la escribe o la corrige, y es
 * justamente esa referencia compartida la que alimenta la planeación de las próximas visitas —
 * por eso vive como su propio módulo y no dentro de una visita en particular.
 *
 * Sin sello, sin "guardar visita" de por medio: se edita en el sitio, como un catálogo vivo.
 *
 * ── Consolidado por cliente ───────────────────────────────────────────────────────────
 *
 * Antes esto era una tabla plana, una fila por Cliente×Sector×Grupo — con varios sectores
 * activos a la vez, encontrar "qué le falta a este cliente" exigía leer toda la tabla. Ahora
 * se agrupa: un cliente por ficha, sus sectores dentro, y el detalle (grupo, etapa, proyecto)
 * al abrir cada fila — la fila sigue siendo la misma unidad de dato de siempre, solo cambia
 * cómo se navega hasta ella.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { estrategiasTrabajadas, actividadesDeSector, idsEstrategiasDe, estrategiaVigente, type ActividadDeEstrategia } from '../services/vinculo';
import { ModalDesenlace, BotonesDesenlace } from './ModalDesenlace';
import { moneda, aNumeroMoneda } from '../services/moneda';
import {
    sectoresACapturar, sectorCompleto, faltantes, consolidarPorSector, claveGrupo, GRUPO_VACIO, type DatosGrupo
} from '../services/capturaSector';
import {
    leerEstrategias, upsertEstrategia, nuevoId, cerrarEstrategia, cambiarValorMensual, esAdministrador, DESENLACES,
    descargarEstrategiasEquipo, sincronizarEstrategias, clientesEnMisZonas,
    sectores, gruposDeSector, buscarMateriales, archivarEstrategias, archivarProducto, moverEtapaEstatus, origenes, tiposEstrategia, descripcionTipoEstrategia,
    etapasEstrategia, estatusEstrategia, sesionActual, zonaDeCliente, grupoDeCliente, gruposDeCliente, fechaCorta, consultarVisitas, materialesDe, fechaHoraCorta as fechaHoraDdMmAaaa, type Avisar
} from '@core/puente';
import { Combo, filtrar } from '@shared/components/Combo';
import { abrirNuevaVisita, abrirVisita } from '@modules/visitas/montarDrawer';
import { Dato } from '@shared/components/Dato';
import type { Desenlace, Estrategia, EtapaHistorial, Visita } from '@core/tipos';
import { faltaEnEstrategia } from '../validators/requisitos';
import { rotuloEn, esVisibleEn } from '@shared/services/campos';
import { Esqueleto } from '@shared/components/Esqueleto';
import { EstadoVacio } from '@shared/components/EstadoVacio';

export function Estrategias({ avisar }: { avisar?: Avisar }) {
    const [version, setVersion] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [creando, setCreando] = useState(false);
    const [generando, setGenerando] = useState<string | null>(null); // cliente elegido
    const [detalleCliente, setDetalleCliente] = useState<string | null>(null);
    const [detalleEstrategia, setDetalleEstrategia] = useState<string | null>(null);

    const [fCliente, setFCliente] = useState('');
    const [fSector, setFSector] = useState('');
    const [fGrupo, setFGrupo] = useState('');
    const [fZona, setFZona] = useState('');
    const [fGrupoCliente, setFGrupoCliente] = useState('');
    const [fEducador, setFEducador] = useState('');
    const [fArchivadas, setFArchivadas] = useState(false);

    const estrategias = useMemo(() => leerEstrategias(), [version]);

    // Al entrar se refresca contra el equipo: es una referencia compartida, y quedarse con lo
    // que había en el teléfono ignoraría lo que un gerente acaba de escribir desde otro lado.
    useEffect(() => {
        let vivo = true;
        descargarEstrategiasEquipo().then(() => { if (vivo) { setCargando(false); setVersion(n => n + 1); } });
        return () => { vivo = false; };
    }, []);

    const refrescar = useCallback(() => setVersion(n => n + 1), []);

    // Las visitas se derivan del almacenamiento: si una se guarda o termina mientras esta vista está
    // abierta (o llega del equipo), hay que releer — si no, "Última visita" se queda en lo que había.
    useEffect(() => {
        window.addEventListener('pdt:visitas-guardadas', refrescar);
        window.addEventListener('focus', refrescar);
        return () => {
            window.removeEventListener('pdt:visitas-guardadas', refrescar);
            window.removeEventListener('focus', refrescar);
        };
    }, [refrescar]);
    // Se sube en segundo plano: no hacer esperar a quien está planeando por un POST.
    const subir = useCallback(() => { sincronizarEstrategias().then(refrescar).catch(() => {}); }, [refrescar]);

    const guardar = useCallback((datos: Estrategia) => {
        const sesion = sesionActual();
        upsertEstrategia({
            ...datos,
            estatus: datos.estatus || 'Pendiente',
            actualizado: new Date().toISOString(),
            actualizado_por: sesion?.nombre || '',
            actualizado_correo: sesion?.correo || '',
            // La línea de tiempo arranca con el estado inicial.
            etapas: [{
                etapa: datos.etapa, estatus: datos.estatus || 'Pendiente',
                momento: new Date().toISOString(), actor_nombre: sesion?.nombre, actor_correo: sesion?.correo
            }],
            sincronizado: false
        });
        refrescar();
        setCreando(false);
        avisar?.('Estrategia guardada.', { estado: 'completa' });
        subir();
    }, [refrescar, subir, avisar]);

    // Las estrategias no se borran: se archivan (y se pueden desarchivar).
    const archivar = useCallback((ids: string[], flag: boolean) => {
        const n = archivarEstrategias(ids, flag, sesionActual()?.nombre || '');
        refrescar();
        if (n) {
            avisar?.(flag
                ? `${n} estrategia${n === 1 ? '' : 's'} archivada${n === 1 ? '' : 's'}.`
                : `${n} estrategia${n === 1 ? '' : 's'} desarchivada${n === 1 ? '' : 's'}.`,
            { estado: 'programada' });
            subir();
        }
    }, [refrescar, subir, avisar]);

    // Finalizar / Cerrar: el comentario es obligatorio y la estrategia queda archivada.
    const terminar = useCallback((ids: string[], desenlace: Desenlace, comentario: string) => {
        const sesion = sesionActual();
        const actor = { correo: sesion?.correo, nombre: sesion?.nombre };
        const hechas = ids.filter(id => cerrarEstrategia(id, desenlace, comentario, actor)).length;
        refrescar();
        if (hechas) {
            const s = hechas === 1 ? '' : 's';
            const como = DESENLACES[desenlace].participio.toLowerCase();
            avisar?.(
                `${hechas} estrategia${s} ${como}${s} y archivada${s}: ya no aparece${hechas === 1 ? '' : 'n'} entre las vigentes.`,
                { estado: desenlace === 'finalizado' ? 'completa' : 'programada' }
            );
            subir();
        }
    }, [refrescar, subir, avisar]);

    const cambiarValor = useCallback((id: string, valor: number | undefined) => {
        const sesion = sesionActual();
        cambiarValorMensual(id, valor, { correo: sesion?.correo, nombre: sesion?.nombre });
        refrescar();
        avisar?.('Valor mensual actualizado.', { estado: 'completa' });
        subir();
    }, [refrescar, subir, avisar]);

    const archivarMaterial = useCallback((id: string, producto: string, flag: boolean) => {
        archivarProducto(id, producto, flag);
        refrescar();
        subir();
    }, [refrescar, subir]);

    // Lo único editable de una estrategia guardada: etapa y estatus (con nota opcional).
    const avanzar = useCallback((id: string, cambio: { etapa?: string; estatus?: string; nota?: string }) => {
        const sesion = sesionActual();
        moverEtapaEstatus(id, cambio, { correo: sesion?.correo, nombre: sesion?.nombre });
        refrescar();
        avisar?.('Avance registrado.', { estado: 'completa' });
        subir();
    }, [refrescar, subir, avisar]);

    const visitas = useMemo(() => consultarVisitas(), [version]);

    // Educador: el de las visitas vinculadas a la estrategia (la estrategia no tiene educador propio).
    const educadoresDeEstrategia = useMemo(() => {
        const mapa = new Map<string, Set<string>>();
        for (const v of visitas) {
            if (!v.educador) continue;
            for (const id of idsEstrategiasDe(v)) {
                mapa.set(id, (mapa.get(id) ?? new Set<string>()).add(v.educador));
            }
        }
        return mapa;
    }, [visitas]);
    const catalogoEducadores = useMemo(
        () => [...new Set(visitas.map(v => v.educador).filter((x): x is string => !!x))]
            .sort((x, y) => x.localeCompare(y, 'es')),
        [visitas]
    );
    const catalogoZonas = useMemo(
        () => [...new Set(estrategias.map(e => zonaDeCliente(e.cliente)).filter(Boolean))]
            .sort((x, y) => x.localeCompare(y, 'es', { numeric: true })),
        [estrategias]
    );
    const catalogoGruposCliente = useMemo(() => gruposDeCliente(), []);

    // Todos los filtros MENOS el de archivo: el resumen y los contadores cuentan lo archivado también.
    const coincidentes = useMemo(() => estrategias.filter(e =>
        (!fCliente || e.cliente.toLowerCase().includes(fCliente.toLowerCase())) &&
        (!fSector || e.sector === fSector) &&
        (!fGrupo || e.grupo_articulo === fGrupo) &&
        (!fZona || zonaDeCliente(e.cliente) === fZona) &&
        (!fGrupoCliente || grupoDeCliente(e.cliente) === fGrupoCliente) &&
        (!fEducador || educadoresDeEstrategia.get(e.id)?.has(fEducador))
    ).sort((x, y) => (y.actualizado || '').localeCompare(x.actualizado || '')),
    [estrategias, fCliente, fSector, fGrupo, fZona, fGrupoCliente, fEducador, educadoresDeEstrategia]);

    // Lo que se lista: lo archivado se oculta salvo que se pida verlo.
    const filtradas = useMemo(
        () => coincidentes.filter(e => fArchivadas || !e.archivada),
        [coincidentes, fArchivadas]
    );

    // Resumen por cliente x sector: estrategias, actividades ejecutadas y visitas que las hicieron.
    const resumen = useMemo(() => {
        const grupos = new Map<string, Estrategia[]>();
        for (const e of coincidentes) {
            const k = e.cliente + '|' + (e.sector || 'Sin sector');
            grupos.set(k, [...(grupos.get(k) || []), e]);
        }
        return [...grupos.values()].map(lista => {
            const cliente = lista[0]!.cliente;
            const sector = lista[0]!.sector || 'Sin sector';
            const acts = actividadesDeSector(visitas, cliente, sector, lista);
            return {
                cliente, sector, estrategias: lista.length, actividades: acts.length,
                visitas: new Set(acts.map(x => x.visita.id)).size
            };
        }).sort((x, y) => x.cliente.localeCompare(y.cliente, 'es') || x.sector.localeCompare(y.sector, 'es'));
    }, [coincidentes, visitas]);

    /** Un grupo por cliente (orden por más reciente): cada uno es una tarjeta. */
    const porCliente = useMemo(() => {
        const mapa = new Map<string, { cliente: string; filas: Estrategia[]; ultima: string }>();
        for (const e of filtradas) {
            const clave = e.cliente.toLowerCase();
            const previo = mapa.get(clave);
            if (previo) {
                previo.filas.push(e);
                if ((e.actualizado || '') > previo.ultima) previo.ultima = e.actualizado || '';
            } else {
                mapa.set(clave, { cliente: e.cliente, filas: [e], ultima: e.actualizado || '' });
            }
        }
        return [...mapa.values()].sort((a, b) => b.ultima.localeCompare(a.ultima));
    }, [filtradas]);

    /**
     * Cuántas visitas ya se generaron para cada estrategia, y la más reciente — el avance real
     * hacia el objetivo, no solo el plan escrito. Se deriva de `consultarVisitas()` (nunca se
     * guarda un contador aparte): la fuente de verdad es la propia visita vinculada
     * (`id_estrategia`), y un contador guardado se desalinearía en cuanto alguien reagendara o
     * cancelara sin que nadie se acordara de actualizarlo.
     */
    const avancePorEstrategia = useMemo(() => {
        const mapa = new Map<string, { visitas: number; ultima: string }>();
        const todas = leerEstrategias();
        // Grupo de artículo de un material capturado, según el catálogo del sector: distingue
        // qué estrategia se trabajó cuando un mismo sector tiene varias (una por grupo).
        const grupoDeMaterial = (sector: string, material: string) =>
            materialesDe(sector).find(m => m.material === material)?.grupo_articulo;

        const hoy = fechaLocalISO();
        for (const v of consultarVisitas()) {
            // Una visita suma avance solo a las estrategias que se TRABAJARON (ver
            // `estrategiasTrabajadas`): marcar tres y trabajar dos avanza dos.
            for (const id of estrategiasTrabajadas(v, todas, grupoDeMaterial)) {
                const previo = mapa.get(id) ?? { visitas: 0, ultima: '' };
                previo.visitas++;
                mapa.set(id, previo);
            }
            // La "última" visita, en cambio, es la más reciente que ya ocurrió y está VINCULADA, se
            // haya capturado actividad o no: una visita recién terminada no puede desaparecer de aquí.
            if (v.estado === 'cancelada' || !v.dia || v.dia > hoy) continue;
            for (const id of idsEstrategiasDe(v)) {
                const previo = mapa.get(id) ?? { visitas: 0, ultima: '' };
                if (v.dia > previo.ultima) previo.ultima = v.dia;
                mapa.set(id, previo);
            }
        }
        return mapa;
    }, [version]);

    const catalogoSectores = useMemo(() => sectores(), []);
    // Con un sector elegido, solo los grupos que de verdad se trabajan ahí (ver
    // `gruposDeSector` en catalogos.js) — sin sector, el catálogo completo.
    const catalogoGrupos = useMemo(() => gruposDeSector(fSector), [fSector]);
    // Solo los clientes de MIS zonas — sin ninguna asignada, ya cae al catálogo completo.
    const catalogoClientes = useMemo(() => clientesEnMisZonas(), []);

    // Cambiar de sector puede dejar el grupo elegido fuera de la lista nueva — mantenerlo
    // filtraría por algo que ya no aparece en el select, silencioso y confuso.
    useEffect(() => {
        if (fGrupo && !catalogoGrupos.includes(fGrupo)) setFGrupo('');
    }, [catalogoGrupos, fGrupo]);
    const opcionesCliente = useCallback(
        (q: string) => filtrar(catalogoClientes, q), [catalogoClientes]
    );

    const estrategiaAbierta = detalleEstrategia ? estrategias.find(e => e.id === detalleEstrategia) : undefined;

    return (
        <div className="vista vista-estrategias">
            <header className="vista-head">
                <h2>Estrategias</h2>
                <p className="eyebrow">Cliente × Sector × Grupo de artículo — el plan que guía las próximas visitas</p>
            </header>

            <div className="filtros">
                <Combo
                    etiqueta="Cliente"
                    valor={fCliente}
                    placeholder="Busca N° o razón social…"
                    opciones={opcionesCliente}
                    total={catalogoClientes.length}
                    onElegir={setFCliente}
                    onEscribir={setFCliente}
                />
                <label className="filtro">
                    <span className="campo-lbl">Sector</span>
                    <select className="inp" value={fSector} onChange={(e) => setFSector(e.target.value)}>
                        <option value="">Todos</option>
                        {catalogoSectores.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Grupo de artículo</span>
                    <select className="inp" value={fGrupo} onChange={(e) => setFGrupo(e.target.value)}>
                        <option value="">Todos</option>
                        {catalogoGrupos.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                </label>

                <label className="filtro">
                    <span className="campo-lbl">Zona / Gpo. vendedor</span>
                    <select className="inp" value={fZona} onChange={(e) => setFZona(e.target.value)}>
                        <option value="">Todas</option>
                        {catalogoZonas.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Grupo de cliente</span>
                    <select className="inp" value={fGrupoCliente} onChange={(e) => setFGrupoCliente(e.target.value)}>
                        <option value="">Todos</option>
                        {catalogoGruposCliente.map(g => <option key={g} value={g}>{g}</option>)}
                    </select>
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Educador</span>
                    <select className="inp" value={fEducador} onChange={(e) => setFEducador(e.target.value)}>
                        <option value="">Todos</option>
                        {catalogoEducadores.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <label className="filtro filtro-check">
                    <input type="checkbox" checked={fArchivadas} onChange={(e) => setFArchivadas(e.target.checked)} />
                    <span className="campo-lbl">Mostrar archivadas</span>
                </label>

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {porCliente.length} cliente{porCliente.length === 1 ? '' : 's'} ·{' '}
                        {filtradas.length} estrategia{filtradas.length === 1 ? '' : 's'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn btn-principal" onClick={() => setCreando(true)}>
                        + Nueva estrategia
                    </button>
                </div>
            </div>

            {cargando && estrategias.length === 0 ? (
                <Esqueleto />
            ) : porCliente.length === 0 ? (
                <EstadoVacio titulo="Nada que mostrar todavía" texto={<>Agrega la primera estrategia para este cliente y sector.</>} />
            ) : (
                <>
                <ResumenClienteSector filas={resumen} />
                <div className="tarjetas-clientes">
                    {porCliente.map(grupo => (
                        <TarjetaCliente
                            key={grupo.cliente}
                            cliente={grupo.cliente}
                            visibles={grupo.filas}
                            todas={estrategias.filter(e => e.cliente === grupo.cliente)}
                            visitas={visitas}
                            onAbrir={() => setDetalleCliente(grupo.cliente)}
                            onGenerarVisita={() => setGenerando(grupo.cliente)}
                        />
                    ))}
                </div>
                </>
            )}

            {creando && (
                <FormularioEstrategia
                    estrategia={null}
                    sectores={catalogoSectores}
                    clientes={catalogoClientes}
                    onGuardar={guardar}
                    onCerrar={() => setCreando(false)}
                />
            )}

            {detalleCliente && (
                <DetalleCliente
                    cliente={detalleCliente}
                    estrategias={estrategias.filter(e => e.cliente === detalleCliente)}
                    visitas={visitas}
                    avancePorEstrategia={avancePorEstrategia}
                    onCerrar={() => setDetalleCliente(null)}
                    onAbrirEstrategia={(id) => setDetalleEstrategia(id)}
                    onGenerarVisita={() => setGenerando(detalleCliente)}
                    onArchivar={archivar}
                    onTerminar={terminar}
                />
            )}

            {estrategiaAbierta && (
                <DetalleEstrategia
                    estrategia={estrategiaAbierta}
                    visitasVinculadas={avancePorEstrategia.get(estrategiaAbierta.id)?.visitas ?? 0}
                    onCerrar={() => setDetalleEstrategia(null)}
                    onAvanzar={(cambio) => avanzar(estrategiaAbierta.id, cambio)}
                    onArchivar={(flag) => archivar([estrategiaAbierta.id], flag)}
                    onTerminar={(d, comentario) => terminar([estrategiaAbierta.id], d, comentario)}
                    onCambiarValor={(valor) => cambiarValor(estrategiaAbierta.id, valor)}
                    onArchivarProducto={(p, flag) => archivarMaterial(estrategiaAbierta.id, p, flag)}
                />
            )}

            {generando && (
                <GenerarVisita
                    cliente={generando}
                    estrategias={estrategias.filter(e => e.cliente === generando && estrategiaVigente(e))}
                    onCerrar={() => setGenerando(null)}
                    onGenerada={() => { setGenerando(null); avisar?.('Visita generada desde la estrategia.', { estado: 'programada' }); }}
                />
            )}
        </div>
    );
}

/** Pide confirmación en línea (sin `confirm()` del navegador, que bloquea la página). */
function BotonConfirmar({ etiqueta, pregunta, onConfirmar, clase = 'btn-txt' }: {
    etiqueta: string;
    pregunta: string;
    onConfirmar: () => void;
    clase?: string;
}) {
    const [pidiendo, setPidiendo] = useState(false);
    if (!pidiendo) {
        return (
            <button
                type="button" className={clase}
                onClick={(ev) => { ev.stopPropagation(); setPidiendo(true); }}
            >
                {etiqueta}
            </button>
        );
    }
    return (
        <span className="confirmar-inline" onClick={(ev) => ev.stopPropagation()}>
            <span className="ayuda">{pregunta}</span>
            <button type="button" className="btn-txt peligro" onClick={() => { setPidiendo(false); onConfirmar(); }}>
                Sí
            </button>
            <button type="button" className="btn-txt" onClick={() => setPidiendo(false)}>No</button>
        </span>
    );
}

/** Actividades (guardadas) de un cliente en TODOS sus sectores, sin repetir las compartidas. */
function actividadesDelCliente(visitas: Visita[], cliente: string, estrategias: Estrategia[]) {
    const sectoresDe = [...new Set(estrategias.map(e => e.sector || 'Sin sector'))];
    const vistas = new Set<string>();
    for (const sector of sectoresDe) {
        const delSector = estrategias.filter(e => (e.sector || 'Sin sector') === sector);
        for (const { actividad, visita } of actividadesDeSector(visitas, cliente, sector, delSector)) {
            vistas.add(`${visita.id}|${actividad.id}`);
        }
    }
    return vistas.size;
}

/** Tarjeta resumida de un cliente; al hacer clic abre el desglose completo. */
function TarjetaCliente({ cliente, visibles, todas, visitas, onAbrir, onGenerarVisita }: {
    cliente: string;
    visibles: Estrategia[];
    todas: Estrategia[];
    visitas: Visita[];
    onAbrir: () => void;
    onGenerarVisita: () => void;
}) {
    const zona = zonaDeCliente(cliente);
    const grupoCli = grupoDeCliente(cliente);
    const sectoresN = new Set(visibles.map(e => e.sector || 'Sin sector')).size;
    const archivadas = todas.filter(e => e.archivada).length;
    // El total suma TODO el cliente: lo archivado también cuenta.
    const totalActividades = useMemo(() => actividadesDelCliente(visitas, cliente, todas), [visitas, cliente, todas]);
    const etapas = useMemo(
        () => [...new Set(visibles.filter(e => !e.archivada).map(e => e.etapa).filter((x): x is string => !!x))],
        [visibles]
    );

    return (
        <div
            className="tarjeta-cliente" role="button" tabIndex={0}
            aria-label={`Ver el detalle de ${cliente}`}
            onClick={onAbrir}
            onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onAbrir(); } }}
        >
            <div className="tarjeta-cliente-cab">
                <span className="ficha-cliente-nombre">{cliente}</span>
                {(zona || grupoCli) && (
                    <span className="ayuda">{[zona && `Zona ${zona}`, grupoCli].filter(Boolean).join(' · ')}</span>
                )}
            </div>
            <div className="tarjeta-cliente-cifras">
                <span><b className="mono">{sectoresN}</b> sector{sectoresN === 1 ? '' : 'es'}</span>
                <span><b className="mono">{todas.length - archivadas}</b> estrategia{todas.length - archivadas === 1 ? '' : 's'}</span>
                {archivadas > 0 && <span><b className="mono">{archivadas}</b> archivada{archivadas === 1 ? '' : 's'}</span>}
                <span title="Suma de todas sus estrategias, archivadas o no">
                    <b className="mono">{totalActividades}</b> actividad{totalActividades === 1 ? '' : 'es'}
                </span>
            </div>
            {etapas.length > 0 && (
                <span className="chips-etapas">
                    {etapas.map(et => <span className="pill neutro" key={et}>{et}</span>)}
                </span>
            )}
            <div className="tarjeta-cliente-pie">
                <button
                    type="button" className="btn-txt"
                    onClick={(ev) => { ev.stopPropagation(); onGenerarVisita(); }}
                >
                    Generar visita
                </button>
            </div>
        </div>
    );
}

/** Desglose completo de un cliente: sectores, estrategias, actividades y visitas. */
function DetalleCliente({
    cliente, estrategias, visitas, avancePorEstrategia,
    onCerrar, onAbrirEstrategia, onGenerarVisita, onArchivar, onTerminar
}: {
    cliente: string;
    estrategias: Estrategia[];
    visitas: Visita[];
    avancePorEstrategia: Map<string, { visitas: number; ultima: string }>;
    onCerrar: () => void;
    onAbrirEstrategia: (id: string) => void;
    onGenerarVisita: () => void;
    onArchivar: (ids: string[], archivar: boolean) => void;
    onTerminar: (ids: string[], desenlace: Desenlace, comentario: string) => void;
}) {
    // Finalizar/Cerrar pide el comentario antes de archivar: aquí se guarda a qué se aplica.
    const [terminando, setTerminando] = useState<{ ids: string[]; desenlace: Desenlace; titulo: string } | null>(null);
    const [sectoresAbiertos, setSectoresAbiertos] = useState<Set<string>>(new Set());
    const [actividadesAbiertas, setActividadesAbiertas] = useState<Set<string>>(new Set());
    const alternar = (set: Set<string>, poner: (n: Set<string>) => void, k: string) => {
        const c = new Set(set);
        if (c.has(k)) c.delete(k); else c.add(k);
        poner(c);
    };

    const sectoresDelCliente = useMemo(() => {
        const mapa = new Map<string, Estrategia[]>();
        for (const e of estrategias) {
            const clave = e.sector || 'Sin sector';
            mapa.set(clave, [...(mapa.get(clave) || []), e]);
        }
        return [...mapa.entries()];
    }, [estrategias]);

    const totalActividades = useMemo(
        () => actividadesDelCliente(visitas, cliente, estrategias), [visitas, cliente, estrategias]
    );
    const activas = estrategias.filter(e => !e.archivada);
    const idsEstr = new Set(estrategias.map(e => e.id));
    const visitasVinculadas = useMemo(
        () => visitas.filter(v => v.cliente === cliente && idsEstrategiasDe(v).some(id => idsEstr.has(id)))
            .sort((a, b) => (b.dia || '').localeCompare(a.dia || '')),
        [visitas, cliente, estrategias]
    );

    // Seguimiento (arriba, junto al cliente): la última visita y la próxima programada. "Última" es la
    // de fecha más reciente que ya ocurrió (hoy incluido), no la que se creó al último: una visita
    // agendada a futuro no es la última, y una creada antes pero hecha hoy sí lo es.
    const hoy = fechaLocalISO();
    const ultimaGenerada = [...visitasVinculadas]
        .filter(v => v.estado !== 'cancelada' && !!v.dia && v.dia <= hoy)
        .sort((a, b) => (b.dia || '').localeCompare(a.dia || '') || (b.hora_inicio || '').localeCompare(a.hora_inicio || ''))[0];
    const proximaProgramada = visitasVinculadas
        .filter(v => v.estado === 'programada' && (v.dia || '') >= hoy)
        .sort((a, b) => (a.dia || '').localeCompare(b.dia || ''))[0];

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-detalle" role="dialog" aria-label={`Detalle de ${cliente}`}>
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{cliente}</h3>
                        <span className="eyebrow">
                            {sectoresDelCliente.length} sector{sectoresDelCliente.length === 1 ? '' : 'es'} ·{' '}
                            {estrategias.length} estrategia{estrategias.length === 1 ? '' : 's'}
                            {estrategias.length !== activas.length ? ` (${estrategias.length - activas.length} archivadas)` : ''} ·{' '}
                            {totalActividades} actividad{totalActividades === 1 ? '' : 'es'} · {visitasVinculadas.length} visita{visitasVinculadas.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
                </div>

                <div className="modal-body">
                    <div className="seguimiento-visitas">
                        <span className="campo-lbl">Seguimiento</span>
                        <div className="seguimiento-visitas-items">
                            <ResumenVisita titulo="Última visita" visita={ultimaGenerada} />
                            <ResumenVisita titulo="Próxima programada" visita={proximaProgramada} />
                        </div>
                    </div>

                    <div className="acciones-detalle">
                        <button type="button" className="btn" onClick={onGenerarVisita}>Generar visita</button>
                        <span style={{ flex: 1 }} />
                        {activas.length === 0 && estrategias.length > 0 && (
                            <button type="button" className="btn-txt" onClick={() => onArchivar(estrategias.map(e => e.id), false)}>
                                Desarchivar cliente
                            </button>
                        )}
                    </div>

                    {sectoresDelCliente.map(([sector, filas]) => {
                        const actividades = actividadesDeSector(visitas, cliente, sector, filas);
                        const abiertoSector = sectoresAbiertos.has(sector);
                        const activasSector = filas.filter(e => !e.archivada);
                        const idsSector = new Set(filas.map(e => e.id));
                        const visitasSector = visitasVinculadas.filter(v =>
                            idsEstrategiasDe(v).some(id => idsSector.has(id)) &&
                            (v.sectores || []).some(x => x.nombre === sector)
                        );
                        return (
                            <section className="ficha-sector" key={sector}>
                                <div className="admin-fila">
                                    <button
                                        type="button" className="btn-txt campo-lbl" aria-expanded={abiertoSector}
                                        onClick={() => alternar(sectoresAbiertos, setSectoresAbiertos, sector)}
                                    >
                                        {abiertoSector ? '▾' : '▸'} {sector} · {filas.length}{' '}
                                        <span className="pill neutro" title="Actividades ejecutadas en este sector (incluye archivadas)">
                                            {actividades.length} actividad{actividades.length === 1 ? '' : 'es'}
                                        </span>
                                    </button>
                                    <span style={{ flex: 1 }} />
                                    {activasSector.length > 0 && (
                                        <BotonesDesenlace
                                            onElegir={(d) => setTerminando({
                                                ids: activasSector.map(e => e.id), desenlace: d,
                                                titulo: `${cliente} · ${sector} (${activasSector.length} estrategia${activasSector.length === 1 ? '' : 's'})`
                                            })}
                                        />
                                    )}
                                </div>
                                {abiertoSector && (
                                    <ListaActividades
                                        actividades={actividades}
                                        abiertas={actividadesAbiertas}
                                        onAlternar={(id) => alternar(actividadesAbiertas, setActividadesAbiertas, id)}
                                    />
                                )}
                                <div className="tabla-scroll">
                                    <table className="tabla">
                                        <thead>
                                            <tr>
                                                <th>Grupo de artículo</th>
                                                <th>Estrategia</th>
                                                <th>Descripción</th>
                                                <th>Etapa</th>
                                                <th>Estatus</th>
                                                <th>Visitas</th>
                                                <th></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filas.map(e => {
                                                const avance = avancePorEstrategia.get(e.id);
                                                return (
                                                    <tr
                                                        key={e.id}
                                                        className={'fila-clicable' + (e.archivada ? ' es-archivada' : '')}
                                                        onClick={() => onAbrirEstrategia(e.id)}
                                                    >
                                                        <td>
                                                            {e.grupo_articulo || '—'}
                                                            {e.archivada && (
                                                                <span
                                                                    className="pill neutro" title={e.desenlace_comentario || undefined}
                                                                >
                                                                    {' '}{e.desenlace ? DESENLACES[e.desenlace].participio : 'Archivada'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td>{e.tipo_estrategia || '—'}</td>
                                                        <td className="col-descripcion">
                                                            {e.descripcion
                                                                || (e.tipo_estrategia && (
                                                                    <span className="ayuda">{descripcionTipoEstrategia(e.tipo_estrategia)}</span>
                                                                ))
                                                                || '—'}
                                                        </td>
                                                        <td>{e.etapa ? <span className="pill neutro">{e.etapa}</span> : '—'}</td>
                                                        <td>{e.estatus || '—'}</td>
                                                        <td className="mono">
                                                            {avance
                                                                ? `${avance.visitas}${avance.ultima ? ` · última ${fechaCorta(avance.ultima)}` : ''}`
                                                                : 'Ninguna aún'}
                                                        </td>
                                                        <td>
                                                            {e.archivada ? (
                                                                <button
                                                                    type="button" className="btn-txt"
                                                                    onClick={(ev) => { ev.stopPropagation(); onArchivar([e.id], false); }}
                                                                >
                                                                    Desarchivar
                                                                </button>
                                                            ) : (
                                                                <BotonesDesenlace
                                                                    onElegir={(d) => setTerminando({
                                                                        ids: [e.id], desenlace: d,
                                                                        titulo: [e.tipo_estrategia, e.sector, e.grupo_articulo].filter(Boolean).join(' · ') || cliente
                                                                    })}
                                                                />
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Colapsada de inicio; con más de 5 visitas la lista se recorre con scroll. */}
                                <details className="visitas-sector">
                                    <summary className="campo-lbl">Visitas vinculadas · {visitasSector.length}</summary>
                                    {visitasSector.length === 0 ? (
                                        <p className="ayuda">Todavía no hay visitas generadas para este sector.</p>
                                    ) : (
                                        <ul className="lista-actividades lista-visitas-scroll">
                                            {visitasSector.map(v => (
                                                <li key={v.id}>
                                                    <span>
                                                        {fechaCorta(v.dia)} · {v.educador || 'sin educador'} · {v.estado || 'sin estado'}
                                                    </span>{' '}
                                                    <button type="button" className="btn-txt" onClick={() => abrirVisita(v.id)}>
                                                        Abrir visita
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </details>
                            </section>
                        );
                    })}
                </div>
            </div>

            {terminando && (
                <ModalDesenlace
                    desenlace={terminando.desenlace}
                    titulo={terminando.titulo}
                    onCancelar={() => setTerminando(null)}
                    onConfirmar={(comentario) => {
                        onTerminar(terminando.ids, terminando.desenlace, comentario);
                        setTerminando(null);
                    }}
                />
            )}
        </div>
    );
}

/** Una visita para el seguimiento del encabezado: fecha, educador, estado y acceso directo. */
function ResumenVisita({ titulo, visita }: { titulo: string; visita?: Visita }) {
    return (
        <div className="seguimiento-visita">
            <span className="dato-lbl">{titulo}</span>
            {visita ? (
                <span>
                    {fechaCorta(visita.dia)} · {visita.educador || 'sin educador'} · {visita.estado || 'sin estado'}{' '}
                    <button type="button" className="btn-txt" onClick={() => abrirVisita(visita.id)}>Abrir</button>
                </span>
            ) : (
                <span className="ayuda">Ninguna</span>
            )}
        </div>
    );
}

/**
 * Una estrategia guardada es de SOLO LECTURA. Lo único que se mueve es la etapa y el estatus,
 * y cada movimiento queda en la línea de tiempo. Para corregir un error de captura se archiva
 * y se crea otra: lo que ya ocurrió no se reescribe.
 */
function DetalleEstrategia({ estrategia: e, visitasVinculadas, onCerrar, onAvanzar, onArchivar, onTerminar, onCambiarValor, onArchivarProducto }: {
    estrategia: Estrategia;
    visitasVinculadas: number;
    onCerrar: () => void;
    onAvanzar: (cambio: { etapa?: string; estatus?: string; nota?: string }) => void;
    onArchivar: (archivar: boolean) => void;
    onTerminar: (desenlace: Desenlace, comentario: string) => void;
    onCambiarValor: (valor: number | undefined) => void;
    onArchivarProducto: (producto: string, archivar: boolean) => void;
}) {
    const [terminando, setTerminando] = useState<Desenlace | null>(null);
    // Editar el valor es sensible: se escribe primero y se confirma en un modal aparte.
    const [editandoValor, setEditandoValor] = useState(false);
    const [valorTexto, setValorTexto] = useState('');
    const [confirmandoValor, setConfirmandoValor] = useState(false);
    const puedeEditarValor = useMemo(() => esAdministrador(), []);
    const catalogoEtapas = useMemo(() => etapasEstrategia(), []);
    const catalogoEstatus = useMemo(() => estatusEstrategia(), []);
    const [etapa, setEtapa] = useState(e.etapa || '');
    const [estatus, setEstatus] = useState(e.estatus || 'Pendiente');
    const [nota, setNota] = useState('');

    // Tras registrar un avance la estrategia cambia: el panel parte de lo nuevo.
    useEffect(() => { setEtapa(e.etapa || ''); setEstatus(e.estatus || 'Pendiente'); setNota(''); }, [e.etapa, e.estatus]);

    const hayCambio = etapa !== (e.etapa || '') || estatus !== (e.estatus || 'Pendiente');
    const archivados = new Set(e.productos_archivados || []);
    const ayudaTipo = e.tipo_estrategia ? descripcionTipoEstrategia(e.tipo_estrategia) : '';

    return (
        <div className="modal" onClick={(ev) => { if (ev.target === ev.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-actividad" role="dialog" aria-label="Detalle de la estrategia">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>
                            {e.tipo_estrategia || 'Estrategia'}
                            {e.archivada ? ` · ${e.desenlace ? DESENLACES[e.desenlace].participio : 'Archivada'}` : ''}
                        </h3>
                        <span className="eyebrow">{e.cliente} · Solo lectura</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
                </div>

                <div className="modal-body">
                    <div className="datos">
                        <Dato etiqueta="Cliente" valor={e.cliente} />
                        <Dato etiqueta="Estrategia" valor={e.tipo_estrategia} />
                        {ayudaTipo && <p className="ayuda">{ayudaTipo}</p>}
                        <Dato etiqueta="Descripción" valor={e.descripcion} />
                        <Dato etiqueta="Sector" valor={e.sector} />
                        <Dato etiqueta="Grupo de artículo" valor={e.grupo_articulo} />
                        <Dato etiqueta="Proyecto / objetivo" valor={e.proyecto} />
                        <Dato etiqueta="Observaciones" valor={e.observaciones} />
                        <Dato etiqueta="Valor mensual" valor={e.valor_mensual === undefined ? '' : moneda(e.valor_mensual)} />
                        <Dato etiqueta="Visitas" valor={String(visitasVinculadas)} />
                        <Dato
                            etiqueta="Actualizó"
                            valor={[e.actualizado_por, fechaHoraCorta(e.actualizado)].filter(Boolean).join(' · ')}
                        />
                        {e.desenlace && (
                            <Dato
                                etiqueta={DESENLACES[e.desenlace].participio}
                                valor={[e.desenlace_comentario, e.desenlace_por, fechaHoraCorta(e.desenlace_en)].filter(Boolean).join(' · ')}
                            />
                        )}
                    </div>

                    {puedeEditarValor && !editandoValor && (
                        <div>
                            <button
                                type="button" className="btn-txt"
                                onClick={() => { setValorTexto(e.valor_mensual === undefined ? '' : String(e.valor_mensual)); setEditandoValor(true); }}
                            >
                                Editar valor mensual
                            </button>
                        </div>
                    )}
                    {editandoValor && (
                        <div className="campo">
                            <span className="campo-lbl">Valor mensual ($)</span>
                            <div className="admin-fila">
                                <input
                                    type="text" inputMode="decimal" className="inp" placeholder="$0.00" autoFocus
                                    value={valorTexto} onChange={(ev) => setValorTexto(ev.target.value)}
                                />
                                <button type="button" className="btn-txt" onClick={() => setEditandoValor(false)}>Cancelar</button>
                                <button
                                    type="button" className="btn btn-principal"
                                    disabled={aNumeroMoneda(valorTexto) === e.valor_mensual}
                                    onClick={() => setConfirmandoValor(true)}
                                >
                                    Guardar
                                </button>
                            </div>
                        </div>
                    )}

                    {(e.productos || []).length > 0 && (
                        <div className="campo">
                            <span className="campo-lbl">Productos</span>
                            <div className="chips">
                                {(e.productos || []).map(p => {
                                    const arch = archivados.has(p);
                                    return (
                                        <span className={'pill neutro' + (arch ? ' es-archivado' : '')} key={p}>
                                            {p}
                                            <button
                                                type="button" className="pill-quitar"
                                                aria-label={arch ? `Desarchivar ${p}` : `Archivar ${p}`}
                                                title={arch ? 'Desarchivar' : 'Archivar este producto'}
                                                onClick={() => onArchivarProducto(p, !arch)}
                                            >
                                                {arch ? '↺' : '🗄'}
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="campo panel-avance">
                        <span className="campo-lbl">Registrar avance</span>
                        {e.archivada ? (
                            <p className="ayuda">Desarchiva la estrategia para registrar avance.</p>
                        ) : (
                            <>
                                <div className="grid-2">
                                    <label className="campo">
                                        <span className="campo-lbl">Etapa</span>
                                        <select className="inp" value={etapa} onChange={(ev) => setEtapa(ev.target.value)}>
                                            <option value="">Sin definir</option>
                                            {catalogoEtapas.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </label>
                                    <label className="campo">
                                        <span className="campo-lbl">Estatus</span>
                                        <select className="inp" value={estatus} onChange={(ev) => setEstatus(ev.target.value)}>
                                            {catalogoEstatus.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </label>
                                </div>
                                <input
                                    type="text" className="inp" placeholder="Nota del avance (opcional)"
                                    value={nota} onChange={(ev) => setNota(ev.target.value)}
                                />
                                <div>
                                    <button
                                        type="button" className="btn btn-principal" disabled={!hayCambio}
                                        onClick={() => onAvanzar({ etapa, estatus, nota })}
                                    >
                                        Registrar avance
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <LineaTiempoEtapas etapas={e.etapas} />

                    <div className="modal-foot">
                        <span style={{ flex: 1 }} />
                        {e.archivada ? (
                            <button type="button" className="btn-txt" onClick={() => onArchivar(false)}>Desarchivar</button>
                        ) : (
                            <BotonesDesenlace clase="btn" onElegir={setTerminando} />
                        )}
                    </div>
                </div>
            </div>

            {terminando && (
                <ModalDesenlace
                    desenlace={terminando}
                    titulo={[e.tipo_estrategia, e.sector, e.grupo_articulo].filter(Boolean).join(' · ') || e.cliente}
                    onCancelar={() => setTerminando(null)}
                    onConfirmar={(comentario) => { onTerminar(terminando, comentario); setTerminando(null); }}
                />
            )}

            {confirmandoValor && (
                <div className="modal" onClick={(ev) => { if (ev.target === ev.currentTarget) setConfirmandoValor(false); }}>
                    <div className="modal-caja" role="alertdialog" aria-label="Confirmar cambio de valor">
                        <div className="modal-body">
                            <h3>¿Estás seguro de modificar este valor?</h3>
                            <p className="ayuda">
                                {moneda(e.valor_mensual)} → {moneda(aNumeroMoneda(valorTexto))}. El cambio queda en la bitácora.
                            </p>
                            <div className="modal-foot">
                                <span style={{ flex: 1 }} />
                                <button type="button" className="btn-txt" onClick={() => setConfirmandoValor(false)}>No, volver</button>
                                <button
                                    type="button" className="btn btn-principal"
                                    onClick={() => {
                                        onCambiarValor(aNumeroMoneda(valorTexto));
                                        setConfirmandoValor(false);
                                        setEditandoValor(false);
                                    }}
                                >
                                    Sí, modificar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

/** Resumen consolidado: cliente × sector con estrategias, actividades ejecutadas y visitas. */
function ResumenClienteSector({ filas }: {
    filas: { cliente: string; sector: string; estrategias: number; actividades: number; visitas: number }[];
}) {
    if (filas.length === 0) return null;
    return (
        <details className="resumen-cliente-sector">
            <summary className="campo-lbl">Resumen por cliente y sector ({filas.length})</summary>
            <div className="tabla-scroll">
                <table className="tabla">
                    <thead>
                        <tr><th>Cliente</th><th>Sector</th><th>Estrategias</th><th>Actividades</th><th>Visitas</th></tr>
                    </thead>
                    <tbody>
                        {filas.map(f => (
                            <tr key={`${f.cliente}|${f.sector}`}>
                                <td>{f.cliente}</td>
                                <td>{f.sector}</td>
                                <td className="mono">{f.estrategias}</td>
                                <td className="mono">{f.actividades}</td>
                                <td className="mono">{f.visitas}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </details>
    );
}

/** Nivel 1 del drill-down: actividades del sector. Nivel 2: la visita en que se hizo cada una. */
function ListaActividades({ actividades, abiertas, onAlternar }: {
    actividades: ActividadDeEstrategia[];
    abiertas: Set<string>;
    onAlternar: (id: string) => void;
}) {
    if (actividades.length === 0) {
        return <p className="ayuda">Todavía no hay actividades ejecutadas en este sector.</p>;
    }
    return (
        <ul className="lista-actividades">
            {actividades.map(({ actividad: a, visita: v }) => {
                const clave = `${v.id}|${a.id}`;
                const abierta = abiertas.has(clave);
                return (
                    <li key={clave}>
                        <button
                            type="button" className="btn-txt" aria-expanded={abierta}
                            onClick={() => onAlternar(clave)}
                        >
                            {abierta ? '▾' : '▸'} {fechaCorta(v.dia)} · {a.tipo || 'Actividad'}
                            {a.materiales?.length ? ` · ${a.materiales.map(m => m.material).join(', ')}` : ''}
                            {a.resultado_seguimiento ? ` · ${a.resultado_seguimiento}` : ''}
                        </button>
                        {abierta && (
                            <p className="ayuda">
                                Visita del {fechaCorta(v.dia)} · {v.educador || 'sin educador'} ·{' '}
                                {v.estado || 'sin estado'}{v.hospital ? ` · ${v.hospital}` : ''}
                            </p>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * Un cliente puede tener varias Estrategias activas (una por sector). Al generar la visita se
 * muestran TODAS juntas, separadas, para ver en qué momento va cada una antes de decidir cuáles
 * sectores entran a la visita — la visita resultante es una visita normal desde el segundo cero:
 * se le pueden agregar más sectores (aunque no estén aquí), reagendar, cancelar, etc.
 */
function GenerarVisita({ cliente, estrategias, onCerrar, onGenerada }: {
    cliente: string;
    estrategias: Estrategia[];
    onCerrar: () => void;
    onGenerada: () => void;
}) {
    const ordenadas = useMemo(
        () => [...estrategias].sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || '')),
        [estrategias]
    );
    const [elegidas, setElegidas] = useState<Set<string>>(
        () => new Set(ordenadas.filter(estrategiaVigente).map(e => e.id))
    );
    // Objetivo, origen y solicitante: obligatorios y SIEMPRE en blanco al empezar — la persona que
    // pide la actividad puede cambiar de una visita a otra, así que nada se autocompleta.
    // Se capturan por sector y grupo de artículo (clave `sector|grupo`).
    const [datos, setDatos] = useState<Record<string, DatosGrupo>>({});
    const [cerradas, setCerradas] = useState<Set<string>>(new Set());
    const listaOrigenes = useMemo(() => origenes(), []);

    const poner = (clave: string, cambio: Partial<DatosGrupo>) =>
        setDatos(d => ({ ...d, [clave]: { ...(d[clave] ?? GRUPO_VACIO), ...cambio } }));
    const alternarTarjeta = (sector: string) => setCerradas(prev => {
        const copia = new Set(prev);
        if (copia.has(sector)) copia.delete(sector); else copia.add(sector);
        return copia;
    });

    const alternar = (id: string) => setElegidas(prev => {
        const copia = new Set(prev);
        if (copia.has(id)) copia.delete(id); else copia.add(id);
        return copia;
    });

    const seleccionadas = ordenadas.filter(e => elegidas.has(e.id));
    const porCapturar = sectoresACapturar(seleccionadas);
    const sectores = porCapturar.map(s => s.sector);
    const sinCompletar = faltantes(porCapturar, datos);
    const listo = seleccionadas.length > 0 && sinCompletar.length === 0;

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-actividad">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>Generar visita</h3>
                        <span className="eyebrow">{cliente}</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
                </div>

                <div className="modal-body">
                    <p className="ayuda">
                        Elige qué estrategias de este cliente entran a la visita. Cada una aporta
                        su sector; la visita resultante se agenda como cualquier otra.
                    </p>

                    {ordenadas.map((e, i) => (
                        <label className="admin-fila-col estrategia-linea" key={e.id}>
                            {i > 0 && <hr />}
                            <div className="admin-fila">
                                <input
                                    type="checkbox"
                                    checked={elegidas.has(e.id)}
                                    onChange={() => alternar(e.id)}
                                />
                                <span className="pill neutro">{e.sector || 'Sin sector'}</span>
                                {e.grupo_articulo && <span className="mono">{e.grupo_articulo}</span>}
                                {e.etapa && <span className="pill neutro">{e.etapa}</span>}
                            </div>
                            {e.proyecto && <p className="ayuda">{e.proyecto}</p>}
                        </label>
                    ))}

                    {porCapturar.map(({ sector, grupos }) => {
                        const completa = sectorCompleto({ sector, grupos }, datos);
                        // Cada tarjeta se pliega y se abre a mano; el pill dice si ya está completa.
                        const abierta = !cerradas.has(sector);
                        return (
                            <section className={'tarjeta-sector' + (completa ? ' es-completa' : '')} key={sector}>
                                <button
                                    type="button" className="tarjeta-sector-cab" aria-expanded={abierta}
                                    onClick={() => alternarTarjeta(sector)}
                                >
                                    <span>{abierta ? '▾' : '▸'} {sector}</span>
                                    <span className={'pill ' + (completa ? 'st-completa' : 'neutro')}>
                                        {completa ? '✓ Completo' : 'Falta captura'}
                                    </span>
                                </button>

                                {abierta && grupos.map((grupo, i) => {
                                    const clave = claveGrupo(sector, grupo);
                                    const d = datos[clave] ?? GRUPO_VACIO;
                                    const previo = i > 0 ? datos[claveGrupo(sector, grupos[i - 1])] : undefined;
                                    const delGrupo = seleccionadas.filter(e => e.sector === sector && (e.grupo_articulo || '') === grupo);
                                    return (
                                        <div className="sub-grupo" key={clave}>
                                            {grupos.length > 1 && (
                                                <div className="admin-fila">
                                                    <span className="campo-lbl">Grupo de artículo: {grupo || 'sin grupo'}</span>
                                                    <span style={{ flex: 1 }} />
                                                    {i > 0 && (
                                                        <button
                                                            type="button" className="btn-txt"
                                                            disabled={!previo || (!previo.objetivo && !previo.origen.length && !previo.solicitado)}
                                                            title="Copia objetivo, solicitado por y origen del grupo anterior"
                                                            onClick={() => previo && poner(clave, {
                                                                objetivo: previo.objetivo, origen: [...previo.origen], solicitado: previo.solicitado
                                                            })}
                                                        >
                                                            Repetir lo del grupo anterior
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                            {delGrupo.map(e => (
                                                <p className="ayuda" key={e.id}>
                                                    Objetivo de la estrategia: {e.proyecto || e.descripcion || 'sin más detalle'}
                                                </p>
                                            ))}

                                            <label className="campo">
                                                <span className="campo-lbl">Objetivo de la visita *</span>
                                                <input
                                                    type="text" className="inp" placeholder="¿Qué se busca lograr en esta visita?"
                                                    value={d.objetivo} onChange={(ev) => poner(clave, { objetivo: ev.target.value })}
                                                />
                                            </label>
                                            <label className="campo">
                                                <span className="campo-lbl">Solicitado por *</span>
                                                <input
                                                    type="text" className="inp" placeholder="Nombre de quien pidió la actividad"
                                                    value={d.solicitado} onChange={(ev) => poner(clave, { solicitado: ev.target.value })}
                                                />
                                            </label>
                                            <div className="campo">
                                                <span className="campo-lbl">Origen de la actividad *</span>
                                                <div className="chips">
                                                    {listaOrigenes.map(o => {
                                                        const activo = d.origen.includes(o);
                                                        return (
                                                            <button
                                                                key={o} type="button" aria-pressed={activo}
                                                                className={'chip' + (activo ? ' on' : '')}
                                                                onClick={() => poner(clave, {
                                                                    origen: activo ? d.origen.filter(x => x !== o) : [...d.origen, o]
                                                                })}
                                                            >
                                                                {o}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </section>
                        );
                    })}

                    <div className="modal-foot">
                        <span className={'pista' + (listo ? ' es-ok' : '')}>
                            {seleccionadas.length === 0
                                ? 'Elige al menos una estrategia.'
                                : sinCompletar.length > 0
                                    ? `Falta objetivo, solicitado por y origen en: ${sinCompletar.join(', ')}`
                                    : `${sectores.length} sector${sectores.length === 1 ? '' : 'es'}: ${sectores.join(', ')}`}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                            type="button" className="btn btn-principal" disabled={!listo}
                            onClick={() => {
                                // Solo se anuncia "Visita generada" si el drawer de verdad abrió: antes
                                // el aviso salía aunque no hubiera nada que mostrar.
                                const { objetivos, origenes: origenElegido, solicitados } = consolidarPorSector(porCapturar, datos);
                                const abierta = abrirNuevaVisita({
                                    cliente,
                                    ids_estrategias: seleccionadas.map(e => e.id),
                                    sectorNombres: sectores,
                                    objetivos,
                                    origenes: origenElegido,
                                    solicitados
                                });
                                if (abierta) onGenerada(); else onCerrar();
                            }}
                        >
                            Generar visita
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FormularioEstrategia({ estrategia, sectores, clientes, onGuardar, onCerrar }: {
    estrategia: Estrategia | null;
    sectores: string[];
    clientes: string[];
    onGuardar: (e: Estrategia) => void;
    onCerrar: () => void;
}) {
    const [cliente, setCliente] = useState(estrategia?.cliente || '');
    const [sector, setSector] = useState(estrategia?.sector || '');
    const [grupo, setGrupo] = useState(estrategia?.grupo_articulo || '');
    const [tipoEstrategia, setTipoEstrategia] = useState(estrategia?.tipo_estrategia || '');
    const [descripcion, setDescripcion] = useState(estrategia?.descripcion || '');
    const [etapa, setEtapa] = useState(estrategia?.etapa || '');
    const [estatus, setEstatus] = useState(estrategia?.estatus || 'Pendiente');
    const [proyecto, setProyecto] = useState(estrategia?.proyecto || '');
    const [productos, setProductos] = useState<string[]>(estrategia?.productos || []);
    const [observaciones, setObservaciones] = useState(estrategia?.observaciones || '');

    const opcionesCliente = useCallback((q: string) => filtrar(clientes, q), [clientes]);
    const catalogoTipos = useMemo(() => tiposEstrategia(), []);
    const catalogoEtapas = useMemo(() => etapasEstrategia(), []);
    const catalogoEstatus = useMemo(() => estatusEstrategia(), []);
    const [valorMensual, setValorMensual] = useState(
        estrategia?.valor_mensual === undefined ? '' : String(estrategia.valor_mensual)
    );

    // Grupos que de verdad se trabajan en ESTE sector — se recalcula al cambiar el sector del
    // formulario, no el del filtro de fuera (son estados independientes).
    const grupos = useMemo(() => gruposDeSector(sector), [sector]);
    useEffect(() => {
        if (grupo && !grupos.includes(grupo)) setGrupo('');
    }, [grupos, grupo]);

    // El autocompletado de Productos se acota al sector elegido —igual que al registrar una
    // actividad—: ofrecer materiales de otro sector sería ruido que invita a equivocarse.
    const opcionesProductos = useCallback(
        (q: string) => (sector && grupo ? buscarMateriales(sector, q, 40, grupo).map(m => m.material) : []),
        [sector, grupo]
    );

    // Al cambiar de grupo se descartan los productos que ya no le pertenecen.
    useEffect(() => {
        if (!sector || !grupo) return;
        const delGrupo = new Set(buscarMateriales(sector, '', Infinity, grupo).map(m => m.material));
        setProductos(ps => (ps.every(p => delGrupo.has(p)) ? ps : ps.filter(p => delGrupo.has(p))));
    }, [sector, grupo]);

    const falta = faltaEnEstrategia({
        cliente, sector, grupo, tipo: tipoEstrategia, etapa, proyecto, productos, observaciones
    });
    const listo = falta.length === 0;
    const visible = (campo: string) => esVisibleEn('estrategia', campo);
    const rotulo = (campo: string, texto: string) => rotuloEn('estrategia', campo, texto);

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-actividad">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>Nueva estrategia</h3>
                        <span className="eyebrow">Una vez guardada es de solo lectura: solo avanzan la etapa y el estatus</span>
                    </div>
                    <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onCerrar}>✕</button>
                </div>

                <div className="modal-body">
                    <Combo
                        etiqueta="Cliente"
                        valor={cliente}
                        placeholder="Busca N° o razón social…"
                        opciones={opcionesCliente}
                        total={clientes.length}
                        autoFocus
                        onElegir={setCliente}
                        onEscribir={setCliente}
                    />

                    {visible('tipo') && (
                        <div className="campo">
                            <span className="campo-lbl" id="lbl-tipo-estrategia">{rotulo('tipo', 'Estrategia')}</span>
                            {/* La descripción de cada tipo sale al pasar el cursor (o enfocar con teclado),
                                sin haberlo elegido: así se compara antes de decidir. */}
                            <div className="chips" role="radiogroup" aria-labelledby="lbl-tipo-estrategia">
                                {catalogoTipos.map(o => {
                                    const activo = tipoEstrategia === o;
                                    const ayuda = descripcionTipoEstrategia(o);
                                    return (
                                        <button
                                            key={o} type="button" role="radio" aria-checked={activo}
                                            className={'chip chip-tooltip' + (activo ? ' on' : '')}
                                            data-ayuda={ayuda || undefined}
                                            aria-label={ayuda ? `${o}: ${ayuda}` : o}
                                            onClick={() => setTipoEstrategia(activo ? '' : o)}
                                        >
                                            {o}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {visible('descripcion') && (
                        <label className="campo">
                            <span className="campo-lbl">{rotulo('descripcion', 'Descripción')}</span>
                            <textarea
                                className="inp notas-area" rows={2} placeholder="¿En qué consiste esta estrategia?"
                                value={descripcion} onChange={(e) => setDescripcion(e.target.value)}
                            />
                        </label>
                    )}

                    {(visible('sector') || visible('grupo_articulo')) && (
                        <div className="grid-2">
                            {visible('sector') && (
                                <label className="campo">
                                    <span className="campo-lbl">{rotulo('sector', 'Sector')}</span>
                                    <select className="inp" value={sector} onChange={(e) => setSector(e.target.value)}>
                                        <option value="">Elige un sector…</option>
                                        {sectores.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </label>
                            )}
                            {visible('grupo_articulo') && (
                                <label className="campo">
                                    <span className="campo-lbl">{rotulo('grupo_articulo', 'Grupo de artículo')}</span>
                                    <select className="inp" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                                        <option value="">Elige un grupo…</option>
                                        {grupos.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                </label>
                            )}
                        </div>
                    )}

                    {visible('etapa') && (
                        <label className="campo">
                            <span className="campo-lbl">{rotulo('etapa', 'Etapa')}</span>
                            <select className="inp" value={etapa} onChange={(e) => setEtapa(e.target.value)}>
                                <option value="">Sin definir</option>
                                {catalogoEtapas.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </label>
                    )}

                    {visible('estatus') && (
                        <label className="campo">
                            <span className="campo-lbl">{rotulo('estatus', 'Estatus')}</span>
                            <select className="inp" value={estatus} onChange={(e) => setEstatus(e.target.value)}>
                                {catalogoEstatus.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                        </label>
                    )}

                    {estrategia && visible('etapa') && <LineaTiempoEtapas etapas={estrategia.etapas} />}

                    {visible('proyecto') && (
                        <label className="campo">
                            <span className="campo-lbl">{rotulo('proyecto', 'Proyecto / objetivo')}</span>
                            <input
                                type="text" className="inp" placeholder="¿Qué se busca conseguir con este cliente aquí?"
                                value={proyecto} onChange={(e) => setProyecto(e.target.value)}
                            />
                        </label>
                    )}

                    {/* `key` fuerza un remontaje al agregar uno: así el campo queda limpio y
                        listo para el siguiente en vez de conservar el texto ya elegido. */}
                    {visible('productos') && (
                        <Combo
                            key={productos.length}
                            etiqueta={rotulo('productos', 'Productos')}
                            valor=""
                            placeholder={sector && grupo ? 'Busca un material de este grupo…' : 'Elige sector y grupo primero'}
                            opciones={opcionesProductos}
                            onElegir={(m) => setProductos(ps => (ps.includes(m) ? ps : [...ps, m]))}
                            onEscribir={() => {}}
                        />
                    )}
                    {visible('productos') && productos.length > 0 && (
                        <div className="chips">
                            {productos.map(p => (
                                <span className="pill neutro" key={p}>
                                    {p}
                                    <button
                                        type="button" className="pill-quitar" aria-label={`Quitar ${p}`}
                                        onClick={() => setProductos(ps => ps.filter(x => x !== p))}
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}

                    <label className="campo">
                        <span className="campo-lbl">Valor mensual de la estrategia ($)</span>
                        <input
                            type="text" inputMode="decimal" className="inp" placeholder="Opcional — $0.00"
                            value={valorMensual} onChange={(e) => setValorMensual(e.target.value)}
                            onBlur={() => {
                                const n = aNumeroMoneda(valorMensual);
                                setValorMensual(n === undefined ? '' : moneda(n));
                            }}
                        />
                        <span className="ayuda">Opcional. Después solo un administrador puede modificarlo.</span>
                    </label>

                    {visible('observaciones') && (
                        <label className="campo">
                            <span className="campo-lbl">{rotulo('observaciones', 'Observaciones')}</span>
                            <textarea
                                className="inp notas-area" rows={3}
                                value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
                            />
                        </label>
                    )}

                    <div className="modal-foot">
                        <span className={'pista' + (listo ? ' es-ok' : '')}>
                            {listo ? 'Listo para guardar.' : `Falta ${falta.join(' · ')}`}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                            type="button" className="btn btn-principal" disabled={!listo}
                            onClick={() => onGuardar({
                                id: estrategia?.id || nuevoId('estr'),
                                cliente: cliente.trim(),
                                sector: sector || undefined,
                                grupo_articulo: grupo || undefined,
                                tipo_estrategia: tipoEstrategia || undefined,
                                descripcion: descripcion.trim() || undefined,
                                etapa: etapa || undefined,
                                estatus: estatus || undefined,
                                proyecto: proyecto.trim() || undefined,
                                productos: productos.length > 0 ? productos : undefined,
                                observaciones: observaciones.trim() || undefined,
                                valor_mensual: aNumeroMoneda(valorMensual)
                            })}
                        >
                            Guardar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Línea de tiempo del avance, del más viejo al más nuevo. Cada punto es una foto de (etapa,
 * estatus); lo que CAMBIÓ respecto al punto anterior se marca, y el vigente va resaltado. No
 * asume una secuencia "correcta": puede ir de Negociación a Presentación y volver.
 */
function LineaTiempoEtapas({ etapas }: { etapas?: EtapaHistorial[] }) {
    if (!etapas || etapas.length === 0) return null;

    return (
        <div className="campo">
            <span className="campo-lbl">Línea de tiempo</span>
            <ol className="linea-tiempo">
                {etapas.map((h, i) => {
                    const previo = etapas[i - 1];
                    const cambioEtapa = !previo || (h.etapa ?? '') !== (previo.etapa ?? '');
                    const cambioEstatus = !!h.estatus && (!previo || h.estatus !== previo.estatus);
                    const vigente = i === etapas.length - 1;
                    return (
                        <li
                            className={'linea-tiempo-item' + (vigente ? ' es-vigente' : '')}
                            key={`${h.etapa}-${h.estatus}-${h.momento}-${i}`}
                            aria-current={vigente ? 'step' : undefined}
                        >
                            <span className="linea-tiempo-punto" />
                            <div className="linea-tiempo-txt">
                                {/* Etapa y estatus van SIEMPRE: cada punto es una foto de ambos. Lo que cambió
                                    respecto al punto anterior se marca con ↑, para no tener que comparar a ojo. */}
                                <span className="chips">
                                    {!previo && <span className="pill neutro">Creada</span>}
                                    <span className={'pill neutro' + (cambioEtapa && previo ? ' es-cambio' : '')}>
                                        Etapa: {h.etapa || 'Sin definir'}{cambioEtapa && previo ? ' ↑' : ''}
                                    </span>
                                    <span className={'pill neutro' + (cambioEstatus && previo ? ' es-cambio' : '')}>
                                        Estatus: {h.estatus || 'Sin definir'}{cambioEstatus && previo ? ' ↑' : ''}
                                    </span>
                                </span>
                                <span className="ayuda mono">
                                    {fechaHoraCorta(h.momento)}
                                    {h.actor_nombre ? ` · ${h.actor_nombre}` : ''}
                                </span>
                                {h.nota && <span className="ayuda">{h.nota}</span>}
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

/** Hoy en la zona del dispositivo (`toISOString` da el día UTC: por la tarde-noche ya es mañana). */
function fechaLocalISO(): string {
    const d = new Date();
    const dos = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function fechaHoraCorta(iso?: string): string {
    return fechaHoraDdMmAaaa(iso) || '—';
}
