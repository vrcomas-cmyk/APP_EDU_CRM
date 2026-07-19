/**
 * Un elemento de la cola, con todo lo que hace falta para juzgarlo sin salir de aquí.
 *
 * Ese es el criterio de qué entra: si el revisor tiene que abrir otra pantalla para decidir,
 * la revisión de veinte elementos se convierte en cuarenta navegaciones y deja de ocurrir.
 */

import {
    comentariosDeVisita, historialDe, miniaturaEvidencia, minutosDeRetraso
} from '@core/puente';
import type { FlujoRevision, PendienteRevision } from '@core/tipos';
import { Dato } from '@shared/components/Dato';
import { NodoVanilla } from '@shared/components/NodoVanilla';

import { AccionesRevision } from './AccionesRevision';
import { ComentariosDeVisita, HistorialRevisiones } from './LoYaDicho';

interface Props {
    flujo: FlujoRevision;
    item: PendienteRevision;
    onEnviar: (resultado: string, observaciones: string) => string | null;
}

export function TarjetaPendiente({ flujo, item, onEnviar }: Props) {
    const historial = historialDe(flujo.clave, item.id_ambito);
    const charla = comentariosDeVisita(item.id_visita);

    return (
        <div className="revision-card">
            <div className="revision-head">
                <div className="revision-head-txt">
                    <span className="revision-titulo">{item.titulo}</span>
                    <span className="revision-detalle">{item.detalle}</span>
                </div>

                {/* La evidencia se VE, no se describe: revisar veinte archivos abriendo veinte
                    pestañas es exactamente lo que hace que la revisión no ocurra. */}
                {item.actividad && (
                    <NodoVanilla
                        clave={item.actividad.id}
                        construir={() => miniaturaEvidencia(item.actividad!)}
                    />
                )}
            </div>

            <Contexto flujo={flujo} item={item} />

            <HistorialRevisiones flujo={flujo} historial={historial} />
            <ComentariosDeVisita charla={charla} />

            <AccionesRevision flujo={flujo} item={item} onEnviar={onEnviar} />
        </div>
    );
}

/**
 * El contexto cambia según lo que se revise: de una actividad importa dónde y con quién; de
 * una visita, cuánto duró y cuánto abarcó. Mostrar los seis campos siempre dejaría la mitad
 * vacíos, y una tarjeta medio vacía se lee peor que una corta.
 */
function Contexto({ flujo, item }: { flujo: FlujoRevision; item: PendienteRevision }) {
    const v = item.visita;

    return (
        <div className="datos revision-datos">
            <Dato etiqueta="Educador" valor={v.educador} />
            <Dato etiqueta="Cliente" valor={v.cliente} />
            <Dato etiqueta="Fecha" valor={v.dia} />

            {item.actividad ? (
                <>
                    <Dato etiqueta="Área visitada" valor={item.actividad.area_visitada} />
                    <Dato etiqueta="Contacto" valor={item.actividad.contacto?.nombre} />
                    <Dato etiqueta="Materiales" valor={String((item.actividad.materiales || []).length)} />
                </>
            ) : (
                <>
                    <Dato etiqueta="Horario" valor={`${v.hora_inicio || '—'}–${v.hora_fin || '—'}`} />
                    <Dato etiqueta="Sectores" valor={String((v.sectores || []).length)} />
                    {flujo.clave === 'retrasos' && (
                        <Dato etiqueta="Retraso" valor={`${minutosDeRetraso(v)} min`} />
                    )}
                </>
            )}
        </div>
    );
}
