/**
 * Histórico pre-AppSheet: los dos Excel de antes de esta app ("Registro Actividades" y
 * "Registro Plan de Trabajo"), solo lectura — no se pueden linkear entre sí (no comparten un
 * ID, solo nombre+fecha, ambiguo) así que viven en dos pestañas separadas, cada una con su
 * propia tabla y filtros, en vez de forzar una relación que los datos no soportan.
 *
 * Un administrador ve de cualquiera; cualquier otro ve solo lo propio — el servidor decide
 * eso, no el filtro de correo de aquí (que para un no-admin ni se manda).
 */

import { useEffect, useMemo, useState } from 'react';
import { leerHistoricoActividades, leerHistoricoPlanTrabajo, fechaCorta } from '@core/puente';
import type { FilaHistoricoActividad, FilaHistoricoPlanTrabajo } from '@core/tipos';

type Pagina = 'actividades' | 'plan-trabajo';

const PESTANAS: Array<{ id: Pagina; etiqueta: string }> = [
    { id: 'actividades', etiqueta: 'Registro Actividades' },
    { id: 'plan-trabajo', etiqueta: 'Registro Plan de Trabajo' }
];

export function Historico() {
    const [pagina, setPagina] = useState<Pagina>('actividades');

    const [act, setAct] = useState<FilaHistoricoActividad[]>([]);
    const [pt, setPt] = useState<FilaHistoricoPlanTrabajo[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cargado, setCargado] = useState(false);

    // Se pide una sola vez, las dos tablas juntas — no hay filtro de servidor que las achique
    // (el volumen es de miles, no millones) y así cambiar de pestaña no vuelve a pedir nada.
    useEffect(() => {
        let cancelado = false;
        setCargando(true);
        setError(null);

        Promise.all([leerHistoricoActividades(), leerHistoricoPlanTrabajo()])
            .then(([ra, rp]) => {
                if (cancelado) return;
                if (ra.status === 'error') { setError(ra.message || 'No se pudo cargar Registro Actividades.'); return; }
                if (rp.status === 'error') { setError(rp.message || 'No se pudo cargar Registro Plan de Trabajo.'); return; }
                setAct(ra.filas || []);
                setPt(rp.filas || []);
                setCargado(true);
            })
            .catch(err => { if (!cancelado) setError((err as Error).message); })
            .finally(() => { if (!cancelado) setCargando(false); });

        return () => { cancelado = true; };
    }, []);

    return (
        <div className="vista vista-historico">
            <header className="vista-head">
                <h2>Histórico</h2>
                <p className="eyebrow">
                    Datos de antes de esta app (hasta 2025). Solo lectura — no se pueden editar
                    ni se mezclan con las visitas/actividades en vivo.
                </p>
            </header>

            <div className="seg" role="group" aria-label="Qué histórico ver">
                {PESTANAS.map(p => (
                    <button key={p.id} type="button" aria-pressed={pagina === p.id} onClick={() => setPagina(p.id)}>
                        {p.etiqueta}
                    </button>
                ))}
            </div>

            {error && <p className="ayuda es-error">No se pudo cargar: {error}</p>}

            {cargando && !cargado ? (
                <p className="ayuda">Cargando…</p>
            ) : pagina === 'actividades' ? (
                <TablaActividades filas={act} />
            ) : (
                <TablaPlanTrabajo filas={pt} />
            )}
        </div>
    );
}

function Select({ etiqueta, valor, opciones, onCambiar }: {
    etiqueta: string; valor: string; opciones: string[]; onCambiar: (v: string) => void;
}) {
    return (
        <label className="filtro">
            <span className="campo-lbl">{etiqueta}</span>
            <select className="inp" value={valor} onChange={(e) => onCambiar(e.target.value)}>
                <option value="">Todos</option>
                {opciones.map(o => <option value={o} key={o}>{o}</option>)}
            </select>
        </label>
    );
}

interface FiltroComun {
    desde: string;
    hasta: string;
    educador: string;
}

const SIN_FILTRO: FiltroComun = { desde: '', hasta: '', educador: '' };

function TablaActividades({ filas }: { filas: FilaHistoricoActividad[] }) {
    const [filtro, setFiltro] = useState<FiltroComun>(SIN_FILTRO);
    const [resultado, setResultado] = useState('');

    const opcionesEducador = useMemo(() => {
        const m = new Map<string, string>();
        filas.forEach(f => { if (f.educador_correo) m.set(f.educador_correo, f.educador_nombre || f.educador_correo); });
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    }, [filas]);
    const opcionesResultado = useMemo(
        () => [...new Set(filas.map(f => f.resultado))].filter((r): r is string => !!r).sort(),
        [filas]
    );

    const filtradas = useMemo(() => filas.filter(f =>
        (!filtro.desde || (f.fecha_documento || '') >= filtro.desde)
        && (!filtro.hasta || (f.fecha_documento || '') <= filtro.hasta)
        && (!filtro.educador || f.educador_correo === filtro.educador)
        && (!resultado || f.resultado === resultado)
    ), [filas, filtro, resultado]);

    const activos = [filtro.desde, filtro.hasta, filtro.educador, resultado].filter(Boolean).length;

    return (
        <>
            <div className="filtros">
                <label className="filtro">
                    <span className="campo-lbl">Desde</span>
                    <input type="date" className="inp" value={filtro.desde}
                           onChange={(e) => setFiltro(f => ({ ...f, desde: e.target.value }))} />
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Hasta</span>
                    <input type="date" className="inp" value={filtro.hasta}
                           onChange={(e) => setFiltro(f => ({ ...f, hasta: e.target.value }))} />
                </label>
                <Select etiqueta="Educador" valor={filtro.educador}
                        opciones={opcionesEducador.map(([correo]) => correo)}
                        onCambiar={(v) => setFiltro(f => ({ ...f, educador: v }))} />
                <Select etiqueta="Resultado" valor={resultado} opciones={opcionesResultado} onCambiar={setResultado} />

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {filtradas.length} registro{filtradas.length === 1 ? '' : 's'} en el resultado
                    </span>
                    {activos > 0 && (
                        <button type="button" className="btn-txt"
                                onClick={() => { setFiltro(SIN_FILTRO); setResultado(''); }}>
                            Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                        </button>
                    )}
                </div>
            </div>

            {filtradas.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">Nada que mostrar</p>
                    <p className="ayuda">Prueba ampliar el rango de fechas o quitar filtros.</p>
                </div>
            ) : (
                <div className="tabla-scroll">
                    <table className="tabla">
                        <thead>
                            <tr>
                                <th>Fecha doc.</th>
                                <th>Educador</th>
                                <th>Actividad</th>
                                <th>Cliente</th>
                                <th>Hospital</th>
                                <th>Sector</th>
                                <th>Artículo</th>
                                <th>Resultado</th>
                                <th>Gerencia Marca</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map((f, i) => (
                                <tr key={i}>
                                    <td className="mono">{fechaCorta(f.fecha_documento) || '–'}</td>
                                    <td>{f.educador_nombre || '–'}</td>
                                    <td>{f.tipo_actividad || '–'}</td>
                                    <td>{f.cliente_razon_social || '–'}</td>
                                    <td>{f.hospital || '–'}</td>
                                    <td>{f.sector || '–'}</td>
                                    <td>{f.articulo || '–'}</td>
                                    <td>{f.resultado || '–'}</td>
                                    <td>{f.gerencia_marca || '–'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}

function TablaPlanTrabajo({ filas }: { filas: FilaHistoricoPlanTrabajo[] }) {
    const [filtro, setFiltro] = useState<FiltroComun>(SIN_FILTRO);

    const opcionesEducador = useMemo(() => {
        const m = new Map<string, string>();
        filas.forEach(f => { if (f.educador_correo) m.set(f.educador_correo, f.educador_nombre || f.educador_correo); });
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    }, [filas]);

    const filtradas = useMemo(() => filas.filter(f =>
        (!filtro.desde || (f.fecha || '') >= filtro.desde)
        && (!filtro.hasta || (f.fecha || '') <= filtro.hasta)
        && (!filtro.educador || f.educador_correo === filtro.educador)
    ), [filas, filtro]);

    const activos = [filtro.desde, filtro.hasta, filtro.educador].filter(Boolean).length;

    return (
        <>
            <div className="filtros">
                <label className="filtro">
                    <span className="campo-lbl">Desde</span>
                    <input type="date" className="inp" value={filtro.desde}
                           onChange={(e) => setFiltro(f => ({ ...f, desde: e.target.value }))} />
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Hasta</span>
                    <input type="date" className="inp" value={filtro.hasta}
                           onChange={(e) => setFiltro(f => ({ ...f, hasta: e.target.value }))} />
                </label>
                <Select etiqueta="Educador" valor={filtro.educador}
                        opciones={opcionesEducador.map(([correo]) => correo)}
                        onCambiar={(v) => setFiltro(f => ({ ...f, educador: v }))} />

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {filtradas.length} registro{filtradas.length === 1 ? '' : 's'} en el resultado
                    </span>
                    {activos > 0 && (
                        <button type="button" className="btn-txt" onClick={() => setFiltro(SIN_FILTRO)}>
                            Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                        </button>
                    )}
                </div>
            </div>

            {filtradas.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">Nada que mostrar</p>
                    <p className="ayuda">Prueba ampliar el rango de fechas o quitar filtros.</p>
                </div>
            ) : (
                <div className="tabla-scroll">
                    <table className="tabla">
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Educador</th>
                                <th>Cliente</th>
                                <th>Hospital</th>
                                <th>Área visitada</th>
                                <th>Sector</th>
                                <th>Puntualidad</th>
                                <th>Efectividad</th>
                                <th>Objetivo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtradas.map((f, i) => (
                                <tr key={i}>
                                    <td className="mono">{fechaCorta(f.fecha) || '–'}</td>
                                    <td>{f.educador_nombre || '–'}</td>
                                    <td>{f.cliente || '–'}</td>
                                    <td>{f.hospital || '–'}</td>
                                    <td>{f.area_visitada || '–'}</td>
                                    <td>{f.sector || '–'}</td>
                                    <td>{f.puntualidad || '–'}</td>
                                    <td>{f.efectividad || '–'}</td>
                                    <td>{f.objetivo || '–'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
}
