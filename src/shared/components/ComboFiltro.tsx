/**
 * Un filtro de catálogo grande, con buscador en vez de una lista plana.
 *
 * `<select><option>` funciona con 10 educadores; con cientos (el caso que la jerarquía
 * recursiva de Postgres ya anticipa) es una lista nativa sin forma de escribir para encontrar
 * a alguien. Reutiliza el mismo `Combo` que ya filtra los ~11,500 clientes en la captura de
 * visitas — aquí la lista suele ser mucho más chica, pero el problema es el mismo.
 *
 * El valor del filtro solo cambia al ELEGIR una opción (o al borrar todo el texto, que limpia
 * el filtro): escribir texto libre que no coincide con ningún valor real dejaría el filtro
 * comparando contra algo que no existe, y `aplicarFiltro` compara por igualdad exacta.
 */

import { Combo, filtrar } from './Combo';

interface Props {
    etiqueta: string;
    valor: string;
    opciones: string[];
    onCambiar: (valor: string) => void;
    placeholder?: string;
}

export function ComboFiltro({ etiqueta, valor, opciones, onCambiar, placeholder }: Props) {
    return (
        <div className="filtro filtro-combo">
            <Combo
                etiqueta={etiqueta}
                valor={valor}
                placeholder={placeholder ?? 'Todos'}
                opciones={(q) => filtrar(opciones, q, 20)}
                total={opciones.length}
                onElegir={onCambiar}
                onEscribir={(texto) => { if (!texto.trim()) onCambiar(''); }}
            />
        </div>
    );
}
