/**
 * Qué exige una visita para poder existir.
 *
 * Vive aparte del componente a propósito: es la regla de negocio que decide si el botón
 * Guardar se habilita, y necesita poder probarse sin montar una pantalla.
 *
 * El orden de la lista importa. Se lee tal cual en el pie del formulario —"Falta Cliente ·
 * Hospital · Fecha"— así que sigue el orden en que aparecen los campos: una lista que salta
 * de arriba abajo obliga a buscar cada cosa.
 */

import type { Visita } from '@core/tipos';

export const CAMPOS_REQUERIDOS = [
    'Educador', 'Cliente', 'Hospital', 'Fecha', 'Hora de inicio', 'Hora de término',
    'Al menos un sector'
] as const;

const lleno = (v: string | undefined) => Boolean(v && v.trim());

/**
 * Lo que falta para poder guardar. Devuelve `[]` cuando ya se puede.
 *
 * Se devuelve la LISTA y no un booleano porque el pie la muestra: un botón gris sin explicar
 * por qué se interpreta como que la app está rota, y el usuario deja de intentarlo.
 */
export function faltaParaGuardar(visita: Visita): string[] {
    const falta: string[] = [];

    if (!lleno(visita.educador)) falta.push('Educador');
    if (!lleno(visita.cliente)) falta.push('Cliente');
    if (!lleno(visita.hospital)) falta.push('Hospital');
    if (!visita.dia) falta.push('Fecha');
    if (!visita.hora_inicio) falta.push('Hora de inicio');
    if (!visita.hora_fin) falta.push('Hora de término');

    // El horario no solo tiene que estar: tiene que tener sentido.
    //
    // El formulario ya impide teclear un fin anterior al inicio, pero un rango puede llegar
    // YA invertido desde fuera —el calendario lo producía al arrastrar contra el borde
    // inferior de la rejilla— y entonces esa validación nunca llega a correr. Comprobarlo
    // aquí lo cubre venga de donde venga.
    if (visita.hora_inicio && visita.hora_fin && visita.hora_fin <= visita.hora_inicio) {
        falta.push('Un horario válido (el término debe ser posterior al inicio)');
    }

    if (!(visita.sectores || []).length) falta.push('Al menos un sector');

    return falta;
}

export function sePuedeGuardar(visita: Visita): boolean {
    return faltaParaGuardar(visita).length === 0;
}

/**
 * ¿Hay algo capturado que se perdería al descartar?
 *
 * Se pregunta antes de cerrar un borrador. No incluye al educador: viene de la sesión, no lo
 * escribió nadie, y preguntar por él haría que un formulario recién abierto y vacío pidiera
 * confirmación para cerrarse — que es cómo se enseña a la gente a decir que sí sin leer.
 */
export function tieneCapturaPerdible(visita: Visita): boolean {
    return Boolean(
        lleno(visita.cliente) ||
        lleno(visita.hospital) ||
        visita.dia ||
        (visita.sectores || []).length
    );
}
