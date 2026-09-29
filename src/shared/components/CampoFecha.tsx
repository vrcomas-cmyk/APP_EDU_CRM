/**
 * Campo de fecha que SIEMPRE se lee dd/mm/aaaa.
 *
 * El `<input type="date">` nativo pinta su valor en el orden del idioma del NAVEGADOR/SO
 * (mm/dd/yyyy en inglés), no en el de la página — `lang` en el propio input no lo garantiza en
 * todos los navegadores. La única forma confiable de que se lea igual en todas partes es no
 * depender de ese render: el input real queda encima, transparente y funcional (teclado,
 * calendario nativo, accesibilidad), y lo que se VE es un texto de abajo, siempre en
 * `fechaCorta()`.
 *
 * Misma API que un `<input>`: `value` ('YYYY-MM-DD') y `onChange(e)` con `e.target.value`, para
 * sustituir cualquier `<input type="date">` sin tocar a quien lo usa. `className` va al texto
 * visible (p. ej. "inp mono").
 */

import type { InputHTMLAttributes } from 'react';
import { fechaCorta } from '@core/puente';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'value'> & {
    value?: string | null;
    className?: string;
};

export function CampoFecha({ value, className = 'inp', placeholder = 'dd/mm/aaaa', ...resto }: Props) {
    return (
        <div className="campo-fecha-dd">
            <span className={`${className} campo-fecha-dd-texto`} aria-hidden="true">
                {fechaCorta(value) || <span className="campo-fecha-dd-vacio">{placeholder}</span>}
            </span>
            <input
                {...resto}
                type="date"
                className="campo-fecha-dd-real"
                value={value || ''}
                onClick={(e) => { resto.onClick?.(e); e.currentTarget.showPicker?.(); }}
            />
        </div>
    );
}
