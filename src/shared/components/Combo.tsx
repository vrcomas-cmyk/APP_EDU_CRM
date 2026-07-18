/**
 * Combobox con filtro y navegación por teclado.
 *
 * Compartido porque lo usan cliente, hospital y —cuando se porten— varios campos más. Las
 * opciones llegan por función, no por arreglo: el catálogo de clientes tiene ~11,500 entradas
 * y pintarlas todas en el DOM congela un teléfono de gama media. Quien lo usa decide cómo
 * recorta; este componente solo muestra lo que le den.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const MAX_SUGERENCIAS = 60;

export interface PropsCombo {
    etiqueta: string;
    valor: string;
    placeholder?: string;
    /** Devuelve las coincidencias YA recortadas. */
    opciones: (consulta: string) => string[];
    onElegir: (valor: string) => void;
    onEscribir: (texto: string) => void;
    ayuda?: string | null;
    /** Total del catálogo, para poder decir "de cuántos" sin pintarlos. */
    total?: number;
    autoFocus?: boolean;
}

/** Parte el texto en trozos marcando la coincidencia, para resaltarla sin usar innerHTML. */
function resaltar(texto: string, consulta: string) {
    const q = consulta.trim();
    if (!q) return [{ texto, marcado: false }];

    const i = texto.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return [{ texto, marcado: false }];

    return [
        { texto: texto.slice(0, i), marcado: false },
        { texto: texto.slice(i, i + q.length), marcado: true },
        { texto: texto.slice(i + q.length), marcado: false }
    ].filter(p => p.texto !== '');
}

export function Combo({
    etiqueta, valor, placeholder, opciones, onElegir, onEscribir,
    ayuda, total, autoFocus
}: PropsCombo) {
    const [abierto, setAbierto] = useState(false);
    const [activo, setActivo] = useState(-1);
    const [consulta, setConsulta] = useState(valor);

    const cajaRef = useRef<HTMLDivElement>(null);
    const cierreDiferido = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    // El valor puede cambiar desde fuera (elegir en otra pantalla, refrescar tras guardar).
    useEffect(() => { setConsulta(valor); }, [valor]);

    useEffect(() => () => clearTimeout(cierreDiferido.current), []);

    const resultados = useMemo(
        () => (abierto ? opciones(consulta.trim()) : []),
        [abierto, consulta, opciones]
    );

    const cerrar = useCallback(() => { setAbierto(false); setActivo(-1); }, []);

    const elegir = useCallback((op: string) => {
        setConsulta(op);
        onElegir(op);
        cerrar();
    }, [onElegir, cerrar]);

    function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!abierto) { setAbierto(true); return; }
            setActivo(prev => {
                const siguiente = prev + (e.key === 'ArrowDown' ? 1 : -1);
                return Math.max(0, Math.min(resultados.length - 1, siguiente));
            });
            return;
        }

        if (e.key === 'Enter' && abierto && activo >= 0) {
            e.preventDefault();
            const op = resultados[activo];
            if (op) elegir(op);
            return;
        }

        if (e.key === 'Escape' && abierto) {
            // Se detiene aquí: si subiera, el drawer entero se cerraría por cerrar una lista.
            e.stopPropagation();
            cerrar();
        }
    }

    return (
        <div className="campo combo" ref={cajaRef}>
            <label className="campo-lbl">
                {etiqueta}
                <input
                    type="text"
                    className="inp"
                    value={consulta}
                    placeholder={placeholder}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    role="combobox"
                    aria-expanded={abierto}
                    aria-autocomplete="list"
                    onFocus={() => setAbierto(true)}
                    onChange={(e) => {
                        setConsulta(e.target.value);
                        onEscribir(e.target.value);
                        setAbierto(true);
                        setActivo(-1);
                    }}
                    // El cierre se difiere: sin la espera, el blur mataría la lista antes de
                    // que el clic en una opción llegue a registrarse.
                    onBlur={() => { cierreDiferido.current = setTimeout(cerrar, 120); }}
                    onKeyDown={alTeclear}
                />
            </label>

            {abierto && resultados.length > 0 && (
                <div className="combo-pop" role="listbox">
                    {resultados.map((op, i) => (
                        <button
                            key={op}
                            type="button"
                            role="option"
                            aria-selected={i === activo}
                            className={'combo-opt' + (i === activo ? ' is-active' : '')}
                            // mousedown y no click: el blur del input se dispara antes que el
                            // click y la opción ya no existiría para recibirlo.
                            onMouseDown={(e) => { e.preventDefault(); elegir(op); }}
                        >
                            {resaltar(op, consulta).map((parte, j) =>
                                parte.marcado
                                    ? <mark key={j}>{parte.texto}</mark>
                                    : <span key={j}>{parte.texto}</span>
                            )}
                        </button>
                    ))}

                    {total !== undefined && total > resultados.length && (
                        <div className="combo-foot">
                            {total.toLocaleString('es-MX')} en total ·{' '}
                            {resultados.length}{resultados.length === MAX_SUGERENCIAS ? '+' : ''} coincidencias
                        </div>
                    )}
                </div>
            )}

            {ayuda && <p className="ayuda">{ayuda}</p>}
        </div>
    );
}

/** Filtro por subcadena, recortado. El mismo que usaban cliente y hospital. */
export function filtrar(lista: string[], consulta: string, limite = MAX_SUGERENCIAS): string[] {
    if (!consulta) return lista.slice(0, limite);

    const n = consulta.toLowerCase();
    const salida: string[] = [];
    for (const item of lista) {
        if (item.toLowerCase().includes(n)) {
            salida.push(item);
            if (salida.length === limite) break;
        }
    }
    return salida;
}
