/**
 * Catálogos configurables.
 *
 * Todo lo de aquí está pensado para venir de la hoja y administrarse sin programar. Los
 * valores por defecto existen solo para que la app funcione desde el primer día y mientras
 * el módulo de Administración no exista: en cuanto la pestaña tenga filas, mandan ellas.
 *
 * El de TIPOS DE ACTIVIDAD no es una lista de textos: es una lista de REGLAS. Cada tipo
 * declara qué campos exige y el formulario de campo se arma según eso, en vez de tener las
 * condiciones escritas a mano en el código.
 */

import { leerCatalogo } from './storage.js';

export const TIPOS_POR_DEFECTO = [
    { nombre: 'Capacitación',             evidencia: true,  materiales: false },
    { nombre: 'Demostración de producto', evidencia: true,  materiales: true  },
    { nombre: 'Entrega de muestras',      evidencia: true,  materiales: true  },
    { nombre: 'Evaluación de producto',   evidencia: true,  materiales: true  },
    { nombre: 'Revisión de anaquel',      evidencia: false, materiales: false },
    { nombre: 'Atención a queja',         evidencia: true,  materiales: false },
    { nombre: 'Seguimiento',              evidencia: false, materiales: false }
];

export const ORIGENES_POR_DEFECTO = ['BI', 'I&D', 'Gerencia de Marca', 'Ventas'];

export const AREAS_POR_DEFECTO = ['Área Usuaria', 'Otra'];

export const UNIDADES_POR_DEFECTO = ['Pieza', 'Paquete', 'Bulto', 'Caja', 'Cajilla', 'Pares'];

/** Regla neutra para un tipo desconocido: pedir evidencia y nada más. */
const REGLA_BASE = { nombre: '', evidencia: true, materiales: false };

const delCatalogo = (llave, porDefecto) => {
    const v = leerCatalogo()?.[llave];
    return Array.isArray(v) && v.length ? v : porDefecto;
};

export function tiposActividad() { return delCatalogo('tipos_actividad', TIPOS_POR_DEFECTO); }
export function origenes()       { return delCatalogo('origenes', ORIGENES_POR_DEFECTO); }
export function areas()          { return delCatalogo('areas', AREAS_POR_DEFECTO); }
export function unidades()       { return delCatalogo('unidades', UNIDADES_POR_DEFECTO); }

/**
 * Regla de un tipo. Si el tipo no está en el catálogo —lo borraron, o la actividad se capturó
 * antes de que existiera— se exige evidencia: es el default seguro. Lo contrario (dar por
 * buena una actividad de tipo desconocido) escondería trabajo sin soporte.
 */
export function reglaDe(tipo) {
    if (!tipo) return { ...REGLA_BASE };
    return tiposActividad().find(t => t.nombre === tipo) || { ...REGLA_BASE, nombre: tipo };
}

export function requiereEvidencia(actividad) {
    return reglaDe(actividad?.tipo).evidencia !== false;
}

export function requiereMateriales(tipo) {
    return reglaDe(tipo).materiales === true;
}

/** Lo que el tipo exige, para poder anunciarlo ANTES de pintar los campos. */
export function camposExtra(tipo) {
    const r = reglaDe(tipo);
    const campos = [];
    if (r.evidencia) campos.push('Evidencia');
    if (r.materiales) campos.push('Materiales');
    return campos;
}

// ---------- materiales ----------

/**
 * Materiales del sector que se está registrando, y solo de ese.
 *
 * El educador está trabajando GASAS: ofrecerle guantes es ruido que lo hace equivocarse.
 * Cada material trae { material, sector }; `material` es el campo "Material y Nombre" de la
 * hoja, que es lo único que se muestra.
 */
export function materialesDe(sector) {
    const todos = leerCatalogo()?.materiales;
    if (!Array.isArray(todos)) return [];
    return todos.filter(m => m.sector === sector);
}

/**
 * Buscador. Empareja por palabras sueltas y en cualquier orden: quien busca "gasa 10x10"
 * debe encontrar "GASA SIMPLE 10X10 CM", que no contiene esa cadena literal.
 */
export function buscarMateriales(sector, consulta, limite = 40) {
    const lista = materialesDe(sector);
    const q = (consulta || '').trim().toLowerCase();
    if (!q) return lista.slice(0, limite);

    const palabras = q.split(/\s+/);
    const salida = [];
    for (const m of lista) {
        const texto = m.material.toLowerCase();
        if (palabras.every(p => texto.includes(p))) {
            salida.push(m);
            if (salida.length === limite) break;
        }
    }
    return salida;
}

export function hayMateriales(sector) {
    return materialesDe(sector).length > 0;
}
