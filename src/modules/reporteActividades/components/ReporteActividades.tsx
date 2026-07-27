/**
 * Reporte de Actividades: réplica del dashboard externo (Looker Studio) dentro de la app,
 * mismas gráficas — donas para "Peso % Sector"/"Peso % Actividad", barras para los rankings.
 *
 * ── Las donas llevan tope y leyenda, no son un calco literal ──────────────────────────────
 *
 * El original pinta hasta 10-11 rebanadas de un pastel. Eso es exactamente el caso que la
 * guía de accesibilidad de gráficas marca como ilegible bajo daltonismo rojo-verde —vecinas
 * se confunden de un vistazo—, así que `Dona` se limita a 6 rebanadas propias y funde el
 * resto en "Otros", con la paleta categórica validada (`--cat-1..8` en `style.css`, ΔE ≥ 8
 * bajo protanopia/deuteranopia) y una leyenda con nombre + valor + % siempre visible — la
 * leyenda hace de "vista de tabla": el dato nunca depende solo del color.
 *
 * ── Por qué se filtra en el cliente y no se vuelve a pedir al servidor ────────────────────
 *
 * Se pide una sola vez por rango de fechas (`desde`/`hasta` sí van al servidor: acotan cuánto
 * se trae). Sector/Actividad/Educador filtran sobre lo ya traído: la organización es chica
 * (decenas de filas, no miles) y encadenar filtros sin una ida de red de por medio es lo que
 * hace que se sientan instantáneos, igual que ya hace `BarraFiltros` en Indicadores.
 */

import { useEffect, useMemo, useState } from 'react';
import { leerReporteActividades } from '@core/puente';
import type { FilaReporteActividad } from '@core/tipos';
import { Medidas, Barras, type Medida } from '../../dashboard/components/Medidas';
import { Dona } from '@shared/components/Dona';

const HOY = () => new Date().toISOString().slice(0, 10);
const PRIMER_DIA_MES = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

interface Filtro {
    desde: string;
    hasta: string;
    sector: string;
    actividad: string;
    educador: string;
}

function contarPor(filas: FilaReporteActividad[], clave: (f: FilaReporteActividad) => string): Medida[] {
    const mapa = new Map<string, number>();
    for (const f of filas) {
        const k = clave(f) || '(sin dato)';
        mapa.set(k, (mapa.get(k) || 0) + 1);
    }
    return [...mapa.entries()]
        .map(([nombre, valor]) => ({ nombre, valor }))
        .sort((a, b) => b.valor - a.valor);
}

export function ReporteActividades() {
    const [pagina, setPagina] = useState<'resumen' | 'cliente'>('resumen');
    const [filtro, setFiltro] = useState<Filtro>({
        desde: PRIMER_DIA_MES(), hasta: HOY(), sector: '', actividad: '', educador: ''
    });

    const [filas, setFilas] = useState<FilaReporteActividad[]>([]);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [espejo, setEspejo] = useState(true);

    // Solo el rango de fechas dispara una ida de red — el resto de los filtros trabaja sobre
    // lo que ya se trajo (ver nota de arriba).
    useEffect(() => {
        let cancelado = false;
        setCargando(true);
        setError(null);

        leerReporteActividades({ desde: filtro.desde, hasta: filtro.hasta })
            .then(r => {
                if (cancelado) return;
                if (r.status === 'error') { setError(r.mensaje || 'No se pudo cargar.'); return; }
                setEspejo(r.espejo);
                setFilas(r.reporte?.filas || []);
            })
            .catch(err => { if (!cancelado) setError((err as Error).message); })
            .finally(() => { if (!cancelado) setCargando(false); });

        return () => { cancelado = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filtro.desde, filtro.hasta]);

    const filtradas = useMemo(() => filas.filter(f =>
        (!filtro.sector || f.sector === filtro.sector)
        && (!filtro.actividad || f.tipo === filtro.actividad)
        && (!filtro.educador || f.educador_correo === filtro.educador)
    ), [filas, filtro.sector, filtro.actividad, filtro.educador]);

    // Las opciones salen de TODO lo del rango de fechas, no de lo ya filtrado — igual que
    // `BarraFiltros`: si salieran del resultado, elegir un sector sería la única opción de su
    // propia lista.
    const opcionesSector = useMemo(() => [...new Set(filas.map(f => f.sector))].filter(Boolean).sort(), [filas]);
    const opcionesActividad = useMemo(() => [...new Set(filas.map(f => f.tipo))].filter(Boolean).sort(), [filas]);
    const opcionesEducador = useMemo(() => {
        const m = new Map<string, string>();
        filas.forEach(f => m.set(f.educador_correo, f.educador || f.educador_correo));
        return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
    }, [filas]);

    const porSector = useMemo(() => contarPor(filtradas, f => f.sector), [filtradas]);
    const porActividad = useMemo(() => contarPor(filtradas, f => f.tipo), [filtradas]);

    const cambiar = (clave: keyof Filtro, valor: string) => setFiltro(f => ({ ...f, [clave]: valor }));
    const activos = [filtro.sector, filtro.actividad, filtro.educador].filter(Boolean).length;

    return (
        <div className="vista vista-reporte-act">
            <header className="vista-head">
                <h2>Actividades</h2>
                <p className="eyebrow">Peso por sector y por actividad, y quién hizo qué — atribuido a quien lo llevaba en su momento.</p>
            </header>

            <div className="seg" role="group" aria-label="Página del reporte">
                <button type="button" aria-pressed={pagina === 'resumen'} onClick={() => setPagina('resumen')}>
                    Resumen
                </button>
                <button type="button" aria-pressed={pagina === 'cliente'} onClick={() => setPagina('cliente')}>
                    Participación por cliente
                </button>
            </div>

            <div className="filtros">
                <label className="filtro">
                    <span className="campo-lbl">Desde</span>
                    <input type="date" className="inp" value={filtro.desde}
                           onChange={(e) => cambiar('desde', e.target.value)} />
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Hasta</span>
                    <input type="date" className="inp" value={filtro.hasta}
                           onChange={(e) => cambiar('hasta', e.target.value)} />
                </label>
                <Select etiqueta="Sector" valor={filtro.sector} opciones={opcionesSector}
                        onCambiar={(v) => cambiar('sector', v)} />
                <Select etiqueta="Actividad" valor={filtro.actividad} opciones={opcionesActividad}
                        onCambiar={(v) => cambiar('actividad', v)} />
                <label className="filtro">
                    <span className="campo-lbl">Educador</span>
                    <select className="inp" value={filtro.educador} onChange={(e) => cambiar('educador', e.target.value)}>
                        <option value="">Todos</option>
                        {opcionesEducador.map(([correo, nombre]) => (
                            <option value={correo} key={correo}>{nombre}</option>
                        ))}
                    </select>
                </label>

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {filtradas.length} registro{filtradas.length === 1 ? '' : 's'} en el resultado
                    </span>
                    {activos > 0 && (
                        <button type="button" className="btn-txt"
                                onClick={() => setFiltro(f => ({ ...f, sector: '', actividad: '', educador: '' }))}>
                            Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                        </button>
                    )}
                </div>
            </div>

            {!espejo && (
                <p className="ayuda">El espejo no está configurado o no respondió; lo que se ve puede estar incompleto.</p>
            )}
            {error && <p className="ayuda es-error">No se pudo cargar: {error}</p>}

            {cargando && filas.length === 0 ? (
                <p className="ayuda">Cargando…</p>
            ) : filtradas.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">Nada que mostrar todavía</p>
                    <p className="ayuda">
                        Prueba ampliar el rango de fechas, o revisa en Administración → Accesos → Sectores
                        que tengas al menos un sector asignado — sin eso no se ve nada del equipo, solo lo propio.
                    </p>
                </div>
            ) : pagina === 'resumen' ? (
                <Resumen porSector={porSector} porActividad={porActividad} filas={filtradas} />
            ) : (
                <ParticipacionCliente filas={filtradas} />
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

function Resumen({ porSector, porActividad, filas }: {
    porSector: Medida[]; porActividad: Medida[]; filas: FilaReporteActividad[];
}) {
    const total = filas.length;

    return (
        <div className="panel-body">
            <div className="tiles">
                <div className="tile">
                    <span className="tile-lbl">Registros</span>
                    <span className="tile-val">{total}</span>
                </div>
            </div>

            <Seccion titulo="Peso % Sector">
                <Dona datos={porSector} />
            </Seccion>

            <Seccion titulo="Peso % Actividad">
                <Dona datos={porActividad} />
            </Seccion>

            <Seccion titulo="Desglose mensual">
                <TablaMensual filas={filas} />
            </Seccion>
        </div>
    );
}

/**
 * Gerencia Marca (a qué jefe se atribuye) × Educador × Actividad, con una columna por mes.
 * Mismo criterio que el reporte externo: un mes sin registros se ve como "–", no se oculta la
 * columna — así se nota un mes flojo, no solo los que sí tuvieron actividad.
 */
function TablaMensual({ filas }: { filas: FilaReporteActividad[] }) {
    const meses = useMemo(() => [...new Set(filas.map(f => f.mes))].sort(), [filas]);

    const filas_agrupadas = useMemo(() => {
        const mapa = new Map<string, {
            jefe: string; educador: string; tipo: string; porMes: Map<string, number>; total: number;
        }>();

        for (const f of filas) {
            const clave = `${f.jefe_correo || ''}··${f.educador_correo}··${f.tipo}`;
            if (!mapa.has(clave)) {
                mapa.set(clave, {
                    jefe: f.jefe || 'Sin jefe asignado en esa fecha',
                    educador: f.educador || f.educador_correo,
                    tipo: f.tipo || '(sin tipo)',
                    porMes: new Map(), total: 0
                });
            }
            const fila = mapa.get(clave)!;
            fila.porMes.set(f.mes, (fila.porMes.get(f.mes) || 0) + 1);
            fila.total++;
        }

        return [...mapa.values()].sort((a, b) =>
            a.jefe.localeCompare(b.jefe, 'es')
            || a.educador.localeCompare(b.educador, 'es')
            || a.tipo.localeCompare(b.tipo, 'es')
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filas, meses.join(',')]);

    return (
        <div className="tabla-scroll">
            <table className="tabla">
                <thead>
                    <tr>
                        <th>Gerencia Marca</th>
                        <th>Educador Clínico</th>
                        <th>Actividad</th>
                        {meses.map(m => <th className="num" key={m}>{m}</th>)}
                        <th className="num">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {filas_agrupadas.map((f, i) => (
                        <tr key={i}>
                            <td>{f.jefe}</td>
                            <td>{f.educador}</td>
                            <td>{f.tipo}</td>
                            {meses.map(m => (
                                <td className="num mono" key={m}>{f.porMes.get(m) || '–'}</td>
                            ))}
                            <td className="num mono"><strong>{f.total}</strong></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * Ranking de clientes por volumen de actividades, con el desglose de sector de cada uno de
 * los primeros — la misma pregunta que "% Participación sector por cliente" del reporte
 * externo (qué línea de producto se trabajó en cada hospital), sin necesitar una barra
 * apilada por las mismas razones de accesibilidad que ya explica `Medidas.tsx`.
 */
function ParticipacionCliente({ filas }: { filas: FilaReporteActividad[] }) {
    const porCliente = useMemo(() => contarPor(filas, f => f.cliente), [filas]);
    const top = porCliente.slice(0, 10);

    const desgloseDe = (cliente: string) => contarPor(filas.filter(f => f.cliente === cliente), f => f.sector);

    return (
        <div className="panel-body">
            <Seccion titulo="Clientes con más actividad">
                <Barras datos={top.map(m => [m.nombre, m.valor] as [string, number])} unidad="registros" />
            </Seccion>

            {top.map(c => (
                <Seccion titulo={`Sector en ${c.nombre}`} key={c.nombre}>
                    <Medidas modo="porcentaje" medidas={desgloseDe(c.nombre)} />
                </Seccion>
            ))}
        </div>
    );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <section className="dash-sec">
            <h4 className="dash-titulo">{titulo}</h4>
            {children}
        </section>
    );
}
