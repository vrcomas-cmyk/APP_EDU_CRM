/**
 * Qué exige una actividad para poder guardarse.
 *
 * No hay una lista fija de comprobaciones. Se recorre la CONFIGURACIÓN del tipo —que vive en
 * Administración, no en el código— y se pregunta si lo que ese tipo declaró obligatorio tiene
 * valor. Agregar un requisito nuevo es cambiar una celda de una hoja, no desplegar.
 */

import { MODOS, configuracionCampos } from '@core/puente';
import type { Actividad, ModoCampo } from '@core/tipos';

/**
 * Valor de un campo, resuelto desde el árbol de la actividad.
 *
 * Existe porque los campos configurables no son propiedades planas: el contacto está anidado y
 * los materiales son una lista. Este es el único lugar que conoce esa forma.
 */
export function valorDe(actividad: Actividad, campoId: string): string {
    switch (campoId) {
        case 'area_visitada':     return actividad.area_visitada || '';
        case 'contacto_nombre':   return actividad.contacto?.nombre || '';
        case 'contacto_cargo':    return actividad.contacto?.cargo || '';
        case 'contacto_servicio': return actividad.contacto?.servicio || '';
        case 'fecha_documento':   return actividad.fecha_documento || '';
        case 'tipo_evidencia':    return actividad.evidencia?.tipo || '';

        // Los materiales no son texto: lo que se comprueba es que haya al menos uno.
        case 'materiales':        return (actividad.materiales || []).length ? 'si' : '';

        /**
         * La evidencia obligatoria NO bloquea el guardado.
         *
         * Es deuda, no requisito: se salda después, cuando haya señal. Exigir la foto aquí
         * detendría al educador de pie frente al cliente por algo que puede resolverse en el
         * coche — y el resultado real sería que no registra la actividad.
         */
        case 'evidencia':         return 'si';

        default:                  return '';
    }
}

/** Mensajes en el idioma del educador, no en el del modelo de datos. */
export const MENSAJES: Record<string, string> = {
    tipo:              'Elige el tipo de actividad.',
    area_visitada:     'Indica el área que visitaste.',
    contacto_nombre:   'El nombre de quien te atendió es obligatorio.',
    contacto_cargo:    'El cargo del contacto es obligatorio para este tipo.',
    contacto_servicio: 'El servicio del contacto es obligatorio para este tipo.',
    fecha_documento:   'Este tipo de actividad exige la fecha del documento.',
    tipo_evidencia:    'Elige el tipo de evidencia.',
    materiales:        'Este tipo de actividad exige al menos un material.'
};

export interface Faltante {
    campoId: string;
    mensaje: string;
}

/**
 * Qué falta para poder guardar. Devuelve `[]` cuando ya se puede.
 *
 * El tipo va primero y aparte: sin tipo no hay configuración que recorrer, así que su ausencia
 * no es "un campo más en falta", es la razón de que no se sepa qué más pedir.
 */
export function faltantesDe(actividad: Actividad): Faltante[] {
    const faltantes: Faltante[] = [];

    if (!actividad.tipo) {
        faltantes.push({ campoId: 'tipo', mensaje: MENSAJES.tipo! });
        return faltantes;
    }

    const config = configuracionCampos(actividad.tipo);

    for (const [campoId, modo] of Object.entries(config) as Array<[string, ModoCampo]>) {
        if (modo !== MODOS.OBLIGATORIO) continue;
        if (valorDe(actividad, campoId).trim()) continue;

        faltantes.push({
            campoId,
            mensaje: MENSAJES[campoId] || `Falta ${campoId}.`
        });
    }

    return faltantes;
}

export function sePuedeGuardar(actividad: Actividad): boolean {
    return faltantesDe(actividad).length === 0;
}

/** Aviso resumido para el toast. El detalle por campo se marca en el propio formulario. */
export function resumenDeFaltantes(faltantes: Faltante[]): string {
    if (faltantes.length === 1) return 'Falta un dato para poder guardar.';
    return `Faltan ${faltantes.length} datos para poder guardar.`;
}

/**
 * ¿Es un borrador en el que nadie escribió nada?
 *
 * Un borrador vacío no es una actividad a medias: es un botón presionado por error. Dejarlo
 * llenaría el sector de tarjetas vacías que después nadie sabe si borrar.
 */
export function estaVacia(actividad: Actividad): boolean {
    return !actividad.tipo
        && !actividad.area_visitada
        && !(actividad.contacto?.nombre || '').trim()
        && (actividad.materiales || []).length === 0;
}
