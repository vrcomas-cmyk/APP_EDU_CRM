/**
 * Lo que quedó por resolver de una visita.
 *
 * Se crea al hacer check-out (`BloqueCheck.tsx`, "¿Tienes algún pendiente de esta visita?") y
 * vive aquí después, para no tener que volver a abrir esa visita solo para acordarse de qué
 * faltaba o para marcarlo resuelto.
 */

import { useMemo, useState } from 'react';
import { type Avisar } from '@core/puente';
import { ComboFiltro } from '@shared/components/ComboFiltro';
import { fechaCorta } from '@core/puente';
import { usePendientes } from '../hooks/usePendientes';
import type { Pendiente } from '@core/tipos';

type Tab = 'abiertos' | 'resueltos' | 'todos';

const TABS: Array<{ id: Tab; etiqueta: string }> = [
    { id: 'abiertos', etiqueta: 'Abiertos' },
    { id: 'resueltos', etiqueta: 'Resueltos' },
    { id: 'todos', etiqueta: 'Todos' }
];

interface Props {
    avisar?: Avisar;
}

export function Pendientes({ avisar }: Props) {
    const { pendientes, cargando, marcarResuelto } = usePendientes({ avisar });

    const [tab, setTab] = useState<Tab>('abiertos');
    const [cliente, setCliente] = useState('');
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');

    const clientes = useMemo(
        () => [...new Set(pendientes.map(p => p.cliente).filter((c): c is string => !!c))]
            .sort((a, b) => a.localeCompare(b, 'es')),
        [pendientes]
    );

    const filtrados = useMemo(() => pendientes.filter(p =>
        (tab === 'todos' || (tab === 'abiertos' ? p.estado === 'abierto' : p.estado === 'resuelto'))
        && (!cliente || p.cliente === cliente)
        && (!desde || (p.creado_en || '').slice(0, 10) >= desde)
        && (!hasta || (p.creado_en || '').slice(0, 10) <= hasta)
    ).sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || '')), [pendientes, tab, cliente, desde, hasta]);

    const abiertos = useMemo(() => pendientes.filter(p => p.estado === 'abierto').length, [pendientes]);
    const activos = [cliente, desde, hasta].filter(Boolean).length;

    return (
        <div className="vista vista-pendientes">
            <header className="vista-head">
                <h2>Pendientes</h2>
                <p className="eyebrow">
                    {abiertos === 0 ? 'Nada abierto' : `${abiertos} pendiente${abiertos === 1 ? '' : 's'} abierto${abiertos === 1 ? '' : 's'}`}
                </p>
            </header>

            <div className="seg" role="group" aria-label="Qué pendientes ver">
                {TABS.map(t => (
                    <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
                        {t.etiqueta}
                    </button>
                ))}
            </div>

            <div className="filtros">
                <ComboFiltro etiqueta="Cliente" valor={cliente} opciones={clientes} onCambiar={setCliente} />
                <label className="filtro">
                    <span className="campo-lbl">Desde</span>
                    <input type="date" className="inp" value={desde} onChange={(e) => setDesde(e.target.value)} />
                </label>
                <label className="filtro">
                    <span className="campo-lbl">Hasta</span>
                    <input type="date" className="inp" value={hasta} onChange={(e) => setHasta(e.target.value)} />
                </label>

                <div className="filtros-pie">
                    <span className="sector-cuenta">
                        {filtrados.length} registro{filtrados.length === 1 ? '' : 's'} en el resultado
                    </span>
                    {activos > 0 && (
                        <button type="button" className="btn-txt"
                                onClick={() => { setCliente(''); setDesde(''); setHasta(''); }}>
                            Limpiar {activos} filtro{activos === 1 ? '' : 's'}
                        </button>
                    )}
                </div>
            </div>

            {cargando && pendientes.length === 0 ? (
                <p className="ayuda">Cargando…</p>
            ) : filtrados.length === 0 ? (
                <div className="vacio-grande">
                    <p className="vacio-titulo">{tab === 'abiertos' ? 'Al día' : 'Nada que mostrar'}</p>
                    <p className="ayuda">
                        {tab === 'abiertos'
                            ? 'No hay pendientes abiertos.'
                            : 'Prueba ampliar el rango de fechas o quitar filtros.'}
                    </p>
                </div>
            ) : (
                <div className="revision-lista">
                    {filtrados.map(p => (
                        <TarjetaPendiente key={p.id} pendiente={p} onMarcar={(r) => marcarResuelto(p.id, r)} />
                    ))}
                </div>
            )}
        </div>
    );
}

function TarjetaPendiente({ pendiente, onMarcar }: { pendiente: Pendiente; onMarcar: (resuelto: boolean) => void }) {
    const resuelto = pendiente.estado === 'resuelto';

    return (
        <div className={'revision-card' + (resuelto ? ' es-resuelto' : '')}>
            <div className="admin-fila">
                <span className={'pill' + (resuelto ? ' st-completa' : ' st-sin-registrar')}>
                    {resuelto ? 'Resuelto' : 'Abierto'}
                </span>
                <span className="revision-titulo">
                    {pendiente.cliente || 'Sin cliente'}{pendiente.hospital ? ` · ${pendiente.hospital}` : ''}
                </span>
                <span style={{ flex: 1 }} />
                <span className="ayuda mono">{fechaCorta(pendiente.creado_en)}</span>
            </div>

            <p className="revision-detalle">{pendiente.descripcion}</p>

            <div className="admin-fila">
                <span className="ayuda">
                    {resuelto
                        ? `Resuelto por ${pendiente.resuelto_por || pendiente.resuelto_correo || '—'}`
                        : `Creado por ${pendiente.creado_por || pendiente.creado_correo || '—'}`}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn-txt" onClick={() => onMarcar(!resuelto)}>
                    {resuelto ? 'Reabrir' : 'Marcar resuelto'}
                </button>
            </div>
        </div>
    );
}
