/**
 * El borrador de catálogos: cómo se arma, cómo se valida y cómo se corrige solo.
 *
 * Administración guarda de forma EXPLÍCITA, al revés que el drawer. Aquí un error se propaga a
 * todos los educadores en el siguiente sync, así que conviene poder revisar antes de que eso
 * pase en vez de subir cada tecla suelta.
 */

import { configuracionCampos, leerCatalogo, IDS_CAMPOS, MODOS } from '@core/puente';
import type { BorradorCatalogo, Educador, ModoCampo, TipoActividad } from '@core/tipos';

/** Las listas simples se editan todas igual; solo cambian el nombre y el texto de ayuda. */
export const LISTAS = [
    { clave: 'origenes', etiqueta: 'Orígenes de la actividad',
      ayuda: 'De dónde nace la visita a un sector.' },
    { clave: 'areas', etiqueta: 'Áreas visitadas',
      ayuda: 'Opciones del campo "Área visitada" de la actividad.' },
    { clave: 'unidades', etiqueta: 'Unidades de medida',
      ayuda: 'Se ofrecen al capturar la cantidad de un material.' },
    { clave: 'tipos_evidencia', etiqueta: 'Tipos de evidencia',
      ayuda: 'Solo aparecen si algún tipo de actividad muestra el campo.' }
] as const;

export type ClaveLista = (typeof LISTAS)[number]['clave'];

/**
 * Materializa el borrador desde lo que la app está usando DE VERDAD.
 *
 * La configuración de campos se resuelve aquí —defaults, banderas viejas y lo ya configurado—
 * para que el administrador vea el estado real y no una tabla vacía que parezca «sin
 * configurar». Ver ceros donde en realidad hay reglas activas invita a rellenarlas de nuevo.
 */
export function borradorDesdeCatalogo(): BorradorCatalogo {
    const cat = leerCatalogo() || {};

    return {
        tipos_actividad: (cat.tipos_actividad || []).map(t => ({
            ...t,
            campos: { ...configuracionCampos(t.nombre) }
        })),
        origenes: [...(cat.origenes || [])],
        areas: [...(cat.areas || [])],
        unidades: [...(cat.unidades || [])],
        tipos_evidencia: [...(cat.tipos_evidencia || [])],
        sectores_ocultos: [...(cat.sectores_ocultos || [])],
        educadores: (cat.educadores || []).map(e => ({ ...e })),
        admins: [...(cat.admins || [])]
    };
}

/** Un tipo nuevo arranca con los modos por defecto, no en blanco. */
export function tipoNuevo(): TipoActividad {
    return {
        nombre: '',
        evidencia: true,
        materiales: false,
        campos: { ...configuracionCampos(undefined) }
    };
}

/**
 * Cambia el modo de un campo.
 *
 * Las banderas viejas se mantienen en sintonía: la hoja de cálculo sigue teniendo sus columnas
 * `evidencia` y `materiales`, y dejarlas mintiendo confundiría a quien lea el Sheet —que es
 * donde mucha gente comprueba las cosas.
 */
export function conCampo(t: TipoActividad, campoId: string, modo: ModoCampo): TipoActividad {
    const salida: TipoActividad = { ...t, campos: { ...(t.campos || {}), [campoId]: modo } };

    if (campoId === 'evidencia') salida.evidencia = modo !== MODOS.OCULTO;
    if (campoId === 'materiales') salida.materiales = modo === MODOS.OBLIGATORIO;

    return salida;
}

export function resumenDeTipo(t: TipoActividad): string {
    const obligatorios = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OBLIGATORIO).length;
    const ocultos = IDS_CAMPOS.filter(id => t.campos?.[id] === MODOS.OCULTO).length;

    return `${obligatorios} obligatorio${obligatorios === 1 ? '' : 's'}`
        + ` · ${ocultos} oculto${ocultos === 1 ? '' : 's'}`;
}

/**
 * Cambia el correo de un educador ARRASTRANDO su condición de administrador.
 *
 * `admins` guarda correos, no referencias, así que al editar un correo la entrada antigua
 * quedaba apuntando a nadie y la persona perdía el acceso en silencio —lo notaría el día que
 * no pudiera entrar—. El módulo vanilla tenía esto anotado como pendiente y nunca se hizo.
 */
export function conCorreoDeEducador(
    b: BorradorCatalogo, indice: number, correo: string
): BorradorCatalogo {
    const anterior = b.educadores[indice]?.correo || '';
    const limpio = correo.trim().toLowerCase();
    const eraAdmin = !!anterior && b.admins.includes(anterior);

    const educadores = b.educadores.map((e, i) => (i === indice ? { ...e, correo: limpio } : e));

    let admins = b.admins.filter(c => c !== anterior);
    if (eraAdmin && limpio) admins = [...admins, limpio];

    return { ...b, educadores, admins };
}

export function conAdmin(b: BorradorCatalogo, correo: string, esAdmin: boolean): BorradorCatalogo {
    const admins = b.admins.filter(c => c !== correo);
    return { ...b, admins: esAdmin && correo ? [...admins, correo] : admins };
}

/** Al borrar a un educador se retira también su acceso: si no, queda un admin fantasma. */
export function sinEducador(b: BorradorCatalogo, indice: number): BorradorCatalogo {
    const correo = b.educadores[indice]?.correo || '';

    return {
        ...b,
        educadores: b.educadores.filter((_, i) => i !== indice),
        admins: b.admins.filter(c => c !== correo)
    };
}

export function educadorNuevo(): Educador {
    return { nombre: '', correo: '' };
}

/**
 * Qué impide guardar. Devuelve TODOS los problemas, no el primero: corregir de uno en uno,
 * con una confirmación por vuelta, es cómo se abandona a la mitad.
 */
export function problemasDe(b: BorradorCatalogo): string[] {
    const problemas: string[] = [];

    if (b.tipos_actividad.some(t => !t.nombre.trim())) {
        problemas.push('hay un tipo de actividad sin nombre');
    }
    if (b.educadores.some(e => !e.nombre.trim() || !e.correo.trim())) {
        problemas.push('hay un educador sin nombre o sin correo');
    }

    const nombres = b.tipos_actividad.map(t => t.nombre.trim().toLowerCase());
    if (new Set(nombres).size !== nombres.length) {
        problemas.push('hay dos tipos de actividad con el mismo nombre');
    }

    // Una lista vacía no rompe la app —`catalogos.js` cae en sus defaults— pero sí sorprende:
    // el administrador creería haberla borrado y seguiría viendo opciones.
    for (const l of LISTAS) {
        if (b[l.clave].length === 0) problemas.push(`"${l.etiqueta}" quedó vacía`);
    }

    if (b.tipos_actividad.length === 0) {
        problemas.push('no queda ningún tipo de actividad');
    }

    return problemas;
}
