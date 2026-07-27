/**
 * Reporte de Actividades: réplica del dashboard externo (Looker Studio) dentro de la app —
 * mismas 3 pestañas, mismas gráficas: donas para peso %, barras (simples y apiladas) para
 * comparar entre educadores/sectores/clientes.
 *
 * ── Las donas y la apilada llevan tope y leyenda, no son un calco literal ─────────────────
 *
 * El original pinta hasta 16-17 rebanadas/segmentos por gráfica. Eso es exactamente el caso
 * que la guía de accesibilidad de gráficas marca como ilegible bajo daltonismo rojo-verde
 * —vecinas se confunden de un vistazo—, así que tanto `Dona` como `BarraApilada` se limitan a
 * 6 categorías propias y funden el resto en "Otros", con la paleta categórica validada
 * (`--cat-1..8` en `style.css`, ΔE ≥ 8 bajo protanopia/deuteranopia) y una leyenda con nombre +
 * valor siempre visible — la leyenda hace de "vista de tabla": el dato nunca depende solo del
 * color.
 *
 * ── La tercera pestaña, con una diferencia honesta ────────────────────────────────────────
 *
 * El original filtra su tercera pestaña a Actividad = Evaluación y agrega un "% Participación
 * Resultados" (Positiva/Negativa/No aplica). Esta app no captura ese resultado de la
 * evaluación en ningún lado todavía —no es un dato que se pueda inventar del lado del
 * cliente—, así que esa gráfica no está: se replica el resto (sector y cliente, ya filtrado a
 * Evaluación) y se dice por qué falta la tercera, en vez de fingir un dato que no existe.
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
import type { Medida } from '../../dashboard/components/Medidas';
import { Dona } from '@shared/components/Dona';
import { BarraApilada, type FilaApilada } from '@shared/components/BarraApilada';

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

type Pagina = 'resumen' | 'resultado' | 'evaluacion';

const PESTANAS: Array<{ id: Pagina; etiqueta: string }> = [
    { id: 'resumen', etiqueta: 'Resumen actividades' },
    { id: 'resultado', etiqueta: 'Resultado actividades' },
    { id: 'evaluacion', etiqueta: 'Resumen: Evaluación' }
];

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

const esEvaluacion = (tipo: string) => /^evaluaci[oó]n/i.test((tipo || '').trim());

export function ReporteActividades() {
    const [pagina, setPagina] = useState<Pagina>('resumen');
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

    // La tercera pestaña replica al original: fija a Evaluación, sobre lo que los demás
    // filtros ya dejaron pasar.
    const filtradasEvaluacion = useMemo(
        () => filtradas.filter(f => esEvaluacion(f.tipo)), [filtradas]
    );

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

    const cambiar = (clave: keyof Filtro, valor: string) => setFiltro(f => ({ ...f, [clave]: valor }));
    const activos = [filtro.sector, filtro.actividad, filtro.educador].filter(Boolean).length;

    const enEsta = pagina === 'evaluacion' ? filtradasEvaluacion : filtradas;

    return (
        <div className="vista vista-reporte-act">
            <header className="vista-head">
                <h2>Actividades</h2>
                <p className="eyebrow">Peso por sector y por actividad, y quién hizo qué — atribuido a quien lo llevaba en su momento.</p>
            </header>

            <div className="seg" role="group" aria-label="Página del reporte">
                {PESTANAS.map(p => (
                    <button key={p.id} type="button" aria-pressed={pagina === p.id} onClick={() => setPagina(p.id)}>
                        {p.etiqueta}
                    </button>
                ))}
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
                {pagina !== 'evaluacion' && (
                    <Select etiqueta="Actividad" valor={filtro.actividad} opciones={opcionesActividad}
                            onCambiar={(v) => cambiar('actividad', v)} />
                )}
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
                        {enEsta.length} registro{enEsta.length === 1 ? '' : 's'} en el resultado
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
            ) : enEsta.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">Nada que mostrar todavía</p>
                    <p className="ayuda">
                        Prueba ampliar el rango de fechas, o revisa en Administración → Accesos → Sectores
                        que tengas al menos un sector asignado — sin eso no se ve nada del equipo, solo lo propio.
                    </p>
                </div>
            ) : pagina === 'resumen' ? (
                <Resumen filas={filtradas} />
            ) : pagina === 'resultado' ? (
                <Resultado filas={filtradas} />
            ) : (
                <Evaluacion filas={filtradasEvaluacion} />
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

function Seccion({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
    return (
        <section className="dash-sec">
            <h4 className="dash-titulo">{titulo}</h4>
            {ayuda && <p className="ayuda">{ayuda}</p>}
            {children}
        </section>
    );
}

/** Pestaña 1 — "Resumen actividades": donas de peso, desglose mensual, y por educador × sector. */
function Resumen({ filas }: { filas: FilaReporteActividad[] }) {
    const porSector = useMemo(() => contarPor(filas, f => f.sector), [filas]);
    const porActividad = useMemo(() => contarPor(filas, f => f.tipo), [filas]);
    const porEducadorSector = useMemo<FilaApilada[]>(() => {
        const mapa = new Map<string, number>();
        for (const f of filas) {
            const clave = `${f.educador || f.educador_correo}··${f.sector || '(sin sector)'}`;
            mapa.set(clave, (mapa.get(clave) || 0) + 1);
        }
        return [...mapa.entries()].map(([clave, valor]) => {
            const [grupo = '', categoria = ''] = clave.split('··');
            return { grupo, categoria, valor };
        });
    }, [filas]);

    return (
        <div className="panel-body">
            <div className="tiles">
                <div className="tile">
                    <span className="tile-lbl">Registros</span>
                    <span className="tile-val">{filas.length}</span>
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

            <Seccion titulo="Desglose de actividades por educador por sector">
                <BarraApilada filas={porEducadorSector} />
            </Seccion>
        </div>
    );
}

/**
 * Pestaña 2 — "Resultado actividades": participación de cliente dentro de cada sector, y las
 * dos tablas cruzadas (por Sector → Cliente, y por Cliente → Sector). El original trae además
 * una segunda gráfica ("% Participación cliente por sector") que en el propio reporte de
 * origen aparece rota ("Configuración no válida") — no se replica un error.
 */
function Resultado({ filas }: { filas: FilaReporteActividad[] }) {
    const sectorPorCliente = useMemo<FilaApilada[]>(() => {
        const mapa = new Map<string, number>();
        for (const f of filas) {
            const clave = `${f.sector || '(sin sector)'}··${f.cliente || '(sin cliente)'}`;
            mapa.set(clave, (mapa.get(clave) || 0) + 1);
        }
        return [...mapa.entries()].map(([clave, valor]) => {
            const [grupo = '', categoria = ''] = clave.split('··');
            return { grupo, categoria, valor };
        });
    }, [filas]);

    return (
        <div className="panel-body">
            <Seccion
                titulo="% Participación cliente por sector"
                ayuda="Un renglón por sector; cada barra se reparte entre los clientes donde se trabajó ese sector."
            >
                <BarraApilada filas={sectorPorCliente} />
            </Seccion>

            <Seccion titulo="Desglose de actividades por Sector">
                <TablaCruzada filas={filas} agrupador={f => f.sector} etiquetaGrupo="Sector"
                              subagrupador={f => f.cliente} etiquetaSubgrupo="ID Cliente" />
            </Seccion>

            <Seccion titulo="Desglose de actividades por Cliente">
                <TablaCruzada filas={filas} agrupador={f => f.cliente} etiquetaGrupo="ID Cliente"
                              subagrupador={f => f.sector} etiquetaSubgrupo="Sector" />
            </Seccion>
        </div>
    );
}

/** Pestaña 3 — "Resumen: Evaluación": las mismas dos participaciones, fijas a Evaluación. */
function Evaluacion({ filas }: { filas: FilaReporteActividad[] }) {
    const porSector = useMemo(() => contarPor(filas, f => f.sector), [filas]);
    const porCliente = useMemo(() => contarPor(filas, f => f.cliente), [filas]);

    return (
        <div className="panel-body">
            <div className="tiles">
                <div className="tile">
                    <span className="tile-lbl">Evaluaciones</span>
                    <span className="tile-val">{filas.length}</span>
                </div>
            </div>

            <Seccion titulo="% Participación Sector">
                <Dona datos={porSector} />
            </Seccion>

            <Seccion titulo="% Participación Cliente">
                <Dona datos={porCliente} />
            </Seccion>

            <p className="ayuda">
                El original trae aquí además "% Participación Resultados" (Positiva/Negativa/No
                aplica). Esta app no captura ese resultado en ninguna parte todavía —agregarlo
                requiere un campo nuevo en el formulario de Evaluación—, así que no se muestra un
                dato que no existe.
            </p>
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
 * Tabla cruzada genérica: grupo → subgrupo, una columna por tipo de actividad, más Total.
 * Sirve tanto para "por Sector" (grupo=sector, subgrupo=cliente) como para "por Cliente"
 * (al revés) — es la misma pregunta mirada desde el otro lado.
 */
function TablaCruzada({ filas, agrupador, etiquetaGrupo, subagrupador, etiquetaSubgrupo }: {
    filas: FilaReporteActividad[];
    agrupador: (f: FilaReporteActividad) => string;
    etiquetaGrupo: string;
    subagrupador: (f: FilaReporteActividad) => string;
    etiquetaSubgrupo: string;
}) {
    const tipos = useMemo(() => [...new Set(filas.map(f => f.tipo))].filter(Boolean).sort(), [filas]);

    const filasCruzadas = useMemo(() => {
        const mapa = new Map<string, {
            grupo: string; subgrupo: string; porTipo: Map<string, number>; total: number;
        }>();

        for (const f of filas) {
            const grupo = agrupador(f) || '(sin dato)';
            const subgrupo = subagrupador(f) || '(sin dato)';
            const clave = `${grupo}··${subgrupo}`;
            if (!mapa.has(clave)) mapa.set(clave, { grupo, subgrupo, porTipo: new Map(), total: 0 });
            const fila = mapa.get(clave)!;
            fila.porTipo.set(f.tipo, (fila.porTipo.get(f.tipo) || 0) + 1);
            fila.total++;
        }

        // Grupos por su propio total (el sector/cliente más grande primero), y dentro de cada
        // grupo, el subgrupo más grande primero — mismo orden que trae el original.
        const totalDeGrupo = new Map<string, number>();
        for (const f of mapa.values()) totalDeGrupo.set(f.grupo, (totalDeGrupo.get(f.grupo) || 0) + f.total);

        return [...mapa.values()].sort((a, b) =>
            (totalDeGrupo.get(b.grupo)! - totalDeGrupo.get(a.grupo)!)
            || a.grupo.localeCompare(b.grupo, 'es')
            || b.total - a.total
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filas, tipos.join(',')]);

    let grupoAnterior: string | null = null;

    return (
        <div className="tabla-scroll">
            <table className="tabla">
                <thead>
                    <tr>
                        <th>{etiquetaGrupo}</th>
                        <th>{etiquetaSubgrupo}</th>
                        {tipos.map(t => <th className="num" key={t}>{t}</th>)}
                        <th className="num">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {filasCruzadas.map((f, i) => {
                        const mismoGrupo = f.grupo === grupoAnterior;
                        grupoAnterior = f.grupo;
                        return (
                            <tr key={i}>
                                <td>{mismoGrupo ? '' : f.grupo}</td>
                                <td>{f.subgrupo}</td>
                                {tipos.map(t => (
                                    <td className="num mono" key={t}>{f.porTipo.get(t) || '–'}</td>
                                ))}
                                <td className="num mono"><strong>{f.total}</strong></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
