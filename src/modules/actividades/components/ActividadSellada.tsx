/**
 * Una actividad ya guardada: los datos, en frío.
 *
 * No hay formulario y no es un olvido. La actividad afirma que alguien hizo algo, en un lugar,
 * con una persona, a una hora. Un campo que se reescribe en silencio no prueba nada — lo que
 * se corrige sin dejar rastro deja de servir para auditar, y estas filas alimentan indicadores.
 * Si hubo un error, la salida es registrar una actividad nueva, no reescribir la historia.
 *
 * La evidencia es la excepción y no contradice lo anterior: no cambia lo que se afirma, lo
 * respalda. Por eso sigue viva después del sello y puede cargarse días después.
 */

import { useState } from 'react';
import { campoVisible, fechaCorta } from '@core/puente';
import { NodoVanilla } from '@shared/components/NodoVanilla';
import { textoDelSello } from '../services/fabricas';
import type { Actividad, Sector, Visita, Material } from '@core/tipos';
import { Dato } from '@shared/components/Dato';

export interface PropsSellada {
    visita: Visita;
    sector: Sector;
    actividad: Actividad;
    /** Construyen nodos de módulos todavía vanilla. */
    construirEvidencia: () => Node | null;
    construirComentarios: () => Node | null;
    onCerrar: () => void;
    /** Solo si `resultado_seguimiento` sigue vacío: permite completarlo después de sellar,
     *  la misma excepción que ya tiene la evidencia (ver el comentario del archivo). */
    onGuardarResultadoSeguimiento?: (texto: string) => void;
}

export function ActividadSellada({
    visita, sector, actividad, construirEvidencia, construirComentarios, onCerrar,
    onGuardarResultadoSeguimiento
}: PropsSellada) {
    const contacto = actividad.contacto || {};
    const materiales = actividad.materiales || [];
    const tieneContacto = Boolean(contacto.nombre || contacto.cargo || contacto.servicio);

    return (
        <div className="modal-body">
            <div className="sello es-guardada">
                <span className="sello-ico">✓</span>
                <span className="sello-txt">{textoDelSello(actividad.guardada)}</span>
            </div>

            <div className="datos">
                <Dato etiqueta="Tipo de actividad" valor={actividad.tipo} />
                <Dato etiqueta="Área visitada" valor={actividad.area_visitada} />
                <Dato etiqueta="Sector" valor={sector.nombre} />
                <Dato etiqueta="Educador" valor={visita.educador} />
                <Dato etiqueta="Cliente" valor={visita.cliente} />
                <Dato etiqueta="Hospital" valor={visita.hospital} />
                {actividad.fecha_documento && (
                    <Dato etiqueta="Fecha del documento" valor={fechaCorta(actividad.fecha_documento)} />
                )}
                {actividad.evidencia?.tipo && (
                    <Dato etiqueta="Tipo de evidencia" valor={actividad.evidencia.tipo} />
                )}
            </div>

            {tieneContacto && (
                <Seccion titulo="Contacto responsable">
                    <div className="datos">
                        <Dato etiqueta="Nombre" valor={contacto.nombre} />
                        <Dato etiqueta="Cargo" valor={contacto.cargo} />
                        <Dato etiqueta="Servicio" valor={contacto.servicio} />
                    </div>
                </Seccion>
            )}

            {materiales.length > 0 && (
                <Seccion titulo={`Materiales · ${materiales.length}`}>
                    {materiales.map(m => <FilaMaterial material={m} key={m.id} />)}
                </Seccion>
            )}

            {campoVisible(actividad.tipo, 'resultado_seguimiento') && (
                <Seccion titulo="Resultado del seguimiento">
                    {actividad.resultado_seguimiento ? (
                        <p className="dato-val">{actividad.resultado_seguimiento}</p>
                    ) : onGuardarResultadoSeguimiento ? (
                        <ResultadoSeguimiento onGuardar={onGuardarResultadoSeguimiento} />
                    ) : (
                        <p className="dato-val">—</p>
                    )}
                </Seccion>
            )}

            {campoVisible(actividad.tipo, 'evidencia') && (
                <Seccion titulo="Evidencia">
                    {/* La miniatura y el control vienen del módulo de evidencias, todavía
                        vanilla. Quien revisa quiere VER el archivo, no leer su nombre. */}
                    <NodoVanilla
                        className="evid"
                        construir={construirEvidencia}
                        clave={`${actividad.id}:${actividad.evidencia?.estado}:${actividad.evidencia?.url}`}
                    />
                </Seccion>
            )}

            <Seccion titulo="Comentarios">
                <NodoVanilla construir={construirComentarios} clave={actividad.id} />
            </Seccion>

            <div className="modal-foot">
                <span style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={onCerrar}>Listo</button>
            </div>
        </div>
    );
}

/**
 * La única excepción además de la evidencia: un campo que se puede llenar sobre una actividad
 * ya sellada. No reescribe lo que la actividad afirmó (tipo, contacto, materiales) — solo
 * completa un dato que a propósito se dejó pendiente al guardar.
 */
function ResultadoSeguimiento({ onGuardar }: { onGuardar: (texto: string) => void }) {
    const [texto, setTexto] = useState('');

    return (
        <div className="campo">
            <textarea
                className="inp" rows={3}
                placeholder="Qué resultó de este seguimiento…"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
            />
            <button
                type="button" className="btn-dashed"
                disabled={!texto.trim()}
                onClick={() => onGuardar(texto.trim())}
            >
                Guardar resultado
            </button>
        </div>
    );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
    return (
        <div className="campo">
            <span className="campo-lbl">{titulo}</span>
            {children}
        </div>
    );
}

function FilaMaterial({ material }: { material: Material }) {
    const meta = [
        [material.cantidad, material.unidad].filter(Boolean).join(' '),
        material.origen
    ].filter(Boolean).join(' · ');

    return (
        <div className="mat-fila es-sellada">
            <span className="mat-txt">
                <span className="mat-nombre">{material.material}</span>
                <span className="mat-meta mono">{meta}</span>
            </span>
        </div>
    );
}
