/**
 * El formulario de una actividad en borrador.
 *
 * TODO lo que aparece sale de la configuración del tipo. No hay ni un `if` que decida a mano
 * si un campo se muestra o es obligatorio: eso vive en Administración, y por eso agregar un
 * requisito no toca este archivo.
 */

import { useMemo } from 'react';
import {
    MODOS, configuracionCampos, campoEditable, camposExtra,
    tiposActividad, areas, tiposEvidencia
} from '@core/puente';
import type { Actividad, Sector, Visita, ModoCampo } from '@core/tipos';

export interface PropsFormulario {
    visita: Visita;
    sector: Sector;
    actividad: Actividad;
    editar: (mutador: (a: Actividad) => void) => void;
    /** Campos marcados en rojo tras un intento de guardado fallido. */
    errores: Record<string, string>;
    onAgregarMaterial: () => void;
    onQuitarMaterial: (idMaterial: string) => void;
}

export function FormularioActividad({
    visita, sector, actividad, editar, errores, onAgregarMaterial, onQuitarMaterial
}: PropsFormulario) {
    const config = useMemo(() => configuracionCampos(actividad.tipo), [actividad.tipo]);

    const ver = (id: string) => config[id] !== MODOS.OCULTO;
    const editable = (id: string) => campoEditable(actividad.tipo, id);

    /** Un obligatorio se anuncia en su etiqueta, no solo al fallar el guardado. */
    const etiqueta = (texto: string, id: string) =>
        config[id] === MODOS.OBLIGATORIO ? `${texto} *` : texto;

    return (
        <div className="modal-body">
            <ContextoAutomatico visita={visita} sector={sector} />

            <SelectTipo
                actividad={actividad}
                error={errores.tipo}
                onCambio={(tipo) => editar(a => { a.tipo = tipo; })}
            />

            {/* La regla se DECLARA antes de que los campos aparezcan: el formulario no
                cambia por magia debajo de las manos de quien captura. */}
            <BarraRegla tipo={actividad.tipo} />

            {ver('area_visitada') && (
                <Campo etiqueta={etiqueta('Área visitada', 'area_visitada')} error={errores.area_visitada}>
                    {editable('area_visitada') ? (
                        <select
                            className="inp"
                            value={actividad.area_visitada || ''}
                            onChange={(e) => editar(a => { a.area_visitada = e.target.value; })}
                        >
                            <option value="">Elige…</option>
                            {areas().map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                    ) : (
                        <span className="dato-val">{actividad.area_visitada || '—'}</span>
                    )}
                </Campo>
            )}

            {ver('fecha_documento') && (
                <Campo etiqueta={etiqueta('Fecha del documento', 'fecha_documento')} error={errores.fecha_documento}>
                    {editable('fecha_documento') ? (
                        <input
                            type="date" className="inp"
                            value={actividad.fecha_documento || ''}
                            onChange={(e) => editar(a => { a.fecha_documento = e.target.value; })}
                        />
                    ) : (
                        <span className="dato-val">{actividad.fecha_documento || '—'}</span>
                    )}
                </Campo>
            )}

            <BloqueContacto
                actividad={actividad}
                config={config}
                editar={editar}
                errores={errores}
                etiqueta={etiqueta}
            />

            {ver('materiales') && (
                <BloqueMateriales
                    actividad={actividad}
                    error={errores.materiales}
                    onAgregar={onAgregarMaterial}
                    onQuitar={onQuitarMaterial}
                />
            )}

            {ver('tipo_evidencia') && (
                <Campo etiqueta={etiqueta('Tipo de evidencia', 'tipo_evidencia')} error={errores.tipo_evidencia}>
                    <select
                        className="inp"
                        value={actividad.evidencia?.tipo || ''}
                        onChange={(e) => editar(a => {
                            a.evidencia = { ...(a.evidencia ?? { estado: 'pendiente' }), tipo: e.target.value };
                        })}
                    >
                        <option value="">Elige…</option>
                        {tiposEvidencia().map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </Campo>
            )}

            {/*
              La evidencia NO se pide durante la captura. Exigir la foto aquí detiene al
              educador de pie frente al cliente por algo que puede resolverse en el coche, y
              el resultado real es que no registra nada.
            */}
            {ver('evidencia') && (
                <p className="ayuda">
                    {config.evidencia === MODOS.OBLIGATORIO
                        ? 'La evidencia se carga después de guardar; puede ser hoy o cuando haya señal.'
                        : 'Este tipo admite evidencia, pero no la exige.'}
                </p>
            )}
        </div>
    );
}

// ---------- piezas ----------

function Campo({ etiqueta, error, children }: {
    etiqueta: string; error?: string; children: React.ReactNode;
}) {
    return (
        <label className={'campo' + (error ? ' es-error' : '')}>
            <span className="campo-lbl">{etiqueta}</span>
            {children}
            {error && <span className="campo-error">{error}</span>}
        </label>
    );
}

/** Lo que la app ya sabe no se pregunta. Se muestra para dar contexto, en frío. */
function ContextoAutomatico({ visita, sector }: { visita: Visita; sector: Sector }) {
    const filas: Array<[string, string]> = [
        ['Educador', visita.educador || '—'],
        ['Cliente', visita.cliente || '—'],
        ['Sector', sector.nombre]
    ];

    return (
        <div className="ctx-auto">
            <span className="campo-lbl">Se registra automáticamente</span>
            <div className="datos">
                {filas.map(([k, v]) => (
                    <div className="dato" key={k}>
                        <span className="dato-lbl">{k}</span>
                        <span className="dato-val">{v}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SelectTipo({ actividad, error, onCambio }: {
    actividad: Actividad; error?: string; onCambio: (t: string) => void;
}) {
    const opciones = useMemo(() => tiposActividad().map(t => t.nombre), []);

    // Un tipo que ya no está en el catálogo se sigue mostrando: la actividad se capturó con
    // él, y esconderlo haría que el select apareciera vacío sin explicación.
    const huerfano = Boolean(actividad.tipo && !opciones.includes(actividad.tipo));

    return (
        <Campo etiqueta="Tipo de actividad" error={error}>
            <select className="inp" value={actividad.tipo || ''} onChange={(e) => onCambio(e.target.value)}>
                <option value="">Elige…</option>
                {huerfano && (
                    <option value={actividad.tipo}>{actividad.tipo} (ya no está en el catálogo)</option>
                )}
                {opciones.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
        </Campo>
    );
}

function BarraRegla({ tipo }: { tipo?: string }) {
    if (!tipo) return <p className="regla">ELIGE UN TIPO Y APARECERÁ LO QUE PIDE</p>;

    const partes = camposExtra(tipo).map(c => c.toUpperCase());
    if (partes.length === 0) return <p className="regla">ESTE TIPO NO PIDE NADA MÁS</p>;

    return <p className="regla es-activa">ESTE TIPO PIDE {partes.join(' · ')}</p>;
}

/**
 * Contacto responsable, uno POR ACTIVIDAD.
 *
 * Aunque sea la misma persona en varias, se guarda en cada una: quién atendió QUÉ es justo lo
 * que se querrá reportar después.
 */
function BloqueContacto({ actividad, config, editar, errores, etiqueta }: {
    actividad: Actividad;
    config: Record<string, ModoCampo>;
    editar: PropsFormulario['editar'];
    errores: Record<string, string>;
    etiqueta: (texto: string, id: string) => string;
}) {
    const partes = [
        { id: 'contacto_nombre', clave: 'nombre' as const, lbl: 'Nombre', ph: 'Dr. Juan Pérez' },
        { id: 'contacto_cargo', clave: 'cargo' as const, lbl: 'Cargo', ph: 'Jefa de piso' },
        { id: 'contacto_servicio', clave: 'servicio' as const, lbl: 'Servicio', ph: 'Quirófano' }
    ].filter(p => config[p.id] !== MODOS.OCULTO);

    // Si el tipo esconde los tres, el bloque entero sobra: un encabezado sin campos debajo se
    // lee como un error de la app.
    if (partes.length === 0) return null;

    const contacto = actividad.contacto || {};

    const entrada = (p: typeof partes[number]) => (
        <Campo key={p.id} etiqueta={etiqueta(p.lbl, p.id)} error={errores[p.id]}>
            {campoEditable(actividad.tipo, p.id) ? (
                <input
                    type="text" className="inp" placeholder={p.ph}
                    value={contacto[p.clave] || ''}
                    onChange={(e) => editar(a => {
                        a.contacto = { ...(a.contacto || {}), [p.clave]: e.target.value };
                    })}
                />
            ) : (
                <span className="dato-val">{contacto[p.clave] || '—'}</span>
            )}
        </Campo>
    );

    const nombre = partes.find(p => p.id === 'contacto_nombre');
    const resto = partes.filter(p => p.id !== 'contacto_nombre');

    return (
        <div className="contacto">
            <span className="campo-lbl">Contacto responsable</span>
            {/* El nombre va solo y los otros dos en pareja: es la jerarquía real del dato. */}
            {nombre && entrada(nombre)}
            {resto.length > 0 && (
                <div className={resto.length === 2 ? 'grid-2' : undefined}>
                    {resto.map(entrada)}
                </div>
            )}
        </div>
    );
}

function BloqueMateriales({ actividad, error, onAgregar, onQuitar }: {
    actividad: Actividad;
    error?: string;
    onAgregar: () => void;
    onQuitar: (id: string) => void;
}) {
    const materiales = actividad.materiales || [];

    return (
        <div className={'campo' + (error ? ' es-error' : '')}>
            <span className="campo-lbl">Materiales · {materiales.length}</span>

            {materiales.map(m => (
                <div className="mat-fila" key={m.id}>
                    <span className="mat-txt">
                        <span className="mat-nombre">{m.material}</span>
                        <span className="mat-meta mono">
                            {[[m.cantidad, m.unidad].filter(Boolean).join(' '), m.origen]
                                .filter(Boolean).join(' · ')}
                        </span>
                    </span>
                    {/* Mientras la actividad es borrador el material aún se quita; después ya no. */}
                    <button
                        type="button" className="icon-btn"
                        aria-label={`Quitar ${m.material}`}
                        onClick={() => onQuitar(m.id)}
                    >
                        ✕
                    </button>
                </div>
            ))}

            <button type="button" className="btn-dashed" onClick={onAgregar}>
                + Agregar material
            </button>

            {error && <span className="campo-error">{error}</span>}
        </div>
    );
}
