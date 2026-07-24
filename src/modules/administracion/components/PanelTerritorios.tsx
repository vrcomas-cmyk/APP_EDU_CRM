/**
 * Territorios: qué zona es de qué educador, y quién más la cubre mientras tanto.
 *
 * Dos dimensiones distintas y por eso dos secciones separadas: TITULAR es fijo (una zona, un
 * dueño) y COBERTURA es temporal (una excepción con fecha, no un reemplazo). Confundirlas
 * volvería la rotación de zonas en un cambio de titular permanente cuando en realidad era una
 * cobertura de dos semanas.
 */

import { useCallback, useMemo } from 'react';
import { zonasDelCatalogo, ejecutivoDeZona, clientesDelCatalogo } from '@core/puente';
import { Combo, filtrar } from '@shared/components/Combo';
import type { BorradorTerritorios, UsuarioAdmin } from '@core/tipos';
import {
    coberturaNueva, conCobertura, conTitular, sinCobertura, sinTitular,
    excepcionNueva, conExcepcion, sinExcepcion
} from '../services/borradorTerritorios';

interface Props {
    borrador: BorradorTerritorios;
    cambiar: (fn: (b: BorradorTerritorios) => BorradorTerritorios) => void;
    /** Para el selector de responsable — los mismos usuarios que ya carga Accesos. */
    educadores: UsuarioAdmin[];
}

export function PanelTerritorios({ borrador, cambiar, educadores }: Props) {
    const zonas = useMemo(() => zonasDelCatalogo(), []);
    // Una zona ya asignada puede haber dejado de existir en el catálogo (cliente reasignado,
    // zona vieja) — se sigue mostrando para poder quitarla, no desaparece en silencio.
    const todasLasZonas = useMemo(() => {
        const asignadas = borrador.titulares.map(t => t.zona);
        return [...new Set([...zonas, ...asignadas])].sort((a, b) => a.localeCompare(b, 'es'));
    }, [zonas, borrador.titulares]);

    const titularDe = (zona: string) => borrador.titulares.find(t => t.zona === zona)?.educador_correo || '';

    // Activos primero y alfabético por nombre — es la lista de la que se elige el responsable.
    const opcionesEducador = useMemo(() => [...educadores].sort((a, b) => {
        if (a.activo !== b.activo) return a.activo ? -1 : 1;
        return (a.nombre || a.correo).localeCompare(b.nombre || b.correo, 'es');
    }), [educadores]);

    // El correo de un titular ya asignado puede no estar en la lista de usuarios (invitación
    // retirada, correo escrito antes de que existiera este selector) — se agrega como opción
    // suelta para no perder de vista a quién apunta hoy, aunque ya no se pueda re-elegir igual.
    const opcionesPara = (correoActual: string) => {
        if (!correoActual || opcionesEducador.some(u => u.correo.toLowerCase() === correoActual.toLowerCase())) {
            return opcionesEducador;
        }
        return [{ correo: correoActual, nombre: null, activo: false, roles: [], invitacion: null, jefes: [], subordinados: [] } as UsuarioAdmin, ...opcionesEducador];
    };

    // Cualquier cliente del catálogo, sin recortar por territorio: quien administra necesita
    // poder prestar la visibilidad de un cliente que no es de la zona de nadie más presente aquí.
    const clientes = useMemo(() => clientesDelCatalogo(), []);
    const opcionesCliente = useCallback((q: string) => filtrar(clientes, q), [clientes]);

    return (
        <div className="campo">
            <span className="campo-lbl">Titulares de zona</span>
            <p className="ayuda">
                Cada zona le pertenece a un educador: solo él busca y ve el histórico de esos
                clientes por defecto. Deja el correo vacío para dejarla sin dueño.
            </p>

            {todasLasZonas.map(zona => {
                const ejecutivo = ejecutivoDeZona(zona);
                const titular = titularDe(zona);
                return (
                    <div className="admin-fila" key={zona}>
                        <span className="mono" style={{ minWidth: 100 }}>
                            {zona}{ejecutivo ? ` · ${ejecutivo}` : ''}
                        </span>
                        <select
                            className="inp"
                            aria-label={`Titular de la zona ${zona}`}
                            value={titular}
                            onChange={(e) => cambiar(b => ({
                                ...b,
                                titulares: e.target.value
                                    ? conTitular(b.titulares, zona, e.target.value)
                                    : sinTitular(b.titulares, zona)
                            }))}
                        >
                            <option value="">Sin dueño</option>
                            {opcionesPara(titular).map(u => (
                                <option key={u.correo} value={u.correo}>
                                    {u.nombre || u.correo}{u.activo ? '' : ' (inactivo)'}
                                </option>
                            ))}
                        </select>
                    </div>
                );
            })}

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
                        <select
                            className="inp"
                            aria-label="Quien cubre"
                            value={c.educador_correo}
                            onChange={(e) => cambiar(b => ({
                                ...b, coberturas: conCobertura(b.coberturas, c.id, { educador_correo: e.target.value })
                            }))}
                        >
                            <option value="">Elige quién cubre…</option>
                            {opcionesPara(c.educador_correo).map(u => (
                                <option key={u.correo} value={u.correo}>
                                    {u.nombre || u.correo}{u.activo ? '' : ' (inactivo)'}
                                </option>
                            ))}
                        </select>
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

            <hr />

            <span className="campo-lbl">Excepciones por cliente</span>
            <p className="ayuda">
                Un cliente suelto, fuera de zona, que un educador necesita ver puntualmente —sin
                prestarle la zona completa. Pensado para casos contados, no para mover territorio.
            </p>

            {borrador.excepcionesCliente.map(e => (
                <div className="admin-fila-col" key={e.id}>
                    <div className="admin-fila">
                        <Combo
                            etiqueta="Cliente"
                            valor={e.cliente}
                            placeholder="Busca N° o razón social…"
                            opciones={opcionesCliente}
                            total={clientes.length}
                            onElegir={(v) => cambiar(b => ({
                                ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { cliente: v })
                            }))}
                            onEscribir={(v) => cambiar(b => ({
                                ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { cliente: v })
                            }))}
                        />
                        <select
                            className="inp"
                            aria-label="A quién se le presta"
                            value={e.educador_correo}
                            onChange={(ev) => cambiar(b => ({
                                ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { educador_correo: ev.target.value })
                            }))}
                        >
                            <option value="">Elige quién lo ve…</option>
                            {opcionesPara(e.educador_correo).map(u => (
                                <option key={u.correo} value={u.correo}>
                                    {u.nombre || u.correo}{u.activo ? '' : ' (inactivo)'}
                                </option>
                            ))}
                        </select>
                        <button
                            type="button" className="icon-btn" aria-label="Quitar esta excepción"
                            onClick={() => cambiar(b => ({ ...b, excepcionesCliente: sinExcepcion(b.excepcionesCliente, e.id) }))}
                        >
                            ✕
                        </button>
                    </div>
                    <div className="admin-fila">
                        <label className="campo">
                            <span className="campo-lbl">Desde</span>
                            <input
                                type="date" className="inp mono"
                                value={e.desde.slice(0, 10)}
                                onChange={(ev) => cambiar(b => ({
                                    ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { desde: ev.target.value })
                                }))}
                            />
                        </label>
                        <label className="campo">
                            <span className="campo-lbl">Hasta (opcional)</span>
                            <input
                                type="date" className="inp mono"
                                value={e.hasta?.slice(0, 10) || ''}
                                onChange={(ev) => cambiar(b => ({
                                    ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { hasta: ev.target.value || null })
                                }))}
                            />
                        </label>
                        <label className="campo">
                            <span className="campo-lbl">Motivo</span>
                            <input
                                type="text" className="inp" placeholder="¿Por qué se presta?"
                                value={e.motivo || ''}
                                onChange={(ev) => cambiar(b => ({
                                    ...b, excepcionesCliente: conExcepcion(b.excepcionesCliente, e.id, { motivo: ev.target.value })
                                }))}
                            />
                        </label>
                    </div>
                </div>
            ))}

            <button
                type="button" className="btn-dashed"
                onClick={() => cambiar(b => ({ ...b, excepcionesCliente: [...b.excepcionesCliente, excepcionNueva()] }))}
            >
                + Agregar excepción
            </button>
        </div>
    );
}
