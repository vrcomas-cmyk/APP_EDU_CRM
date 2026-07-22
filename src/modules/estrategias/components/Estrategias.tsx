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
    descargarEstrategiasEquipo, sincronizarEstrategias, leerCatalogo,
    sectores, gruposArticulo, ETAPAS_ESTRATEGIA, sesionActual, type Avisar
} from '@core/puente';
import { Combo, filtrar } from '@shared/components/Combo';
import type { Estrategia } from '@core/tipos';

/** Clientes del catálogo descargado. Son ~11.5k: nunca se pintan todos de golpe. */
function clientesDelCatalogo(): string[] {
    const cat = leerCatalogo() as { clientes?: string[] } | null;
    return Array.isArray(cat?.clientes) ? cat.clientes : [];
}

export function Estrategias({ avisar }: { avisar?: Avisar }) {
    const [version, setVersion] = useState(0);
    const [cargando, setCargando] = useState(true);
    const [editando, setEditando] = useState<Estrategia | 'nueva' | null>(null);

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

    const catalogoSectores = useMemo(() => sectores(), []);
    const catalogoGrupos = useMemo(() => gruposArticulo(), []);
    const catalogoClientes = useMemo(() => clientesDelCatalogo(), []);
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
                                <th>Actualizó</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map(e => (
                                <tr key={e.id}>
                                    <td>{e.cliente}</td>
                                    <td>{e.sector || '—'}</td>
                                    <td>{e.grupo_articulo || '—'}</td>
                                    <td>{e.etapa ? <span className="pill neutro">{e.etapa}</span> : '—'}</td>
                                    <td className="col-proyecto">{e.proyecto || '—'}</td>
                                    <td className="mono" title={e.actualizado_correo}>{e.actualizado_por || '—'}</td>
                                    <td>
                                        <button type="button" className="btn-txt" onClick={() => setEditando(e)}>
                                            Editar
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editando && (
                <FormularioEstrategia
                    estrategia={editando === 'nueva' ? null : editando}
                    sectores={catalogoSectores}
                    grupos={catalogoGrupos}
                    clientes={catalogoClientes}
                    onGuardar={guardar}
                    onEliminar={editando !== 'nueva' ? () => { quitar((editando as Estrategia).id); setEditando(null); } : undefined}
                    onCerrar={() => setEditando(null)}
                />
            )}
        </div>
    );
}

function FormularioEstrategia({ estrategia, sectores, grupos, clientes, onGuardar, onEliminar, onCerrar }: {
    estrategia: Estrategia | null;
    sectores: string[];
    grupos: string[];
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
    const [productos, setProductos] = useState(estrategia?.productos || '');
    const [observaciones, setObservaciones] = useState(estrategia?.observaciones || '');

    const opcionesCliente = useCallback((q: string) => filtrar(clientes, q), [clientes]);

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

                    <label className="campo">
                        <span className="campo-lbl">Productos</span>
                        <input
                            type="text" className="inp" placeholder="Productos involucrados"
                            value={productos} onChange={(e) => setProductos(e.target.value)}
                        />
                    </label>

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
                                productos: productos.trim() || undefined,
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
