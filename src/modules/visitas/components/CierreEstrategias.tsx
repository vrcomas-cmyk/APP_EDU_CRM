/**
 * Al terminar una visita: actualizar las estrategias que trabajó, sin entrar a su ficha.
 *
 *  - Visita con estrategias vinculadas: una tarjeta por estrategia (etapa, estatus, nota). Todo
 *    opcional: "Omitir" deja la visita terminada igual. Finalizar / Cerrar una estrategia NO se
 *    ofrece aquí (confunde con terminar la visita): solo vive en el módulo de Estrategias.
 *  - Visita sin estrategia (p. ej. agendada desde el calendario) en un cliente/sector que SÍ tiene
 *    una vigente: se recuerda vincularla y, si se vincula, se ofrece registrar el avance.
 *
 * Cada avance cae en la bitácora de la estrategia con la fecha de la visita.
 */

import { useMemo, useState } from 'react';
import {
    leerEstrategias, moverEtapaEstatus, sincronizarEstrategias, sesionActual,
    etapasEstrategia, estatusEstrategia, fechaCorta, type Avisar
} from '@core/puente';
import type { Estrategia, Visita } from '@core/tipos';
import {
    idsEstrategiasDe, fijarEstrategias, estrategiaVigente, estrategiasPendientesPara
} from '@modules/estrategias/services/vinculo';
import * as repo from '../repository/visitasRepo';

type Paso = 'vincular' | 'preguntar-avance' | 'avance';

interface Borrador { etapa: string; estatus: string; nota: string }

/** ¿Esta visita tiene estrategias vigentes vinculadas, o por vincular? Si no, no hay nada que preguntar. */
export function hayEstrategiasQueActualizar(visita: Visita): boolean {
    const v = repo.obtenerVisita(visita.id) ?? visita;
    const todas = leerEstrategias();
    const ids = idsEstrategiasDe(v);
    return todas.some(e => ids.includes(e.id) && estrategiaVigente(e))
        || estrategiasPendientesPara(v, todas).length > 0;
}

export function CierreEstrategias({ visita, avisar, onTerminar }: {
    visita: Visita;
    avisar: Avisar;
    onTerminar: () => void;
}) {
    // Se relee: el objeto que llega es el de antes del check-out.
    const actual = useMemo(() => repo.obtenerVisita(visita.id) ?? visita, [visita]);
    const todas = useMemo(() => leerEstrategias(), []);
    const inicialesIds = idsEstrategiasDe(actual);
    const vinculadasIni = todas.filter(e => inicialesIds.includes(e.id) && estrategiaVigente(e));
    const candidatas = useMemo(() => estrategiasPendientesPara(actual, todas), [actual, todas]);

    // `hayEstrategiasQueActualizar` ya filtró: aquí siempre hay vinculadas o candidatas.
    const [paso, setPaso] = useState<Paso>(vinculadasIni.length > 0 ? 'avance' : 'vincular');
    const [vinculadas, setVinculadas] = useState<Estrategia[]>(vinculadasIni);
    const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(candidatas.map(e => e.id)));

    const vincular = () => {
        const nuevas = candidatas.filter(e => elegidas.has(e.id));
        if (nuevas.length === 0) { onTerminar(); return; }
        const r = repo.actualizarVisita(visita.id, v => fijarEstrategias(v, [...idsEstrategiasDe(v), ...nuevas.map(e => e.id)]));
        if (!r) {
            avisar('No se pudo vincular la visita a la estrategia.', { estado: 'sin-registrar' });
            onTerminar();
            return;
        }
        avisar(`Visita vinculada a ${nuevas.length} estrategia${nuevas.length === 1 ? '' : 's'}.`, { estado: 'completa' });
        setVinculadas(nuevas);
        setPaso('preguntar-avance');
    };

    if (paso === 'vincular') {
        const sectores = [...new Set(candidatas.map(e => e.sector).filter(Boolean))];
        return (
            <div className="check cierre-estrategias">
                <p>
                    Tienes {candidatas.length === 1 ? 'una estrategia pendiente' : `${candidatas.length} estrategias pendientes`}
                    {sectores.length ? ` en ${sectores.join(', ')}` : ' con este cliente'}. ¿Deseas vincular esta visita
                    {candidatas.length === 1 ? ' a la estrategia' : ' a las estrategias'}?
                </p>
                <ul className="lista-actividades">
                    {candidatas.map(e => (
                        <li key={e.id}>
                            <label className="admin-fila">
                                <input
                                    type="checkbox" checked={elegidas.has(e.id)}
                                    onChange={() => setElegidas(prev => {
                                        const c = new Set(prev);
                                        if (c.has(e.id)) c.delete(e.id); else c.add(e.id);
                                        return c;
                                    })}
                                />
                                <span>{[e.tipo_estrategia, e.sector, e.grupo_articulo].filter(Boolean).join(' · ') || 'Estrategia'}</span>
                                {e.etapa && <span className="pill neutro">{e.etapa}</span>}
                            </label>
                        </li>
                    ))}
                </ul>
                <div className="admin-fila">
                    <button type="button" className="btn-txt" onClick={onTerminar}>No</button>
                    <button type="button" className="btn btn-check" disabled={elegidas.size === 0} onClick={vincular}>
                        Sí, vincular
                    </button>
                </div>
            </div>
        );
    }

    if (paso === 'preguntar-avance') {
        return (
            <div className="check cierre-estrategias">
                <p>¿Deseas registrar algún avance en la etapa o estatus de la estrategia?</p>
                <div className="admin-fila">
                    <button type="button" className="btn-txt" onClick={onTerminar}>No</button>
                    <button type="button" className="btn btn-check" onClick={() => setPaso('avance')}>Sí</button>
                </div>
            </div>
        );
    }

    return (
        <TarjetasAvance
            visita={actual} estrategias={vinculadas} avisar={avisar} onTerminar={onTerminar}
        />
    );
}

function TarjetasAvance({ visita, estrategias, avisar, onTerminar }: {
    visita: Visita;
    estrategias: Estrategia[];
    avisar: Avisar;
    onTerminar: () => void;
}) {
    const etapas = useMemo(() => etapasEstrategia(), []);
    const estatuses = useMemo(() => estatusEstrategia(), []);
    const [borradores, setBorradores] = useState<Record<string, Borrador>>(() =>
        Object.fromEntries(estrategias.map(e => [e.id, { etapa: e.etapa || '', estatus: e.estatus || 'Pendiente', nota: '' }]))
    );

    const cambio = (e: Estrategia) => {
        const b = borradores[e.id];
        return !!b && (b.etapa !== (e.etapa || '') || b.estatus !== (e.estatus || 'Pendiente') || b.nota.trim() !== '');
    };
    const hayCambios = estrategias.some(cambio);
    const actor = () => {
        const s = sesionActual();
        return { correo: s?.correo, nombre: s?.nombre };
    };
    const origen = `Visita del ${fechaCorta(visita.dia)}`;

    const guardar = () => {
        let n = 0;
        for (const e of estrategias) {
            if (!cambio(e)) continue;
            const b = borradores[e.id]!;
            moverEtapaEstatus(e.id, {
                etapa: b.etapa, estatus: b.estatus,
                nota: b.nota.trim() ? `${origen}: ${b.nota.trim()}` : origen
            }, actor());
            n++;
        }
        if (n) {
            avisar(`Avance registrado en ${n} estrategia${n === 1 ? '' : 's'}.`, { estado: 'completa' });
            sincronizarEstrategias().catch(() => {});
        }
        onTerminar();
    };

    return (
        <div className="check cierre-estrategias">
            <p className="campo-lbl">Actualiza tus estrategias</p>
            <p className="ayuda">Todo es opcional. Lo que registres queda en la bitácora de cada estrategia.</p>

            {estrategias.map(e => {
                const b = borradores[e.id]!;
                const poner = (c: Partial<Borrador>) => setBorradores(m => ({ ...m, [e.id]: { ...b, ...c } }));
                return (
                    <section className="tarjeta-sector" key={e.id}>
                        <div className="tarjeta-sector-cab">
                            <span>{[e.tipo_estrategia, e.sector, e.grupo_articulo].filter(Boolean).join(' · ') || 'Estrategia'}</span>
                        </div>
                        <div className="sub-grupo">
                                <div className="grid-2">
                                    <label className="campo">
                                        <span className="campo-lbl">Etapa</span>
                                        <select className="inp" value={b.etapa} onChange={(ev) => poner({ etapa: ev.target.value })}>
                                            <option value="">Sin definir</option>
                                            {etapas.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </label>
                                    <label className="campo">
                                        <span className="campo-lbl">Estatus</span>
                                        <select className="inp" value={b.estatus} onChange={(ev) => poner({ estatus: ev.target.value })}>
                                            {estatuses.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                    </label>
                                </div>
                                <input
                                    type="text" className="inp" placeholder="Nota del avance (opcional)"
                                    value={b.nota} onChange={(ev) => poner({ nota: ev.target.value })}
                                />
                        </div>
                    </section>
                );
            })}

            <div className="admin-fila">
                <button type="button" className="btn-txt" onClick={onTerminar}>Omitir</button>
                <button type="button" className="btn btn-check" disabled={!hayCambios} onClick={guardar}>
                    Guardar avance
                </button>
            </div>
        </div>
    );
}
