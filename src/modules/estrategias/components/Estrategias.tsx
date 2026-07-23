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
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    leerEstrategias, upsertEstrategia, eliminarEstrategia, nuevoId,
    descargarEstrategiasEquipo, sincronizarEstrategias, clientesEnMisZonas,
    sectores, gruposDeSector, buscarMateriales, ETAPAS_ESTRATEGIA, sesionActual,
    consultarVisitas, type Avisar
} from '@core/puente';
import { Combo, filtrar } from '@shared/components/Combo';
import { abrirNuevaVisita } from '@modules/visitas/montarDrawer';
import type { Estrategia } from '@core/tipos';

export function Estrategias({ avisar }: { avisar?: Avisar }) {
    const [version, setVersion] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [editando, setEditando] = useState<Estrategia | 'nueva' | null>(null);
    const [generando, setGenerando] = useState<string | null>(null); // cliente elegido

    const [fCliente, setFCliente] = useState('');
    const [fSector, setFSector] = useState('');
    const [fGrupo, setFGrupo] = useState('');

    const estrategias = useMemo(() => leerEstrategias(), [version]);

    // Al entrar se refresca contra el equipo: es una referencia compartida, y quedarse con lo
    // que había en el teléfono ignoraría lo que un gerente acaba de escribir desde otro lado.
    useEffect(() => {
        let vivo = true;
        descargarEstrategiasEquipo().then(() => { if (vivo) { setCargando(false); setVersion(n => n + 1); } });
        return () => { vivo = false; };
    }, []);

    const refrescar = useCallback(() => setVersion(n => n + 1), []);

    const guardar = useCallback((datos: Estrategia) => {
        const sesion = sesionActual();
        upsertEstrategia({
            ...datos,
            actualizado: new Date().toISOString(),
            actualizado_por: sesion?.nombre || '',
            actualizado_correo: sesion?.correo || '',
            sincronizado: false
        });
        refrescar();
        setEditando(null);
        avisar?.('Estrategia guardada.', { estado: 'completa' });
        // Se sube en segundo plano: no hacer esperar a quien está planeando por un POST.
        sincronizarEstrategias().then(refrescar).catch(() => {});
    }, [refrescar, avisar]);

    const quitar = useCallback((id: string) => {
        eliminarEstrategia(id);
        refrescar();
        avisar?.('Estrategia eliminada.', { estado: 'programada' });
    }, [refrescar, avisar]);

    const filtradas = useMemo(() => estrategias.filter(e =>
        (!fCliente || e.cliente.toLowerCase().includes(fCliente.toLowerCase())) &&
        (!fSector || e.sector === fSector) &&
        (!fGrupo || e.grupo_articulo === fGrupo)
    ).sort((a, b) => (b.actualizado || '').localeCompare(a.actualizado || '')), [estrategias, fCliente, fSector, fGrupo]);

    /**
     * Cuántas visitas ya se generaron para cada estrategia, y la más reciente — el avance real
     * hacia el objetivo, no solo el plan escrito. Se deriva de `consultarVisitas()` (nunca se
     * guarda un contador aparte): la fuente de verdad es la propia visita vinculada
     * (`id_estrategia`), y un contador guardado se desalinearía en cuanto alguien reagendara o
     * cancelara sin que nadie se acordara de actualizarlo.
     */
    const avancePorEstrategia = useMemo(() => {
        const mapa = new Map<string, { visitas: number; ultima: string }>();
        for (const v of consultarVisitas()) {
            if (!v.id_estrategia) continue;
            const previo = mapa.get(v.id_estrategia) ?? { visitas: 0, ultima: '' };
            previo.visitas++;
            if ((v.dia || '') > previo.ultima) previo.ultima = v.dia || '';
            mapa.set(v.id_estrategia, previo);
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

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {filtradas.length} estrategia{filtradas.length === 1 ? '' : 's'}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button type="button" className="btn btn-principal" onClick={() => setEditando('nueva')}>
                        + Nueva estrategia
                    </button>
                </div>
            </div>

            {cargando && estrategias.length === 0 ? (
                <p className="ayuda">Cargando…</p>
            ) : filtradas.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">Nada que mostrar todavía</p>
                    <p className="ayuda">Agrega la primera estrategia para este cliente y sector.</p>
                </div>
            ) : (
                <div className="tabla-scroll">
                    <table className="tabla">
                        <thead>
                            <tr>
                                <th>Cliente</th>
                                <th>Sector</th>
                                <th>Grupo de artículo</th>
                                <th>Etapa</th>
                                <th>Proyecto / objetivo</th>
                                <th>Visitas</th>
                                <th>Actualizó</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map(e => {
                                const avance = avancePorEstrategia.get(e.id);
                                return (
                                    <tr key={e.id} className="fila-clicable" onClick={() => setGenerando(e.cliente)}>
                                        <td>{e.cliente}</td>
                                        <td>{e.sector || '—'}</td>
                                        <td>{e.grupo_articulo || '—'}</td>
                                        <td>{e.etapa ? <span className="pill neutro">{e.etapa}</span> : '—'}</td>
                                        <td className="col-proyecto">{e.proyecto || '—'}</td>
                                        <td className="mono">
                                            {avance
                                                ? `${avance.visitas} · última ${avance.ultima}`
                                                : 'Ninguna aún'}
                                        </td>
                                        <td className="mono" title={e.actualizado_correo}>{e.actualizado_por || '—'}</td>
                                        <td>
                                            <button
                                                type="button" className="btn-txt"
                                                onClick={(ev) => { ev.stopPropagation(); setEditando(e); }}
                                            >
                                                Editar
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {editando && (
                <FormularioEstrategia
                    estrategia={editando === 'nueva' ? null : editando}
                    sectores={catalogoSectores}
                    clientes={catalogoClientes}
                    onGuardar={guardar}
                    onEliminar={editando !== 'nueva' ? () => { quitar((editando as Estrategia).id); setEditando(null); } : undefined}
                    onCerrar={() => setEditando(null)}
                />
            )}

            {generando && (
                <GenerarVisita
                    cliente={generando}
                    estrategias={estrategias.filter(e => e.cliente === generando)}
                    onCerrar={() => setGenerando(null)}
                    onGenerada={() => { setGenerando(null); avisar?.('Visita generada desde la estrategia.', { estado: 'programada' }); }}
                />
            )}
        </div>
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
        () => new Set(ordenadas.filter(e => e.etapa !== 'Consolidado').map(e => e.id))
    );

    const alternar = (id: string) => setElegidas(prev => {
        const copia = new Set(prev);
        if (copia.has(id)) copia.delete(id); else copia.add(id);
        return copia;
    });

    const seleccionadas = ordenadas.filter(e => elegidas.has(e.id));
    const sectores = [...new Set(seleccionadas.map(e => e.sector).filter((s): s is string => !!s))];
    const listo = seleccionadas.length > 0;

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

                    <div className="modal-foot">
                        <span className={'pista' + (listo ? ' es-ok' : '')}>
                            {listo
                                ? `${sectores.length} sector${sectores.length === 1 ? '' : 'es'}: ${sectores.join(', ')}`
                                : 'Elige al menos una estrategia.'}
                        </span>
                        <span style={{ flex: 1 }} />
                        <button
                            type="button" className="btn btn-principal" disabled={!listo}
                            onClick={() => {
                                abrirNuevaVisita({
                                    cliente,
                                    id_estrategia: seleccionadas[0]?.id,
                                    sectorNombres: sectores
                                });
                                onGenerada();
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

function FormularioEstrategia({ estrategia, sectores, clientes, onGuardar, onEliminar, onCerrar }: {
    estrategia: Estrategia | null;
    sectores: string[];
    clientes: string[];
    onGuardar: (e: Estrategia) => void;
    onEliminar?: () => void;
    onCerrar: () => void;
}) {
    const [cliente, setCliente] = useState(estrategia?.cliente || '');
    const [sector, setSector] = useState(estrategia?.sector || '');
    const [grupo, setGrupo] = useState(estrategia?.grupo_articulo || '');
    const [etapa, setEtapa] = useState(estrategia?.etapa || '');
    const [proyecto, setProyecto] = useState(estrategia?.proyecto || '');
    const [productos, setProductos] = useState<string[]>(estrategia?.productos || []);
    const [observaciones, setObservaciones] = useState(estrategia?.observaciones || '');

    const opcionesCliente = useCallback((q: string) => filtrar(clientes, q), [clientes]);

    // Grupos que de verdad se trabajan en ESTE sector — se recalcula al cambiar el sector del
    // formulario, no el del filtro de fuera (son estados independientes).
    const grupos = useMemo(() => gruposDeSector(sector), [sector]);
    useEffect(() => {
        if (grupo && !grupos.includes(grupo)) setGrupo('');
    }, [grupos, grupo]);

    // El autocompletado de Productos se acota al sector elegido —igual que al registrar una
    // actividad—: ofrecer materiales de otro sector sería ruido que invita a equivocarse.
    const opcionesProductos = useCallback(
        (q: string) => (sector ? buscarMateriales(sector, q).map(m => m.material) : []),
        [sector]
    );

    const listo = cliente.trim().length > 0;

    return (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
            <div className="modal-caja es-actividad">
                <div className="modal-head">
                    <div className="drawer-head-txt">
                        <h3>{estrategia ? 'Editar estrategia' : 'Nueva estrategia'}</h3>
                        <span className="eyebrow">Cualquier educador o gerente puede corregirla</span>
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

                    <div className="grid-2">
                        <label className="campo">
                            <span className="campo-lbl">Sector</span>
                            <select className="inp" value={sector} onChange={(e) => setSector(e.target.value)}>
                                <option value="">Sin definir</option>
                                {sectores.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                        </label>
                        <label className="campo">
                            <span className="campo-lbl">Grupo de artículo</span>
                            <select className="inp" value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                                <option value="">Sin definir</option>
                                {grupos.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                        </label>
                    </div>

                    <label className="campo">
                        <span className="campo-lbl">Etapa</span>
                        <select className="inp" value={etapa} onChange={(e) => setEtapa(e.target.value)}>
                            <option value="">Sin definir</option>
                            {ETAPAS_ESTRATEGIA.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </label>

                    <label className="campo">
                        <span className="campo-lbl">Proyecto / objetivo</span>
                        <input
                            type="text" className="inp" placeholder="¿Qué se busca conseguir con este cliente aquí?"
                            value={proyecto} onChange={(e) => setProyecto(e.target.value)}
                        />
                    </label>

                    {/* `key` fuerza un remontaje al agregar uno: así el campo queda limpio y
                        listo para el siguiente en vez de conservar el texto ya elegido. */}
                    <Combo
                        key={productos.length}
                        etiqueta="Productos"
                        valor=""
                        placeholder={sector ? 'Busca un material de este sector…' : 'Elige un sector primero'}
                        opciones={opcionesProductos}
                        onElegir={(m) => setProductos(ps => (ps.includes(m) ? ps : [...ps, m]))}
                        onEscribir={() => {}}
                    />
                    {productos.length > 0 && (
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
                        <span className="campo-lbl">Observaciones</span>
                        <textarea
                            className="inp notas-area" rows={3}
                            value={observaciones} onChange={(e) => setObservaciones(e.target.value)}
                        />
                    </label>

                    <div className="modal-foot">
                        <span className={'pista' + (listo ? ' es-ok' : '')}>
                            {listo ? 'Listo para guardar.' : 'Falta el cliente.'}
                        </span>
                        <span style={{ flex: 1 }} />
                        {onEliminar && (
                            <button type="button" className="btn-txt peligro" onClick={onEliminar}>Eliminar</button>
                        )}
                        <button
                            type="button" className="btn btn-principal" disabled={!listo}
                            onClick={() => onGuardar({
                                id: estrategia?.id || nuevoId('estr'),
                                cliente: cliente.trim(),
                                sector: sector || undefined,
                                grupo_articulo: grupo || undefined,
                                etapa: etapa || undefined,
                                proyecto: proyecto.trim() || undefined,
                                productos: productos.length > 0 ? productos : undefined,
                                observaciones: observaciones.trim() || undefined
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
