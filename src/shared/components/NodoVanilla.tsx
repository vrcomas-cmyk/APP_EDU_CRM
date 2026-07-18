/**
 * Monta dentro de React un nodo DOM construido a mano.
 *
 * Es la costura con los módulos que todavía no se portan y que devuelven elementos —el control
 * de evidencia, la miniatura, el hilo de comentarios—. Sin esto habría que portarlos todos de
 * golpe para poder portar cualquiera de sus contenedores.
 *
 * Es deuda declarada, y por eso está aislada en un solo componente: cuando esos módulos sean
 * React, `NodoVanilla` deja de tener usos y se borra. Mientras tanto, que el `appendChild` viva
 * aquí evita que aparezca disperso por los componentes.
 */

import { useEffect, useRef } from 'react';

interface Props {
    /** Construye el nodo. Se vuelve a llamar cuando cambia `clave`. */
    construir: () => Node | null;
    /**
     * Cuándo reconstruir. Cambia cuando cambia el dato que el nodo pinta.
     *
     * Existe porque el nodo es opaco para React: no puede compararlo ni actualizarlo, solo
     * tirarlo y rehacerlo. Sin una clave explícita habría que reconstruirlo en cada render, y
     * eso tiraría el foco y el texto a medio escribir de lo que hubiera dentro.
     */
    clave?: string | number;
    className?: string;
}

export function NodoVanilla({ construir, clave, className }: Props) {
    const anfitrion = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const caja = anfitrion.current;
        if (!caja) return;

        const nodo = construir();
        if (nodo) caja.appendChild(nodo);

        return () => { caja.replaceChildren(); };
        // `construir` se omite a propósito: suele ser una función nueva en cada render, y
        // depender de ella reconstruiría el nodo constantemente. Manda `clave`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clave]);

    return <div ref={anfitrion} className={className} />;
}
