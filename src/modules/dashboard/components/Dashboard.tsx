/**
 * El tablero. Deja de ser un modal y pasa a ser una vista: un modal es algo que interrumpe y
 * se cierra; un tablero es un sitio donde alguien se queda a trabajar.
 */

import { useCallback, useMemo, useState } from 'react';
import {
    consultarVisitas, calcularIndicadores, indicadoresPorEducador, filtroVacio, top,
    etiquetaEstado, ESTADOS_VISITA, revisionVigente,
    perfilActual, tieneEquipo, resultadoDe, type Filtro, type Indicadores
} from '@core/puente';

import { BarraFiltros } from './BarraFiltros';
import { Medidas, Barras, redondear, type Medida } from './Medidas';
import { TablaEducadores } from './TablaEducadores';
import type { Visita } from '@core/tipos';

const ETIQUETAS_ROL: Record<string, string> = {
    administrador: 'Administrador',
    gerente: 'Gerente',
    analista: 'Analista',
    educador: 'Educador Clínico'
};

export function Dashboard() {
    const [filtro, setFiltro] = useState<Filtro>(() => filtroVacio());

    const visitas = useMemo(() => consultarVisitas(filtro), [filtro]);
    const ind = useMemo(() => calcularIndicadores(visitas), [visitas]);
    const perfil = perfilActual();

    const cambiar = useCallback((clave: keyof Filtro, valor: string) => {
        setFiltro(f => ({ ...f, [clave]: valor }));
    }, []);

    return (
        <div className="vista vista-dashboard">
            <header className="vista-head">
                <h2>{tieneEquipo() ? 'Dashboard del equipo' : 'Mi dashboard'}</h2>
                <p className="eyebrow">
                    {perfil?.nombre || perfil?.correo || ''} · {ETIQUETAS_ROL[perfil?.rol || ''] || 'Educador Clínico'}
                </p>
            </header>

            <BarraFiltros
                filtro={filtro}
                visitas={visitas}
                onCambiar={cambiar}
                onLimpiar={() => setFiltro(filtroVacio())}
            />

            {visitas.length === 0 ? <Vacio /> : <Cuerpo ind={ind} visitas={visitas} />}
        </div>
    );
}

function Vacio() {
    return (
        <div className="vacio-grande">
            <p className="vacio-titulo">Nada que mostrar todavía</p>
            <p className="ayuda">
                Cuando guardes visitas —o cambies los filtros— los indicadores aparecen aquí.
            </p>
        </div>
    );
}

function Cuerpo({ ind, visitas }: { ind: Indicadores; visitas: Visita[] }) {
    /** Estas solo aparecen si hay de dónde: una gráfica con una sola barra no compara nada. */
    const magnitudes: Array<[string, Record<string, number>, string]> = [
        ['Actividades por tipo', ind.por_tipo, 'actividades'],
        ['Sectores más atendidos', ind.por_sector, 'sectores'],
        ['Clientes más visitados', ind.por_cliente, 'visitas'],
        ['Hospitales con más actividad', ind.por_hospital, 'visitas']
    ];

    const porEducador = tieneEquipo() ? top(ind.por_educador, 10) : [];

    // Sin memoizar, las tres se recalculaban en CADA render de `Cuerpo` —incluido cada tecla en
    // un filtro que ni siquiera las toca—. `contarNoAceptadas` es la más cara: por cada
    // actividad relee y concatena TODO el historial de revisión desde `localStorage`
    // (`todasLasRevisiones`), así que repetirla de más era un `JSON.parse` del historial
    // completo, veces cada actividad visible, en el hilo principal.
    const medidasEvidencia = useMemo(() => medidasDeEvidencia(ind, visitas), [ind, visitas]);
    const porEducadorTabla = useMemo(
        () => (tieneEquipo() ? indicadoresPorEducador(visitas) : []),
        [visitas]
    );

    return (
        <div className="panel-body">
            <Tiles ind={ind} />

            <Seccion titulo="Estado de las visitas">
                <Medidas modo="porcentaje" medidas={medidasDeEstado(ind)} />
            </Seccion>

            <Seccion titulo="Evidencias">
                <Medidas
                    modo="porcentaje"
                    medidas={medidasEvidencia}
                    vacio={<p className="ayuda">Ninguna actividad de este resultado exige evidencia.</p>}
                />
            </Seccion>

            {/* La vista gerencial: quién necesita ayuda. El promedio del equipo esconde justo
                al que se está quedando atrás, así que va desglosado por persona. */}
            {tieneEquipo() && (
                <Seccion titulo="Cumplimiento por educador">
                    <TablaEducadores filas={porEducadorTabla} />
                </Seccion>
            )}

            {magnitudes.map(([titulo, mapa, unidad]) => {
                const datos = top(mapa, 8);
                if (datos.length < 2) return null;
                return (
                    <Seccion titulo={titulo} key={titulo}>
                        <Barras datos={datos} unidad={unidad} />
                    </Seccion>
                );
            })}

            {porEducador.length >= 2 && (
                <Seccion titulo="Visitas por educador">
                    <Barras datos={porEducador} unidad="visitas" />
                </Seccion>
            )}
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

/**
 * Los números que se leen solos.
 *
 * Un indicador único no es una gráfica: dibujarle ejes lo haría más difícil de leer, no más
 * fácil.
 */
function Tiles({ ind }: { ind: Indicadores }) {
    const items: Array<[string, string | number, string]> = [
        ['Visitas', ind.visitas, ''],
        ['Realizadas', ind.realizadas, 'con check-in'],
        ['Pendientes', ind.pendientes, 'sin check-in'],
        ['Cumplimiento', `${ind.cumplimiento}%`, 'de lo no cancelado'],
        ['Actividades', ind.actividades, 'guardadas'],
        ['Evidencias pendientes', ind.evidencias_pendientes, ''],
        ['Sectores distintos', ind.sectores_distintos, ''],
        ['Material entregado', ind.piezas ? redondear(ind.piezas) : 0, `${ind.materiales} registros`],
        ['Horas efectivas', ind.horas_efectivas, 'en cliente'],
        ['Retrasos', ind.retrasos, 'más de 15 min'],
        ['Reagendaciones', ind.reagendaciones, ''],
        ['Cancelaciones', ind.canceladas, '']
    ];

    return (
        <div className="tiles">
            {items.map(([etiqueta, valor, nota]) => (
                <div className="tile" key={etiqueta}>
                    <span className="tile-lbl">{etiqueta}</span>
                    <span className="tile-val">{valor}</span>
                    {nota && <span className="tile-nota">{nota}</span>}
                </div>
            ))}
        </div>
    );
}

/** El estado del ciclo de vida se mapea a la cromía de salud que ya usa el calendario. */
function medidasDeEstado(ind: Indicadores): Medida[] {
    return [
        { nombre: etiquetaEstado(ESTADOS_VISITA.PROGRAMADA!), valor: ind.programadas,
          tono: 'programada', hueco: true },
        { nombre: etiquetaEstado(ESTADOS_VISITA.EN_PROCESO!), valor: ind.en_proceso,
          tono: 'faltan-evidencias' },
        { nombre: etiquetaEstado(ESTADOS_VISITA.FINALIZADA!), valor: ind.finalizadas,
          tono: 'completa' },
        { nombre: etiquetaEstado(ESTADOS_VISITA.CANCELADA!), valor: ind.canceladas,
          tono: 'cancelada' }
    ];
}

function medidasDeEvidencia(ind: Indicadores, visitas: Visita[]): Medida[] {
    return [
        { nombre: 'Cargadas', valor: ind.evidencias_subidas, tono: 'completa' },
        { nombre: 'Pendientes', valor: ind.evidencias_pendientes, tono: 'faltan-evidencias' },
        { nombre: 'Rechazadas o a corregir', valor: contarNoAceptadas(visitas), tono: 'sin-registrar' }
    ];
}

/**
 * Sale del flujo de REVISIÓN, no del árbol de la visita: "rechazada" es el juicio de una
 * persona sobre el archivo, no un estado del archivo.
 *
 * Se cuenta lo que un revisor NO dio por bueno, preguntándoselo al propio veredicto en vez de
 * enumerar cuáles son malos. Enumerarlos dejaba fuera, en silencio, cualquier resultado que un
 * flujo añadiera después.
 */
function contarNoAceptadas(visitas: Visita[]): number {
    let n = 0;

    for (const v of visitas) {
        for (const s of v.sectores || []) {
            for (const a of s.actividades || []) {
                const r = revisionVigente('evidencia', a.id);
                if (!r) continue;

                // Un veredicto que el flujo ya no reconoce no se cuenta como problema: no se
                // sabe qué quiso decir, y suponer lo peor infla el indicador sin motivo.
                const def = resultadoDe('evidencia', r.resultado);
                if (def && def.acepta === false) n++;
            }
        }
    }

    return n;
}
