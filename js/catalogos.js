/**
 * Catálogos configurables.
 *
 * El de TIPOS DE ACTIVIDAD no es una lista de textos: es una lista de REGLAS. Cada tipo
 * declara qué campos exige, y el formulario de campo se arma según eso. Así nadie llena
 * datos que no aplican, y el admin cambia qué se pide sin que nadie programe.
 *
 * Vienen del Apps Script (`datosPWA`) cuando existan las pestañas. Mientras tanto se usan
 * estos valores por defecto, para que la app funcione desde el primer día.
 */

import { leerCatalogo } from './storage.js';

export const TIPOS_POR_DEFECTO = [
    { nombre: 'Capacitación',             evidencia: true,  materiales: false, folio: false, gerente: false },
    { nombre: 'Demostración de producto', evidencia: true,  materiales: true,  folio: false, gerente: false },
    { nombre: 'Entrega de muestras',      evidencia: true,  materiales: true,  folio: true,  gerente: true  },
    { nombre: 'Revisión de anaquel',      evidencia: false, materiales: false, folio: false, gerente: false },
    { nombre: 'Atención a queja',         evidencia: true,  materiales: false, folio: false, gerente: true  },
    { nombre: 'Seguimiento',              evidencia: false, materiales: false, folio: false, gerente: false }
];

export const ORIGENES_POR_DEFECTO = [
    'Programa anual', 'Solicitud del cliente', 'Seguimiento', 'Capacitación',
    'Evaluación', 'Licitación', 'Queja', 'Oportunidad comercial'
];

/** Regla neutra para un tipo desconocido: pedir evidencia y nada más. */
const REGLA_BASE = { nombre: '', evidencia: true, materiales: false, folio: false, gerente: false };

export function tiposActividad() {
    const del = leerCatalogo()?.tipos_actividad;
    return Array.isArray(del) && del.length ? del : TIPOS_POR_DEFECTO;
}

export function origenes() {
    const del = leerCatalogo()?.origenes;
    return Array.isArray(del) && del.length ? del : ORIGENES_POR_DEFECTO;
}

/**
 * Regla de un tipo. Si el tipo no está en el catálogo —lo borraron, o la actividad se
 * capturó antes de que existiera— se exige evidencia: es el default seguro. Lo contrario
 * (dar por buena una actividad de tipo desconocido) escondería trabajo sin soporte.
 */
export function reglaDe(tipo) {
    if (!tipo) return { ...REGLA_BASE };
    return tiposActividad().find(t => t.nombre === tipo) || { ...REGLA_BASE, nombre: tipo };
}

export function requiereEvidencia(actividad) {
    return reglaDe(actividad?.tipo).evidencia !== false;
}

/** Nombres de los campos extra que exige un tipo, para poder anunciarlos antes de pintarlos. */
export function camposExtra(tipo) {
    const r = reglaDe(tipo);
    const campos = [];
    if (r.materiales) campos.push('Materiales');
    if (r.folio) campos.push('Folio');
    if (r.gerente) campos.push('Gerente');
    return campos;
}
