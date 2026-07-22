/**
 * Paleta de comandos (⌘K / Ctrl+K).
 *
 * Overlay centrado, no un drawer: aquí la pregunta es «¿a dónde voy?», no «¿dónde cabe esto?».
 * Combina acciones fijas con los clientes ya agendados, para saltar directo a una visita sin
 * ir a buscarla en el calendario.
 *
 * Sigue siendo modal —y no una vista— a propósito: interrumpe, se usa en dos segundos y
 * desaparece. Es lo contrario del tablero o de la bandeja de revisión.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { etiquetaDiaLarga } from '@core/puente';
import type { Visita } from '@core/tipos';
import { resultadosPorCliente } from '../services/busqueda';

export interface AccionPaleta {
    etiqueta: string;
    atajo: string;
    fn: () => void;
}

/**
 * Un atajo de teclado que se muestra —SOLO para descubrirlo— en la paleta vacía.
 * No se ejecuta: vive aquí porque un atajo que nadie conoce es igual que no existir.
 * La fuente real del comportamiento está en `js/app.js`, y la denominación se repite aquí
 * para que el panel sea honesto: incluir un atajo aquí y no implementarlo en `app.js`
 * (o al revés) se nota comparando con los que ya funcionan.
 */
export interface AtajoPaleta {
    tecla: string;
    descripcion: string;
}

interface Props {
    acciones: AccionPaleta[];
    /** Lista informativa de atajos de teclado; se pinta solo cuando la consulta está vacía. */
    atajos?: AtajoPaleta[];
    visitas: Visita[];
    onIrAVisita: (visita: Visita) => void;
    onCerrar: () => void;
}

interface Opcion {
    clave: string;
    etiqueta: string;
    meta: string;
    ejecutar: () => void;
}

export function Paleta({ acciones, atajos = [], visitas, onIrAVisita, onCerrar }: Props) {
    const [consulta, setConsulta] = useState('');
    const [activo, setActivo] = useState(0);
    const listaRef = useRef<HTMLDivElement>(null);
    const sinConsulta = !consulta.trim();

    const opciones = useMemo<Opcion[]>(() => {
        const q = consulta.trim().toLowerCase();

        const fijas = (q ? acciones.filter(a => a.etiqueta.toLowerCase().includes(q)) : acciones)
            .map(a => ({
                clave: `accion:${a.etiqueta}`,
                etiqueta: a.etiqueta,
                meta: a.atajo,
                ejecutar: a.fn
            }));

        // Los clientes solo aparecen al escribir: sin filtro serían la lista entera de visitas
        // y taparían las acciones, que son a lo que se viene la mayoría de las veces.
        const clientes = resultadosPorCliente(visitas, q).map(v => ({
            clave: `visita:${v.id}`,
            etiqueta: `${v.cliente || 'Sin cliente'} · ${v.hospital || 'Sin hospital'}`,
            meta: `${etiquetaDiaLarga(v.dia)} · ${v.hora_inicio || ''}`,
            ejecutar: () => onIrAVisita(v)
        }));

        return [...fijas, ...clientes];
    }, [consulta, acciones, visitas, onIrAVisita]);

    // Al cambiar la lista, la selección vuelve arriba: dejarla en el índice 3 sobre una lista
    // recién filtrada señalaría algo que la persona no eligió.
    useEffect(() => { setActivo(0); }, [consulta]);

    // Solo desplaza si hace falta; `block: 'nearest'` evita que la lista salte en cada tecla.
    useEffect(() => {
        listaRef.current?.querySelectorAll('.paleta-opt')[activo]
            ?.scrollIntoView({ block: 'nearest' });
    }, [activo]);

    /**
     * Escape cierra aunque el foco se haya ido del campo —al pulsar una opción con el ratón,
     * por ejemplo—. Va en captura para adelantarse al manejador del drawer, que si no
     * interpretaría el Escape como orden de cerrar la visita que hay debajo.
     */
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            onCerrar();
        };

        document.addEventListener('keydown', alTeclear, true);
        return () => document.removeEventListener('keydown', alTeclear, true);
    }, [onCerrar]);

    const enTecla = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (opciones.length === 0) return;
            // Da la vuelta: bajar desde el último lleva al primero. Con ocho opciones es más
            // rápido que subir siete veces.
            const paso = e.key === 'ArrowDown' ? 1 : -1;
            setActivo(i => (i + paso + opciones.length) % opciones.length);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            opciones[activo]?.ejecutar();
            return;
        }
    };

    return (
        <div className="paleta-raiz">
            <div className="scrim" onClick={onCerrar} />

            <div className="paleta" role="dialog" aria-modal="true" aria-label="Comandos">
                {/*
                  Patrón combobox: el foco NUNCA sale del campo —se sigue escribiendo mientras
                  se navega con las flechas— y `aria-activedescendant` es lo que le dice al
                  lector de pantalla cuál está seleccionada sin moverle el foco.
                */}
                <input
                    type="text"
                    className="paleta-inp"
                    placeholder="Ir a un cliente, crear una visita, cambiar de vista…"
                    aria-label="Buscar comando o cliente"
                    autoComplete="off"
                    autoFocus
                    role="combobox"
                    aria-expanded={opciones.length > 0}
                    aria-controls="paleta-lista"
                    aria-activedescendant={opciones[activo] ? `paleta-op-${activo}` : undefined}
                    value={consulta}
                    onChange={e => setConsulta(e.target.value)}
                    onKeyDown={enTecla}
                />

                <div className="paleta-lista" id="paleta-lista" role="listbox" ref={listaRef}>
                    {opciones.map((o, i) => (
                        <button
                            key={o.clave}
                            id={`paleta-op-${i}`}
                            type="button"
                            role="option"
                            aria-selected={i === activo}
                            className={'paleta-opt' + (i === activo ? ' is-active' : '')}
                            // El ratón mueve la selección al pasar por encima, para que Enter
                            // haga lo que se está mirando y no lo que se dejó con el teclado.
                            onMouseMove={() => setActivo(i)}
                            onClick={o.ejecutar}
                        >
                            <span className="t">{o.etiqueta}</span>
                            <span className="m mono">{o.meta}</span>
                        </button>
                    ))}

                    {/* "Sin resultados" es distinto de "vacía a propósito": solo aparece
                        quien escribió algo y no halló nada. Confundirlos fue un error UX
                        común (vacío = cargando = no hay) que ya corregimos en el Dashboard. */}
                    {opciones.length === 0 && !sinConsulta && (
                        <p className="ayuda paleta-vacio">Sin resultados.</p>
                    )}

                    {/* Panel de atajos: solo cuando la paleta acaba de abrirse. Si ya hay
                        resultados o una consulta, lo que importa es el filtro, no el cartel —
                        tapar la lista con un panel sería leer dos cosas a la vez. */}
                    {sinConsulta && atajos.length > 0 && (
                        <div className="paleta-atajos" aria-label="Atajos de teclado">
                            <p className="eyebrow paleta-atajos-titulo">Atajos</p>
                            <ul className="paleta-atajos-lista">
                                {atajos.map(a => (
                                    <li key={a.tecla}>
                                        <span className="paleta-atajo-desc">{a.descripcion}</span>
                                        <kbd className="mono">{a.tecla}</kbd>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
