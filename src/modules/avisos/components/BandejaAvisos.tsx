/**
 * Avisos: lo que un revisor te devolvió.
 *
 * Cuando alguien rechaza algo tuyo o pide que lo corrijas, aquí aparece con SU observación —qué
 * hay que resolver— y un acceso directo a la visita. Antes la observación se guardaba pero nadie
 * se la mostraba al educador, así que se enteraba por casualidad o nunca.
 *
 * "Ya lo corregí" quita el aviso de tu lista y de la insignia del menú; NO cierra la revisión:
 * el elemento sigue pendiente para el revisor hasta que él vuelva a revisarlo.
 */

import { useEffect, useMemo, useState } from 'react';
import {
    avisosAbiertos, avisosSinLeer, hayAvisosCargados, marcarAvisoLocal, marcarAvisos,
    datosFaltantes, pedirFechaDocumento, etiquetaVisita, fechaCorta, fechaHoraCorta,
    type Avisar, type DatoFaltante
} from '@core/puente';
import type { AvisoRevision } from '@core/tipos';
import { EstadoVacio } from '@shared/components/EstadoVacio';
import { Esqueleto } from '@shared/components/Esqueleto';
import { abrirVisita } from '@modules/visitas/montarDrawer';

export function BandejaAvisos({ avisar }: { avisar?: Avisar }) {
    const [version, setVersion] = useState(0);

    // El estado vive en js/avisos.js; este evento dice cuándo cambió (bajada nueva, marca local).
    useEffect(() => {
        const repintar = () => setVersion(v => v + 1);
        window.addEventListener('pdt:avisos', repintar);
        // Los datos que faltan se calculan sobre lo capturado aquí: cambian al guardar (p. ej. al
        // capturar la fecha), no cuando llega algo del servidor.
        window.addEventListener('pdt:visitas-guardadas', repintar);
        return () => {
            window.removeEventListener('pdt:avisos', repintar);
            window.removeEventListener('pdt:visitas-guardadas', repintar);
        };
    }, []);

    // Abrir la bandeja ES verlos: se marcan leídos para que dejen de avisar con la insignia y el
    // toast. Siguen en la lista hasta que se resuelvan.
    useEffect(() => {
        const sinLeer = avisosSinLeer().map(a => a.id);
        if (sinLeer.length === 0) return;
        marcarAvisoLocal(sinLeer, 'leido');
        void marcarAvisos(sinLeer, 'leido');
        // Solo al abrir: los que lleguen con la bandeja abierta se marcan en la siguiente visita.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // `version` es la dependencia real: el almacén no se puede observar de otra forma.
    const avisos = useMemo(() => avisosAbiertos(), [version]);   // eslint-disable-line react-hooks/exhaustive-deps
    const faltantes = useMemo(() => datosFaltantes(), [version]);   // eslint-disable-line react-hooks/exhaustive-deps
    const cargados = hayAvisosCargados();
    const total = avisos.length + faltantes.length;

    const resolver = async (a: AvisoRevision) => {
        marcarAvisoLocal([a.id], 'resuelto');
        const ok = await marcarAvisos([a.id], 'resuelto');
        if (!ok) avisar?.('Se quitó aquí; se confirmará cuando haya señal.', { estado: 'programada' });
    };

    return (
        <div className="vista vista-avisos">
            <header className="vista-head">
                <h2>Avisos</h2>
                <p className="eyebrow">
                    {!cargados && faltantes.length === 0 ? 'Buscando…'
                        : total === 0 ? 'Nada pendiente'
                        : `${total} por atender`}
                </p>
            </header>

            {faltantes.length > 0 && (
                <section className="avisos-grupo" aria-label="Te falta un dato">
                    <h3 className="campo-lbl">Te falta un dato · {faltantes.length}</h3>
                    <div className="revision-lista">
                        {faltantes.map(f => (
                            <TarjetaFaltante key={f.id} dato={f} avisar={avisar}
                                             onCambio={() => setVersion(v => v + 1)} />
                        ))}
                    </div>
                </section>
            )}

            {!cargados && faltantes.length === 0 ? (
                <Esqueleto etiqueta="Cargando avisos" />
            ) : !cargados ? null : total === 0 ? (
                <EstadoVacio
                    titulo="Todo en orden"
                    texto="Cuando un revisor rechace algo tuyo o pida una corrección, lo verás aquí con su observación."
                />
            ) : (
                <div className="revision-lista">
                    {avisos.map(a => <TarjetaAviso key={a.id} aviso={a} onResolver={() => resolver(a)} />)}
                </div>
            )}
        </div>
    );
}

/** Un dato que le falta a la persona (hoy: la fecha del documento de una evidencia). */
function TarjetaFaltante({ dato, avisar, onCambio }: { dato: DatoFaltante; avisar?: Avisar; onCambio: () => void }) {
    const donde = [etiquetaVisita(dato.visita), dato.visita.dia ? fechaCorta(dato.visita.dia) : '', dato.sector.nombre]
        .filter(Boolean).join(' · ');

    return (
        <article className="revision-card aviso-card es-faltante" aria-label={dato.titulo}>
            <div className="admin-fila">
                <span className="pill st-sin-registrar">Falta un dato</span>
                <span className="tipo-nombre">{dato.titulo}</span>
            </div>

            <p className="ayuda">{[dato.actividad.tipo, donde].filter(Boolean).join(' · ')}</p>
            <p className="aviso-detalle">{dato.detalle}</p>

            <div className="aviso-acciones">
                <button type="button" className="btn btn-principal"
                        onClick={() => pedirFechaDocumento(dato.actividad, { alCambiar: onCambio, alToast: avisar })}>
                    Poner la fecha
                </button>
                <button type="button" className="btn-txt" onClick={() => abrirVisita(dato.id_visita)}>
                    Abrir la visita
                </button>
            </div>
        </article>
    );
}

function TarjetaAviso({ aviso, onResolver }: { aviso: AvisoRevision; onResolver: () => void }) {
    const rechazo = aviso.resultado === 'rechazado';
    const donde = [aviso.cliente, aviso.hospital, aviso.dia_visita ? fechaCorta(aviso.dia_visita) : '']
        .filter(Boolean).join(' · ');

    return (
        <article className="revision-card aviso-card" aria-label={aviso.titulo}>
            <div className="admin-fila">
                <span className={'pill ' + (rechazo ? 'st-sin-registrar' : 'st-faltan-evidencias')}>
                    {aviso.etiqueta || 'Devuelto'}
                </span>
                <span className="tipo-nombre">{aviso.titulo}</span>
            </div>

            {donde && <p className="ayuda">{donde}</p>}

            <p className="aviso-detalle">
                {aviso.detalle
                    ? <><strong>{aviso.revisor || 'El revisor'} dice:</strong> {aviso.detalle}</>
                    : <em>El revisor no dejó observación.</em>}
            </p>

            <p className="ayuda">
                {aviso.revisor ? `${aviso.revisor} · ` : ''}{fechaHoraCorta(aviso.creado_en)}
            </p>

            <div className="aviso-acciones">
                {aviso.id_visita && (
                    <button type="button" className="btn btn-principal" onClick={() => abrirVisita(aviso.id_visita!)}>
                        Abrir la visita
                    </button>
                )}
                <button type="button" className="btn-txt" onClick={onResolver}>
                    Ya lo corregí
                </button>
            </div>
        </article>
    );
}
