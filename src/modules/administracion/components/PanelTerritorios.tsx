/**
 * Territorios: qué zona es de qué educador, y quién más la cubre mientras tanto.
 *
 * Dos dimensiones distintas y por eso dos secciones separadas: TITULAR es fijo (una zona, un
 * dueño) y COBERTURA es temporal (una excepción con fecha, no un reemplazo). Confundirlas
 * volvería la rotación de zonas en un cambio de titular permanente cuando en realidad era una
 * cobertura de dos semanas.
 */

import { useMemo } from 'react';
import { zonasDelCatalogo } from '@core/puente';
import type { BorradorTerritorios } from '@core/tipos';
import {
    coberturaNueva, conCobertura, conTitular, sinCobertura, sinTitular
} from '../services/borradorTerritorios';

interface Props {
    borrador: BorradorTerritorios;
    cambiar: (fn: (b: BorradorTerritorios) => BorradorTerritorios) => void;
}

export function PanelTerritorios({ borrador, cambiar }: Props) {
    const zonas = useMemo(() => zonasDelCatalogo(), []);
    // Una zona ya asignada puede haber dejado de existir en el catálogo (cliente reasignado,
    // zona vieja) — se sigue mostrando para poder quitarla, no desaparece en silencio.
    const todasLasZonas = useMemo(() => {
        const asignadas = borrador.titulares.map(t => t.zona);
        return [...new Set([...zonas, ...asignadas])].sort((a, b) => a.localeCompare(b, 'es'));
    }, [zonas, borrador.titulares]);

    const titularDe = (zona: string) => borrador.titulares.find(t => t.zona === zona)?.educador_correo || '';

    return (
        <div className="campo">
            <span className="campo-lbl">Titulares de zona</span>
            <p className="ayuda">
                Cada zona le pertenece a un educador: solo él busca y ve el histórico de esos
                clientes por defecto. Deja el correo vacío para dejarla sin dueño.
            </p>

            {todasLasZonas.map(zona => (
                <div className="admin-fila" key={zona}>
                    <span className="mono" style={{ minWidth: 60 }}>{zona}</span>
                    <input
                        type="email"
                        className="inp mono"
                        placeholder="correo del titular…"
                        aria-label={`Titular de la zona ${zona}`}
                        value={titularDe(zona)}
                        onChange={(e) => cambiar(b => ({
                            ...b,
                            titulares: e.target.value.trim()
                                ? conTitular(b.titulares, zona, e.target.value)
                                : sinTitular(b.titulares, zona)
                        }))}
                    />
                </div>
            ))}

            <hr />

            <span className="campo-lbl">Coberturas temporales</span>
            <p className="ayuda">
                Alguien más cubre la zona de otro educador —vacaciones, rotación en curso— sin
                quitarle la titularidad. Sin fecha de fin, la cobertura queda indefinida.
            </p>

            {borrador.coberturas.map(c => (
                <div className="admin-fila-col" key={c.id}>
                    <div className="admin-fila">
                        <select
                            className="inp"
                            aria-label="Zona cubierta"
                            value={c.zona}
                            onChange={(e) => cambiar(b => ({
                                ...b, coberturas: conCobertura(b.coberturas, c.id, { zona: e.target.value })
                            }))}
                        >
                            <option value="">Elige la zona…</option>
                            {todasLasZonas.map(z => <option key={z} value={z}>{z}</option>)}
                        </select>
                        <input
                            type="email"
                            className="inp mono"
                            placeholder="correo de quien cubre…"
                            aria-label="Correo de quien cubre"
                            value={c.educador_correo}
                            onChange={(e) => cambiar(b => ({
                                ...b, coberturas: conCobertura(b.coberturas, c.id, { educador_correo: e.target.value })
                            }))}
                        />
                        <button
                            type="button" className="icon-btn" aria-label="Quitar esta cobertura"
                            onClick={() => cambiar(b => ({ ...b, coberturas: sinCobertura(b.coberturas, c.id) }))}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="admin-fila">
                        <label className="campo">
                            <span className="campo-lbl">Desde</span>
                            <input
                                type="date" className="inp mono"
                                value={c.desde.slice(0, 10)}
                                onChange={(e) => cambiar(b => ({
                                    ...b, coberturas: conCobertura(b.coberturas, c.id, { desde: e.target.value })
                                }))}
                            />
                        </label>
                        <label className="campo">
                            <span className="campo-lbl">Hasta (opcional)</span>
                            <input
                                type="date" className="inp mono"
                                value={c.hasta?.slice(0, 10) || ''}
                                onChange={(e) => cambiar(b => ({
                                    ...b, coberturas: conCobertura(b.coberturas, c.id, { hasta: e.target.value || null })
                                }))}
                            />
                        </label>
                        <label className="campo">
                            <span className="campo-lbl">Motivo</span>
                            <input
                                type="text" className="inp" placeholder="¿Por qué se cubre?"
                                value={c.motivo || ''}
                                onChange={(e) => cambiar(b => ({
                                    ...b, coberturas: conCobertura(b.coberturas, c.id, { motivo: e.target.value })
                                }))}
                            />
                        </label>
                    </div>
                </div>
            ))}

            <button
                type="button" className="btn-dashed"
                onClick={() => cambiar(b => ({ ...b, coberturas: [...b.coberturas, coberturaNueva()] }))}
            >
                + Agregar cobertura
            </button>
        </div>
    );
}
