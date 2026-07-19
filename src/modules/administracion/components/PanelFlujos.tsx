/**
 * Flujos de revisión: qué se revisa, con qué permiso, y con qué veredictos.
 *
 * Mismo patrón que `PanelRoles.tsx` — cada flujo es una ficha desplegable — porque el problema
 * es el mismo: con cinco o más flujos y varios veredictos cada uno, abrir todo de golpe da una
 * pared en la que no se encuentra nada.
 *
 * El `permiso` es texto libre y no un selector poblado desde el catálogo de capacidades: eso
 * evitaría una segunda ida de red solo para esta pantalla, a costa de no poder ofrecer un
 * `<select>`. El servidor (`pdt_flujo_guardar`) es quien de verdad valida que exista en
 * `pdt_capacidades` — el mismo criterio que ya usan los roles para sus capacidades.
 */

import { useState } from 'react';
import type { BorradorFlujos, FlujoAdmin, ResultadoFlujo } from '@core/tipos';
import { ChipToggle } from '@shared/components/ChipToggle';
import {
    conCampo, conNuevoResultado, conResultado, conVeredictosPropios, flujoNuevo, sinResultado
} from '../services/borradorFlujos';

interface Props {
    borrador: BorradorFlujos;
    cambiar: (fn: (b: BorradorFlujos) => BorradorFlujos) => void;
    confirmar: (mensaje: string) => boolean;
}

const TONOS = ['completa', 'sin-registrar', 'faltan-evidencias', 'programada'] as const;
const ESTILOS = ['principal', 'txt', 'peligro'] as const;

export function PanelFlujos({ borrador, cambiar, confirmar }: Props) {
    const [abierto, setAbierto] = useState<string | null>(null);

    const editarFlujo = (clave: string, fn: (f: FlujoAdmin) => FlujoAdmin) => {
        cambiar(b => ({ ...b, flujos: b.flujos.map(f => (f.clave === clave ? fn(f) : f)) }));
    };

    const borrarFlujo = (f: FlujoAdmin) => {
        if (f.revisiones > 0) {
            confirmar(`"${f.nombre}" ya tiene ${f.revisiones} revisión(es) guardadas. `
                + 'Desactívalo para que deje de ofrecerse en vez de borrarlo: borrarlo dejaría '
                + 'ese histórico sin flujo al que pertenecer.');
            return;
        }
        const ok = confirmar(`¿Borrar el flujo "${f.nombre}"? Esta acción no se puede deshacer.`);
        if (!ok) return;

        cambiar(b => ({ ...b, flujos: b.flujos.filter(x => x.clave !== f.clave) }));
        if (abierto === f.clave) setAbierto(null);
    };

    return (
        <div className="campo">
            <span className="campo-lbl">Flujos de revisión</span>
            <p className="ayuda">
                Cada flujo es un criterio independiente (evidencias, calidad, retrasos…) con su
                propio permiso y sus propios veredictos. Qué elementos entran a la cola de cada
                flujo no se edita aquí: depende de la visita misma, no de una preferencia.
            </p>

            {borrador.flujos.map(f => (
                <FichaFlujo
                    key={f.clave || f.nombre}
                    flujo={f}
                    abierta={abierto === f.clave}
                    onAbrir={(v) => setAbierto(v ? f.clave : null)}
                    onCambiar={(fn) => editarFlujo(f.clave, fn)}
                    onBorrar={() => borrarFlujo(f)}
                />
            ))}

            <button
                type="button"
                className="btn-dashed"
                onClick={() => {
                    const nuevo = flujoNuevo();
                    cambiar(b => ({ ...b, flujos: [...b.flujos, nuevo] }));
                    setAbierto(nuevo.clave);
                }}
            >
                + Nuevo flujo
            </button>
        </div>
    );
}

interface FichaProps {
    flujo: FlujoAdmin;
    abierta: boolean;
    onAbrir: (abierta: boolean) => void;
    onCambiar: (fn: (f: FlujoAdmin) => FlujoAdmin) => void;
    onBorrar: () => void;
}

function FichaFlujo({ flujo, abierta, onAbrir, onCambiar, onBorrar }: FichaProps) {
    const propios = flujo.resultados !== null;

    return (
        <details
            className="tipo-ficha"
            open={abierta}
            onToggle={e => onAbrir((e.currentTarget as HTMLDetailsElement).open)}
        >
            <summary className="tipo-sum">
                <span className={'tipo-nombre' + (flujo.nombre ? '' : ' es-vacio')}>
                    {flujo.nombre || 'Flujo sin nombre'}
                </span>
                <span className="sector-cuenta">
                    {flujo.revisiones} revisión{flujo.revisiones === 1 ? '' : 'es'}
                    {!flujo.activo && ' · inactivo'}
                </span>
            </summary>

            <div className="tipo-cuerpo">
                <div className="admin-fila">
                    <input
                        type="text"
                        className="inp"
                        placeholder="Nombre visible"
                        aria-label={`Nombre del flujo ${flujo.nombre}`}
                        value={flujo.nombre}
                        onChange={e => onCambiar(f => conCampo(f, 'nombre', e.target.value))}
                    />
                    <input
                        type="text"
                        className="inp mono"
                        placeholder="clave_del_flujo"
                        aria-label={`Clave del flujo ${flujo.nombre}`}
                        value={flujo.clave}
                        disabled={flujo.revisiones > 0}
                        title={flujo.revisiones > 0
                            ? 'Ya tiene revisiones guardadas con esta clave; cambiarla las dejaría huérfanas.'
                            : undefined}
                        onChange={e => onCambiar(f => conCampo(f, 'clave', e.target.value.trim().toLowerCase()))}
                    />
                    <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Borrar ${flujo.nombre || 'flujo'}`}
                        onClick={onBorrar}
                        disabled={flujo.revisiones > 0}
                        title={flujo.revisiones > 0 ? 'Ya tiene revisiones guardadas; desactívalo en su lugar' : 'Borrar'}
                    >
                        ✕
                    </button>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Descripción</span>
                    <input
                        type="text"
                        className="inp"
                        aria-label={`Descripción del flujo ${flujo.nombre}`}
                        value={flujo.descripcion || ''}
                        onChange={e => onCambiar(f => conCampo(f, 'descripcion', e.target.value || null))}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Ámbito</span>
                    <select
                        className="inp"
                        aria-label={`Ámbito del flujo ${flujo.nombre}`}
                        value={flujo.ambito}
                        onChange={e => onCambiar(f => conCampo(f, 'ambito', e.target.value as FlujoAdmin['ambito']))}
                    >
                        <option value="visita">Visita</option>
                        <option value="actividad">Actividad</option>
                    </select>
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Permiso</span>
                    <input
                        type="text"
                        className="inp mono"
                        placeholder="modulo.accion"
                        aria-label={`Permiso del flujo ${flujo.nombre}`}
                        value={flujo.permiso}
                        onChange={e => onCambiar(f => conCampo(f, 'permiso', e.target.value.trim()))}
                    />
                </div>
                <p className="ayuda">Debe existir en el catálogo de capacidades (Accesos → Roles), p. ej. «visitas.calificar».</p>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Orden</span>
                    <input
                        type="number"
                        className="inp mono"
                        aria-label={`Orden del flujo ${flujo.nombre}`}
                        value={flujo.orden}
                        onChange={e => onCambiar(f => conCampo(f, 'orden', Number(e.target.value) || 0))}
                    />
                </div>

                <div className="campo-fila">
                    <span className="campo-fila-lbl">Activo</span>
                    <ChipToggle
                        etiqueta={flujo.activo ? 'Activo' : 'Inactivo'}
                        activo={flujo.activo}
                        onCambiar={(v) => onCambiar(f => conCampo(f, 'activo', v))}
                    />
                </div>

                <span className="campo-lbl" style={{ marginTop: 10 }}>Veredictos</span>
                <div className="campo-fila">
                    <span className="campo-fila-lbl">Veredictos propios</span>
                    <ChipToggle
                        etiqueta={propios ? 'Personalizados' : 'Los 3 de siempre'}
                        activo={propios}
                        onCambiar={(v) => onCambiar(f => conVeredictosPropios(f, v))}
                    />
                </div>
                {!propios && (
                    <p className="ayuda">
                        Sin veredictos propios, este flujo usa Aprobado / Rechazado / Requiere
                        corrección.
                    </p>
                )}

                {propios && (flujo.resultados || []).map((r, i) => (
                    <FilaVeredicto
                        key={i}
                        resultado={r}
                        onCambiar={(campo, valor) => onCambiar(f => conResultado(f, i, campo, valor))}
                        onQuitar={() => onCambiar(f => sinResultado(f, i))}
                    />
                ))}
                {propios && (
                    <button
                        type="button"
                        className="btn-dashed"
                        onClick={() => onCambiar(f => conNuevoResultado(f))}
                    >
                        + Agregar veredicto
                    </button>
                )}
            </div>
        </details>
    );
}

function FilaVeredicto({ resultado, onCambiar, onQuitar }: {
    resultado: ResultadoFlujo;
    onCambiar: (campo: keyof ResultadoFlujo, valor: unknown) => void;
    onQuitar: () => void;
}) {
    return (
        <div className="admin-fila-col veredicto-fila">
            <div className="admin-fila">
                <input
                    type="text"
                    className="inp mono"
                    placeholder="valor"
                    aria-label="Valor del veredicto"
                    value={resultado.valor}
                    onChange={e => onCambiar('valor', e.target.value.trim())}
                />
                <input
                    type="text"
                    className="inp"
                    placeholder="Etiqueta (ej. Efectiva)"
                    aria-label="Etiqueta del veredicto"
                    value={resultado.etiqueta}
                    onChange={e => onCambiar('etiqueta', e.target.value)}
                />
                <input
                    type="text"
                    className="inp"
                    placeholder="Botón (ej. ✓ Efectiva)"
                    aria-label="Texto del botón"
                    value={resultado.accion}
                    onChange={e => onCambiar('accion', e.target.value)}
                />
                <button type="button" className="icon-btn" aria-label="Quitar veredicto" onClick={onQuitar}>
                    ✕
                </button>
            </div>

            <div className="admin-fila">
                <select
                    className="inp"
                    aria-label="Tono del veredicto"
                    value={resultado.tono}
                    onChange={e => onCambiar('tono', e.target.value)}
                >
                    {TONOS.map(t => <option value={t} key={t}>{t}</option>)}
                </select>
                <select
                    className="inp"
                    aria-label="Estilo del botón"
                    value={resultado.estilo || 'txt'}
                    onChange={e => onCambiar('estilo', e.target.value)}
                >
                    {ESTILOS.map(e => <option value={e} key={e}>{e}</option>)}
                </select>
            </div>

            <div className="chips">
                <ChipToggle
                    etiqueta="Exige observaciones"
                    activo={Boolean(resultado.exige_observaciones)}
                    onCambiar={(v) => onCambiar('exige_observaciones', v)}
                />
                <ChipToggle
                    etiqueta="Acepta el trabajo"
                    activo={Boolean(resultado.acepta)}
                    onCambiar={(v) => onCambiar('acepta', v)}
                />
                <ChipToggle
                    etiqueta="Cierra la revisión"
                    activo={Boolean(resultado.cierra)}
                    onCambiar={(v) => onCambiar('cierra', v)}
                />
            </div>
        </div>
    );
}
