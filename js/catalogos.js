/**
 * Catálogos y REGLAS configurables.
 *
 * Todo lo de aquí se administra sin programar. Los valores por defecto existen solo para que
 * la app funcione desde el primer día: en cuanto las pestañas tengan filas, mandan ellas.
 *
 * ── El modelo de campos ──────────────────────────────────────────────────────────────
 *
 * Un tipo de actividad no es un texto: es una lista de REGLAS. Cada campo capturable declara
 * su MODO para ese tipo, y el formulario se arma leyendo eso. No hay condiciones escritas a
 * mano en la pantalla — si mañana "Capacitación" deja de pedir contacto, se cambia en
 * Administración y el formulario deja de pedirlo, sin tocar código.
 *
 *   obligatorio   se pide y bloquea el guardado si falta
 *   opcional      se pide y se puede dejar vacío
 *   solo-lectura  se muestra si ya trae valor, pero no se captura
 *   oculto        no aparece
 *
 * ── Compatibilidad ───────────────────────────────────────────────────────────────────
 *
 * Antes cada tipo solo tenía dos banderas: `evidencia` y `materiales`. Siguen leyéndose y se
 * traducen a modos, así que una hoja que nunca se actualice se comporta igual que antes. Lo
 * que se configure por campo pisa a lo heredado.
 */

import { leerCatalogo } from './storage.js';
import { misZonas, misClientesExtra } from './permisos.js';

// ---------- modos ----------

export const MODOS = {
    OBLIGATORIO: 'obligatorio',
    OPCIONAL: 'opcional',
    SOLO_LECTURA: 'solo-lectura',
    OCULTO: 'oculto'
};

export const ETIQUETAS_MODO = {
    [MODOS.OBLIGATORIO]: 'Obligatorio',
    [MODOS.OPCIONAL]: 'Opcional',
    [MODOS.SOLO_LECTURA]: 'Solo lectura',
    [MODOS.OCULTO]: 'Oculto'
};

const MODOS_VALIDOS = Object.values(MODOS);

/**
 * Los campos capturables de una actividad. Esta lista es la ÚNICA fuente de qué se puede
 * configurar: la pantalla de administración se dibuja recorriéndola, y el formulario de
 * captura también. Agregar un campo nuevo es agregar una entrada aquí.
 */
export const CAMPOS_ACTIVIDAD = [
    { id: 'area_visitada',     etiqueta: 'Área visitada',        defecto: MODOS.OBLIGATORIO },
    { id: 'contacto_nombre',   etiqueta: 'Contacto · Nombre',    defecto: MODOS.OBLIGATORIO },
    { id: 'contacto_cargo',    etiqueta: 'Contacto · Cargo',     defecto: MODOS.OPCIONAL },
    { id: 'contacto_servicio', etiqueta: 'Contacto · Servicio',  defecto: MODOS.OPCIONAL },
    { id: 'materiales',        etiqueta: 'Materiales',           defecto: MODOS.OCULTO },
    { id: 'evidencia',         etiqueta: 'Evidencia',            defecto: MODOS.OBLIGATORIO },
    { id: 'tipo_evidencia',    etiqueta: 'Tipo de evidencia',    defecto: MODOS.OCULTO },
    { id: 'fecha_documento',   etiqueta: 'Fecha del documento',  defecto: MODOS.OCULTO }
];

export const IDS_CAMPOS = CAMPOS_ACTIVIDAD.map(c => c.id);

const POR_DEFECTO = Object.fromEntries(CAMPOS_ACTIVIDAD.map(c => [c.id, c.defecto]));

// ---------- listas ----------

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
export const TIPOS_EVIDENCIA_POR_DEFECTO = ['Fotografía', 'Lista de asistencia', 'Documento firmado'];

const delCatalogo = (llave, porDefecto) => {
    const v = leerCatalogo()?.[llave];
    return Array.isArray(v) && v.length ? v : porDefecto;
};

export function tiposActividad()  { return delCatalogo('tipos_actividad', TIPOS_POR_DEFECTO); }
export function origenes()        { return delCatalogo('origenes', ORIGENES_POR_DEFECTO); }
export function areas()           { return delCatalogo('areas', AREAS_POR_DEFECTO); }
export function unidades()        { return delCatalogo('unidades', UNIDADES_POR_DEFECTO); }
export function tiposEvidencia()  { return delCatalogo('tipos_evidencia', TIPOS_EVIDENCIA_POR_DEFECTO); }

/**
 * "1", "01", "001" son la misma zona escrita distinto según cómo la haya tecleado quien llenó
 * la hoja de Clientes o de Ejecutivos. Se normaliza a 3 dígitos con ceros a la izquierda en
 * cuanto el catálogo se descarga (`descargarCatalogo` en sync.js, el único lugar donde el
 * payload crudo de Apps Script entra a la app), así que todo lo que lee `leerCatalogo()` de
 * ahí en adelante ya ve zonas consistentes. Se exporta también para poder normalizar del
 * mismo modo un valor suelto que venga de otro lado (p. ej. una zona ya guardada en Supabase
 * antes de este cambio).
 */
export function normalizarZona(zona) {
    const z = String(zona ?? '').trim();
    return /^\d+$/.test(z) ? z.padStart(3, '0') : z;
}

/**
 * Zona del cliente ("Gpo. vendedores" en la hoja de Clientes) y Ejecutivo que le reporta a
 * esa zona ("Ejecutivos", columna Zona → columna Ejecutivo). Ninguna de las dos se escribe a
 * mano: la Zona sale de elegir el cliente, y el Ejecutivo sale de la Zona ya resuelta — dos
 * saltos automáticos, no dos catálogos que curar.
 */
export function zonaDeCliente(cliente) {
    const mapa = leerCatalogo()?.clientes_zona;
    if (!mapa || typeof mapa !== 'object') return '';
    return String(mapa[cliente] || '').trim();
}

export function ejecutivoDeZona(zona) {
    const mapa = leerCatalogo()?.ejecutivos;
    if (!mapa || typeof mapa !== 'object' || !zona) return '';
    return String(mapa[zona] || '').trim();
}

/**
 * Todas las zonas que existen entre los clientes descargados ("Gpo. vendedores" único), para
 * el panel de Administración → Territorios. No es lo mismo que "mis zonas" (`misZonas` en
 * permisos.js): esto es el universo completo que se puede asignar, aquella es el recorte de
 * uno.
 */
export function zonasDelCatalogo() {
    const mapa = leerCatalogo()?.clientes_zona;
    if (!mapa || typeof mapa !== 'object') return [];
    const unicas = new Set(Object.values(mapa).map(z => String(z || '').trim()).filter(Boolean));
    return [...unicas].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Todos los clientes del catálogo descargado. Son ~11.5k: nunca se pintan todos de golpe. */
export function clientesDelCatalogo() {
    const cat = leerCatalogo() || {};
    return Array.isArray(cat.clientes) ? cat.clientes : [];
}

/**
 * Solo los clientes de MIS zonas (titular + cobertura vigente, ver `misZonas` en permisos.js)
 * MÁS los clientes sueltos que se me prestaron por excepción puntual (`misClientesExtra`) —
 * el caso de "necesito ver a este cliente que no es mío" sin que le presten la zona completa.
 * Es la restricción de territorio: cada educador busca y agenda dentro de sus clientes, no en
 * el catálogo completo de la compañía.
 *
 * Sin ninguna zona asignada NI excepciones, se cae al catálogo COMPLETO — es el lado seguro: un
 * rol que no captura (analista, gerente, administrador) o un educador todavía sin configurar no
 * debe quedarse sin poder buscar un cliente por una falta de configuración que no es suya.
 */
export function clientesEnMisZonas() {
    const zonas = misZonas();
    // Sin zona asignada, el lado seguro sigue siendo el catálogo completo — una excepción
    // puntual no tiene sentido sin una zona base a la que se agrega.
    if (zonas.length === 0) return clientesDelCatalogo();
    const extra = misClientesExtra();

    const mapa = leerCatalogo()?.clientes_zona;
    if (!mapa || typeof mapa !== 'object') return clientesDelCatalogo();

    const propias = new Set(zonas);
    const clientesExtra = new Set(extra);
    return clientesDelCatalogo().filter(c =>
        propias.has(String(mapa[c] || '').trim()) || clientesExtra.has(c)
    );
}

/**
 * Sectores que el educador puede elegir.
 *
 * Se administran CURANDO la lista que sale de la hoja de Materiales, no escribiéndola libre:
 * un sector inventado a mano no empataría con ningún material y su buscador saldría vacío,
 * que es un error imposible de diagnosticar desde el pasillo. Administración decide cuáles
 * se ofrecen; de dónde salen lo sigue diciendo el catálogo de materiales.
 */
export function sectores() {
    const cat = leerCatalogo() || {};
    const todos = Array.isArray(cat.sectores) ? cat.sectores : [];
    const ocultos = Array.isArray(cat.sectores_ocultos) ? cat.sectores_ocultos : [];
    if (ocultos.length === 0) return todos;
    return todos.filter(s => !ocultos.includes(s));
}

/** Todos los que existen en Materiales, escondidos incluidos. Solo lo usa Administración. */
export function sectoresDelCatalogo() {
    const v = leerCatalogo()?.sectores;
    return Array.isArray(v) ? v : [];
}

export function sectoresOcultos() {
    const v = leerCatalogo()?.sectores_ocultos;
    return Array.isArray(v) ? v : [];
}

// ---------- reglas por tipo ----------

/** Normaliza un modo que venga de la hoja; lo que no se reconozca cae en el default del campo. */
function modoValido(valor, porDefecto) {
    const m = String(valor || '').trim().toLowerCase();
    return MODOS_VALIDOS.includes(m) ? m : porDefecto;
}

/**
 * Configuración de campos de un tipo: { area_visitada: 'obligatorio', ... }
 *
 * Se arma en tres capas, de menos a más específica:
 *   1. el default del campo
 *   2. las banderas viejas `evidencia` / `materiales` del tipo
 *   3. lo configurado campo por campo
 *
 * Un tipo que no está en el catálogo —lo borraron, o la actividad se capturó antes de que
 * existiera— cae en los defaults, que piden evidencia. Es el lado seguro: dar por buena una
 * actividad de tipo desconocido escondería trabajo sin soporte.
 */
export function configuracionCampos(tipo) {
    const def = tiposActividad().find(t => t.nombre === tipo);
    const config = { ...POR_DEFECTO };

    if (def) {
        // Capa 2: las banderas heredadas. Solo se aplican si la hoja las trae.
        if (def.evidencia === false) config.evidencia = MODOS.OCULTO;
        if (def.evidencia === true) config.evidencia = MODOS.OBLIGATORIO;
        if (def.materiales === true) config.materiales = MODOS.OBLIGATORIO;
        if (def.materiales === false) config.materiales = MODOS.OCULTO;

        // Capa 3: lo que Administración configuró campo por campo.
        const campos = def.campos && typeof def.campos === 'object' ? def.campos : {};
        for (const id of IDS_CAMPOS) {
            if (campos[id] != null && campos[id] !== '') {
                config[id] = modoValido(campos[id], config[id]);
            }
        }
    }
    return config;
}

export function modoCampo(tipo, campoId) {
    return configuracionCampos(tipo)[campoId] || MODOS.OCULTO;
}

export function campoVisible(tipo, campoId) {
    return modoCampo(tipo, campoId) !== MODOS.OCULTO;
}

export function campoObligatorio(tipo, campoId) {
    return modoCampo(tipo, campoId) === MODOS.OBLIGATORIO;
}

export function campoEditable(tipo, campoId) {
    const m = modoCampo(tipo, campoId);
    return m === MODOS.OBLIGATORIO || m === MODOS.OPCIONAL;
}

/**
 * Regla resumida de un tipo. Se conserva porque media app la lee así, pero ahora se DERIVA
 * de la configuración de campos en vez de ser la fuente de la verdad.
 */
export function reglaDe(tipo) {
    const config = configuracionCampos(tipo);
    return {
        nombre: tipo || '',
        config,
        evidencia: config.evidencia !== MODOS.OCULTO,
        materiales: config.materiales !== MODOS.OCULTO
    };
}

/** Solo cuenta como deuda lo que el tipo declara OBLIGATORIO. */
export function requiereEvidencia(actividad) {
    return campoObligatorio(actividad?.tipo, 'evidencia');
}

/** Lo que el tipo exige, para poder anunciarlo ANTES de pintar los campos. */
export function camposExtra(tipo) {
    if (!tipo) return [];
    const config = configuracionCampos(tipo);
    return CAMPOS_ACTIVIDAD
        .filter(c => config[c.id] === MODOS.OBLIGATORIO)
        .map(c => c.etiqueta);
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

// ---------- estrategias ----------

/**
 * Valores por defecto de "Descr. Grupo de Art.", SOLO para cuando el catálogo aún no
 * descargó nada (primer arranque, sin red). En cuanto `Codigo.gs` lea la columna real de la
 * pestaña "Materiales" —deduplicada, igual que los sectores— esa lista manda.
 */
export const GRUPOS_ARTICULO_POR_DEFECTO = [
    'Cardinal', 'Desechables', 'Guantes', 'Urología', 'Suturas', 'Hipodérmicos',
    'Terapia de Infusión', 'Adhesivos', 'Cuidado de Heridas', 'Terapia Respiratoria',
    'Ortopedia', 'Pañal', 'Productos Para Quirófano', 'Algodón y Aplicadores',
    'Antisépticos y Alcohol', 'Gasas', 'Medias', 'Productos Básicos', 'Vendas'
];

/**
 * "Descr. Grupo de Art." del tablero de Estrategias (CRM de Gerencia de Marca): la familia
 * comercial del producto, no el sector clínico. Un mismo sector (p. ej. Quirófano) puede
 * trabajar varios grupos, y un grupo se sigue igual sin importar en qué sector se ofrezca —
 * por eso son dos catálogos distintos y no uno solo. Sale de "Materiales" deduplicada, con el
 * mismo mecanismo que ya resuelve `sectores()`.
 */
export function gruposArticulo() {
    return delCatalogo('grupos_articulo', GRUPOS_ARTICULO_POR_DEFECTO);
}

/**
 * Grupos de artículo que de verdad se trabajan en un sector — los que aparecen en alguna
 * fila de "Materiales" con ese sector. Sin sector, o si la hoja todavía no trae la columna
 * de grupo (`grupo_articulo` en cada material), se cae al catálogo completo: es el lado
 * seguro, ofrecer de más nunca rompe nada, ofrecer de menos sí escondería una opción válida.
 */
export function gruposDeSector(sector) {
    if (!sector) return gruposArticulo();
    const todos = leerCatalogo()?.materiales;
    if (!Array.isArray(todos) || todos.length === 0) return gruposArticulo();

    const deEsteSector = todos.filter(m => m.sector === sector);
    const grupos = [...new Set(deEsteSector.map(m => m.grupo_articulo).filter(Boolean))];
    return grupos.length > 0 ? grupos.sort((a, b) => a.localeCompare(b, 'es')) : gruposArticulo();
}

export const ETAPAS_ESTRATEGIA = ['Prospección', 'En desarrollo', 'Consolidado', 'En riesgo'];
