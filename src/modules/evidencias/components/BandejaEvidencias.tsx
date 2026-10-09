/**
 * La bandeja de evidencias: todo lo que falta por respaldar con un archivo, en un solo lugar.
 *
 * Antes el chip de la barra solo decía "La bandeja llega en el paso siguiente". Aquí se ve qué
 * falta, qué ya está subiendo, qué espera señal y qué falló (con el motivo), y cada fila tiene el
 * mismo control que el de la actividad: adjuntar, "Subir ahora" (forzar) y quitar.
 *
 * La subida es AUTOMÁTICA (al adjuntar, al volver la señal, cada minuto): esta pantalla no
 * existe para que alguien tenga que forzar nada, sino para que se vea qué pasa y se pueda
 * reintentar a mano si algo se atoró.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    deudaGlobal, progresoSubidaEvidencias, evidenciasSinArchivoLocal, etiquetaVisita, fechaCorta,
    fechaDocumentoFaltante, type Avisar
} from '@core/puente';
import type { Actividad, Sector, Visita } from '@core/tipos';
import { NodoVanilla } from '@shared/components/NodoVanilla';
import { EstadoVacio } from '@shared/components/EstadoVacio';
import { abrirVisita } from '@modules/visitas/montarDrawer';

import { controlEvidencia } from '../../../../js/evidencias.js';
import { miniaturaEvidencia } from '../../../../js/vistaprevia.js';

interface Entrada { visita: Visita; sector: Sector; actividad: Actividad; }

interface Props { avisar?: Avisar; }

const EVENTOS = ['pdt:evidencia-progreso', 'pdt:visitas-guardadas', 'online', 'offline'];

export function BandejaEvidencias({ avisar }: Props) {
    const [version, setVersion] = useState(0);

    // El almacén no avisa por sí solo: se repinta con los mismos eventos que ya mueven el chip.
    useEffect(() => {
        const repintar = () => setVersion(v => v + 1);
        EVENTOS.forEach(e => window.addEventListener(e, repintar));
        return () => EVENTOS.forEach(e => window.removeEventListener(e, repintar));
    }, []);

    // `version` es la dependencia real: `deudaGlobal` lee de disco.
    const grupos = useMemo(() => {
        const sinArchivoAqui = evidenciasSinArchivoLocal();
        const subiendo = new Set(progresoSubidaEvidencias().subiendo);
        const g = { fecha: [] as Entrada[], subiendo: [] as Entrada[], error: [] as Entrada[], cola: [] as Entrada[],
                    otro: [] as Entrada[], falta: [] as Entrada[] };

        for (const e of deudaGlobal() as Entrada[]) {
            const ev = e.actividad.evidencia;
            if (ev?.estado !== 'local') g.falta.push(e);
            else if (fechaDocumentoFaltante(e.actividad)) g.fecha.push(e);
            else if (sinArchivoAqui.has(e.actividad.id)) g.otro.push(e);
            else if (subiendo.has(e.actividad.id)) g.subiendo.push(e);
            else if (ev.ultimo_error) g.error.push(e);
            else g.cola.push(e);
        }
        return g;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [version]);

    const progreso = progresoSubidaEvidencias();
    const total = Object.values(grupos).reduce((n, l) => n + l.length, 0);
    const porSubir = grupos.subiendo.length + grupos.error.length + grupos.cola.length;
    const enLinea = navigator.onLine;

    const subirTodo = () => {
        // app.js escucha esto y corre el ciclo completo con aviso al terminar.
        window.dispatchEvent(new CustomEvent('pdt:sincronizar', { detail: { manual: true } }));
    };

    return (
        <div className="vista vista-evidencias">
            <header className="vista-head">
                <h2>Evidencias</h2>
                <p className="eyebrow">
                    {total === 0
                        ? 'Todo respaldado'
                        : `${total} por resolver · ${grupos.falta.length} sin archivo · ${porSubir} por subir`
                        + (grupos.fecha.length ? ` · ${grupos.fecha.length} esperan la fecha del documento` : '')}
                </p>
            </header>

            {progreso.enCurso && progreso.total > 0 && (
                <div className="evid-progreso" role="status">
                    <progress max={progreso.total} value={progreso.hechas} />
                    <span>Subiendo {Math.min(progreso.hechas + 1, progreso.total)} de {progreso.total}…</span>
                </div>
            )}

            {porSubir > 0 && (
                <div className="evid-acciones">
                    <button type="button" className="btn btn-principal" onClick={subirTodo}
                            disabled={!enLinea || progreso.enCurso}>
                        {progreso.enCurso ? 'Subiendo…' : 'Subir todo ahora'}
                    </button>
                    {!enLinea && <span className="ayuda">Sin señal: se suben solas al recuperarla.</span>}
                </div>
            )}

            {total === 0 ? (
                <EstadoVacio titulo="Al día" texto="No hay evidencias pendientes ni por subir." />
            ) : (
                <>
                    <Grupo titulo="Falta la fecha del documento"
                           nota="Ya tienen archivo, pero no se suben hasta que captures la fecha del documento."
                           lista={grupos.fecha} avisar={avisar} onCambio={() => setVersion(v => v + 1)} />
                    <Grupo titulo="Con error" nota="No se pudieron subir; se reintentan solas. Puedes forzarlo."
                           lista={grupos.error} avisar={avisar} onCambio={() => setVersion(v => v + 1)} />
                    <Grupo titulo="Subiendo" lista={grupos.subiendo} avisar={avisar}
                           onCambio={() => setVersion(v => v + 1)} />
                    <Grupo titulo="En cola por subir" nota="Ya tienen archivo; suben solas con señal."
                           lista={grupos.cola} avisar={avisar} onCambio={() => setVersion(v => v + 1)} />
                    <Grupo titulo="Falta el archivo" nota="Solo tú puedes adjuntarlo: toma o elige la foto."
                           lista={grupos.falta} avisar={avisar} onCambio={() => setVersion(v => v + 1)} />
                    <Grupo titulo="Adjuntadas en otro dispositivo"
                           nota="El archivo está en el dispositivo donde se adjuntó; ahí se subirá."
                           lista={grupos.otro} avisar={avisar} onCambio={() => setVersion(v => v + 1)} />
                </>
            )}
        </div>
    );
}

function Grupo({ titulo, nota, lista, avisar, onCambio }: {
    titulo: string; nota?: string; lista: Entrada[]; avisar?: Avisar; onCambio: () => void;
}) {
    if (lista.length === 0) return null;

    return (
        <section className="evid-grupo">
            <h3 className="campo-lbl">{titulo} · {lista.length}</h3>
            {nota && <p className="ayuda">{nota}</p>}
            <div className="revision-lista">
                {lista.map(e => <Fila key={e.actividad.id} entrada={e} avisar={avisar} onCambio={onCambio} />)}
            </div>
        </section>
    );
}

function Fila({ entrada, avisar, onCambio }: { entrada: Entrada; avisar?: Avisar; onCambio: () => void }) {
    const { visita, sector, actividad } = entrada;
    const ev = actividad.evidencia;

    const contexto = [
        actividad.tipo || 'Actividad', sector.nombre, etiquetaVisita(visita), fechaCorta(visita.dia)
    ].filter(Boolean).join(' · ');

    return (
        <div className="revision-card evid-fila">
            <div className="admin-fila">
                <span className="tipo-nombre">{contexto}</span>
                <button type="button" className="btn-txt" onClick={() => abrirVisita(visita.id)}>
                    Abrir visita
                </button>
            </div>

            {ev?.ultimo_error && ev.estado === 'local' && (
                <p className="campo-error">
                    No subió ({ev.intentos || 1} intento{(ev.intentos || 1) === 1 ? '' : 's'}): {ev.ultimo_error}
                </p>
            )}

            <div className="evid-control">
                <NodoVanilla
                    construir={() => {
                        const fila = document.createDocumentFragment();
                        const mini = miniaturaEvidencia(actividad);
                        if (mini) fila.appendChild(mini);
                        fila.appendChild(controlEvidencia(actividad, {
                            alCambiar: onCambio, alToast: avisar
                        } as never));
                        return fila;
                    }}
                    clave={`${actividad.id}:${ev?.estado}:${ev?.ultimo_error ?? ''}:${ev?.intentos ?? 0}`}
                />
            </div>
        </div>
    );
}
