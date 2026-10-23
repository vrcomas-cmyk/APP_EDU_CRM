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
import { ordenarEs } from './orden.js';
import { misZonas, misClientesExtra } from './permisos.js';

// ---------- modos ----------

export const MODOS = {
    OBLIGATORIO: 'obligatorio',
    /** Obligatorio, pero NO bloquea el guardado: queda como pendiente y se salda después
     *  (la evidencia, el resultado de un seguimiento). */
    OBLIGATORIO_DESPUES: 'obligatorio-despues',
    OPCIONAL: 'opcional',
    SOLO_LECTURA: 'solo-lectura',
    OCULTO: 'oculto'
};

export const ETIQUETAS_MODO = {
    [MODOS.OBLIGATORIO]: 'Obligatorio',
    [MODOS.OBLIGATORIO_DESPUES]: 'Obligatorio (completar después)',
    [MODOS.OPCIONAL]: 'Opcional',
    [MODOS.SOLO_LECTURA]: 'Solo lectura',
    [MODOS.OCULTO]: 'Oculto'
};

const MODOS_VALIDOS = Object.values(MODOS);

/** Lo que admite un campo si no declara `modos`: todo salvo "obligatorio después", que solo
 *  tiene sentido donde el dato realmente puede completarse tras guardar. */
const MODOS_BASE = [MODOS.OBLIGATORIO, MODOS.OPCIONAL, MODOS.SOLO_LECTURA, MODOS.OCULTO];
/** Los modos de los campos de formularios que no son la actividad. Sin solo-lectura: esos
 *  formularios no tienen un estado "ya guardado" en el que un campo se muestre sin capturarse. */
const MODOS_FORMULARIO = [MODOS.OBLIGATORIO, MODOS.OPCIONAL, MODOS.OCULTO];

/** Los modos que el administrador puede elegir para un campo. */
export function modosPermitidos(campo) {
    return campo?.modos || MODOS_BASE;
}

/**
 * Los campos capturables de una actividad. Esta lista es la ÚNICA fuente de qué se puede
 * configurar: la pantalla de administración se dibuja recorriéndola, y el formulario de
 * captura también. Agregar un campo nuevo es agregar una entrada aquí.
 *
 * `modos`   los modos que admite (por defecto, `MODOS_BASE`).
 * `ambito`  'material' = no es un campo de la actividad sino de la ventana "Agregar material":
 *           la actividad no lo valida, lo consume `materiales.js`.
 */
export const CAMPOS_ACTIVIDAD = [
    { id: 'area_visitada',     etiqueta: 'Área visitada',        defecto: MODOS.OBLIGATORIO },
    { id: 'contacto_nombre',   etiqueta: 'Contacto · Nombre',    defecto: MODOS.OBLIGATORIO },
    { id: 'contacto_cargo',    etiqueta: 'Contacto · Cargo',     defecto: MODOS.OPCIONAL },
    { id: 'contacto_servicio', etiqueta: 'Contacto · Servicio',  defecto: MODOS.OPCIONAL },
    { id: 'materiales',        etiqueta: 'Materiales',           defecto: MODOS.OCULTO },
    { id: 'material_cantidad', etiqueta: 'Material · Cantidad',  defecto: MODOS.OBLIGATORIO,
      modos: MODOS_FORMULARIO, ambito: 'material' },
    { id: 'material_unidad',   etiqueta: 'Material · Unidad de medida', defecto: MODOS.OBLIGATORIO,
      modos: MODOS_FORMULARIO, ambito: 'material' },
    { id: 'material_origen',   etiqueta: 'Material · Origen',    defecto: MODOS.OPCIONAL,
      modos: MODOS_FORMULARIO, ambito: 'material' },
    // La foto se sube DESPUÉS de sellar (de pie frente al cliente no se puede): por eso la
    // evidencia no admite "obligatorio" que bloquea, solo "obligatorio después".
    { id: 'evidencia',         etiqueta: 'Evidencia',            defecto: MODOS.OBLIGATORIO_DESPUES,
      modos: [MODOS.OBLIGATORIO_DESPUES, MODOS.OPCIONAL, MODOS.OCULTO] },
    { id: 'tipo_evidencia',    etiqueta: 'Tipo de evidencia',    defecto: MODOS.OCULTO },
    { id: 'fecha_documento',   etiqueta: 'Fecha del documento',  defecto: MODOS.OCULTO },
    // Oculto por defecto en general: solo tiene sentido para tipos de seguimiento. "Seguimiento"
    // lo trae "obligatorio después" abajo (TIPOS_POR_DEFECTO); otros tipos lo dejan oculto
    // salvo que Administración lo active a mano para alguno.
    { id: 'resultado_seguimiento', etiqueta: 'Resultado del seguimiento', defecto: MODOS.OCULTO,
      modos: [MODOS.OBLIGATORIO, MODOS.OBLIGATORIO_DESPUES, MODOS.OPCIONAL, MODOS.SOLO_LECTURA, MODOS.OCULTO] }
];

export const IDS_CAMPOS = CAMPOS_ACTIVIDAD.map(c => c.id);

const POR_DEFECTO = Object.fromEntries(CAMPOS_ACTIVIDAD.map(c => [c.id, c.defecto]));
const CAMPO_POR_ID = Object.fromEntries(CAMPOS_ACTIVIDAD.map(c => [c.id, c]));

// ---------- formularios que no son la actividad ----------

/**
 * Visita, sector y estrategia: mismo modelo que la actividad (cada campo declara su modo),
 * pero UNA sola configuración por formulario, no una por tipo.
 *
 * `fijo: true` = lo necesita el sistema (agenda, calendario, Sheets, a quién se le atribuye).
 * Se muestra en Administración para que se vea por qué no se puede tocar, pero siempre es
 * obligatorio. Los defaults reproducen el comportamiento de antes: desplegar esto no cambia
 * nada hasta que alguien configure algo.
 */
export const FORMULARIOS = {
    visita: {
        etiqueta: 'Visita',
        campos: [
            { id: 'educador',   etiqueta: 'Educador',          fijo: true },
            { id: 'cliente',    etiqueta: 'Cliente',           fijo: true },
            { id: 'fecha',      etiqueta: 'Fecha',             fijo: true },
            { id: 'horario',    etiqueta: 'Horario',           fijo: true },
            { id: 'hospital',   etiqueta: 'Hospital',          defecto: MODOS.OBLIGATORIO },
            { id: 'motivo',     etiqueta: 'Motivo (visita administrativa o de evento)', defecto: MODOS.OBLIGATORIO },
            // No se puede ocultar: la lista de sectores ES el cuerpo de la visita. Lo que se
            // decide es si exigir al menos uno para guardar.
            { id: 'sectores',   etiqueta: 'Al menos un sector', defecto: MODOS.OBLIGATORIO, sinOculto: true },
            { id: 'estrategia', etiqueta: 'Estrategias',       defecto: MODOS.OPCIONAL },
            { id: 'notas',      etiqueta: 'Notas',             defecto: MODOS.OPCIONAL }
        ]
    },
    // Reagendar y cancelar piden un motivo: por defecto obligatorio (es lo que deja rastro de por qué
    // no se cumplió el plan), pero cada organización decide si lo exige. No se puede ocultar: el
    // campo es el único lugar donde se captura.
    reagendar: {
        etiqueta: 'Reagendar visita',
        campos: [
            { id: 'fecha',   etiqueta: 'Fecha',             fijo: true },
            { id: 'horario', etiqueta: 'Horario',           fijo: true },
            { id: 'motivo',  etiqueta: 'Motivo del cambio', defecto: MODOS.OBLIGATORIO, sinOculto: true }
        ]
    },
    cancelar: {
        etiqueta: 'Cancelar visita',
        campos: [
            { id: 'motivo', etiqueta: 'Motivo de la cancelación', defecto: MODOS.OBLIGATORIO, sinOculto: true }
        ]
    },
    sector: {
        etiqueta: 'Sector',
        campos: [
            { id: 'objetivo',       etiqueta: 'Objetivo',               defecto: MODOS.OBLIGATORIO },
            { id: 'origen',         etiqueta: 'Origen de la actividad', defecto: MODOS.OBLIGATORIO },
            { id: 'solicitado_por', etiqueta: 'Solicitado por',         defecto: MODOS.OBLIGATORIO }
        ]
    },
    estrategia: {
        etiqueta: 'Estrategia',
        campos: [
            { id: 'cliente',        etiqueta: 'Cliente',              fijo: true },
            { id: 'tipo',           etiqueta: 'Estrategia (tipo)',    defecto: MODOS.OPCIONAL },
            { id: 'descripcion',    etiqueta: 'Descripción',          defecto: MODOS.OPCIONAL },
            { id: 'sector',         etiqueta: 'Sector',               fijo: true },
            { id: 'grupo_articulo', etiqueta: 'Grupo de artículo',    fijo: true },
            { id: 'etapa',          etiqueta: 'Etapa',                defecto: MODOS.OPCIONAL },
            { id: 'estatus',        etiqueta: 'Estatus',              defecto: MODOS.OPCIONAL },
            { id: 'proyecto',       etiqueta: 'Proyecto / objetivo',  defecto: MODOS.OPCIONAL },
            { id: 'productos',      etiqueta: 'Productos',            defecto: MODOS.OPCIONAL },
            { id: 'observaciones',  etiqueta: 'Observaciones',        defecto: MODOS.OPCIONAL }
        ]
    }
};

/** Los modos que se pueden elegir para un campo de `FORMULARIOS`. Un campo fijo no se elige. */
export function modosDeFormulario(campo) {
    if (campo?.fijo) return [MODOS.OBLIGATORIO];
    return campo?.sinOculto ? MODOS_FORMULARIO.filter(m => m !== MODOS.OCULTO) : MODOS_FORMULARIO;
}

/**
 * Configuración de un formulario: { objetivo: 'obligatorio', ... }.
 * Dos capas: el default del campo y lo que Administración configuró. Un campo fijo ignora lo
 * configurado; un modo que el campo no admite cae en su default.
 */
export function configuracionFormulario(formulario) {
    const def = FORMULARIOS[formulario];
    if (!def) return {};

    const guardado = leerCatalogo()?.formularios?.[formulario];
    const campos = guardado && typeof guardado === 'object' ? guardado : {};

    const config = {};
    for (const c of def.campos) {
        if (c.fijo) { config[c.id] = MODOS.OBLIGATORIO; continue; }
        const m = String(campos[c.id] || '').trim().toLowerCase();
        config[c.id] = modosDeFormulario(c).includes(m) ? m : c.defecto;
    }
    return config;
}

export function modoEnFormulario(formulario, campoId) {
    return configuracionFormulario(formulario)[campoId] || MODOS.OPCIONAL;
}

/** ¿Bloquea el guardado si falta? Solo `obligatorio`: lo "obligatorio después" no bloquea. */
export function esRequeridoEn(formulario, campoId) {
    return modoEnFormulario(formulario, campoId) === MODOS.OBLIGATORIO;
}

export function esVisibleEn(formulario, campoId) {
    return modoEnFormulario(formulario, campoId) !== MODOS.OCULTO;
}

// ---------- reglas de captura ----------

/**
 * Reglas que Administración ajusta sin programar y que no son un "modo" de campo.
 *
 * El origen del material es el folio SAP de la mercancía sin cargo (o quién la entregó). En los
 * datos de AppSheet la mayoría son números de 6 dígitos, pero también hay "NA", "Sin folio" o
 * "PRUEBA": ese ruido es justo lo que estas reglas frenan.
 */
export const REGLAS_POR_DEFECTO = { origen_min_digitos: 6, origen_min_caracteres: 3 };

export function reglasCaptura() {
    const guardadas = leerCatalogo()?.reglas_captura;
    const entero = (v, porDefecto) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 ? n : porDefecto;
    };
    return {
        origen_min_digitos: entero(guardadas?.origen_min_digitos, REGLAS_POR_DEFECTO.origen_min_digitos),
        origen_min_caracteres: entero(guardadas?.origen_min_caracteres, REGLAS_POR_DEFECTO.origen_min_caracteres)
    };
}

/**
 * Qué le falta a un origen escrito, o '' si está bien. No decide si es obligatorio —eso es el modo
 * del campo—: solo que lo que se escribió tenga forma de origen.
 *
 *   solo números              → al menos `origen_min_digitos` dígitos (un folio)
 *   cualquier otra cosa       → al menos `origen_min_caracteres` caracteres, sin contar espacios
 *                               (incluye "4500-123": con símbolos ya no es un folio numérico)
 */
export function problemaDeOrigen(valor, reglas = reglasCaptura()) {
    const v = String(valor ?? '').trim();
    if (!v) return '';

    if (/^\d+$/.test(v)) {
        return v.length >= reglas.origen_min_digitos
            ? ''
            : `Un folio debe tener al menos ${reglas.origen_min_digitos} dígitos.`;
    }
    return v.replace(/\s+/g, '').length >= reglas.origen_min_caracteres
        ? ''
        : `Escribe al menos ${reglas.origen_min_caracteres} caracteres.`;
}

// ---------- listas ----------

export const TIPOS_POR_DEFECTO = [
    { nombre: 'Capacitación',             evidencia: true,  materiales: false },
    { nombre: 'Demostración de producto', evidencia: true,  materiales: true  },
    { nombre: 'Entrega de muestras',      evidencia: true,  materiales: true  },
    { nombre: 'Evaluación de producto',   evidencia: true,  materiales: true  },
    { nombre: 'Revisión de anaquel',      evidencia: false, materiales: false },
    { nombre: 'Atención a queja',         evidencia: true,  materiales: false },
    {
        nombre: 'Seguimiento', evidencia: false, materiales: false,
        // Igual que la evidencia: obligatorio, pero no bloquea "Guardar actividad" — se puede
        // completar después (modo "obligatorio después").
        campos: { resultado_seguimiento: MODOS.OBLIGATORIO_DESPUES }
    }
];

export const ORIGENES_POR_DEFECTO = ['BI', 'I&D', 'Gerencia de Marca', 'Ventas'];
export const AREAS_POR_DEFECTO = ['Área Usuaria', 'Otra'];
export const UNIDADES_POR_DEFECTO = ['Pieza', 'Paquete', 'Bulto', 'Caja', 'Cajilla', 'Pares'];
export const TIPOS_EVIDENCIA_POR_DEFECTO = ['Fotografía', 'Lista de asistencia', 'Documento firmado'];

const delCatalogo = (llave, porDefecto) => {
    const v = leerCatalogo()?.[llave];
    return Array.isArray(v) && v.length ? v : porDefecto;
};

// Todo lo que se ofrece en un menú sale en orden alfabético: nadie debería tener que recorrer una
// lista en el orden en que se tecleó la hoja para encontrar lo que busca.
export function tiposActividad()  { return ordenarEs(delCatalogo('tipos_actividad', TIPOS_POR_DEFECTO), t => t.nombre); }
export function origenes()        { return ordenarEs(delCatalogo('origenes', ORIGENES_POR_DEFECTO)); }
export function areas()           { return ordenarEs(delCatalogo('areas', AREAS_POR_DEFECTO)); }
export function unidades()        { return ordenarEs(delCatalogo('unidades', UNIDADES_POR_DEFECTO)); }
export function tiposEvidencia()  { return ordenarEs(delCatalogo('tipos_evidencia', TIPOS_EVIDENCIA_POR_DEFECTO)); }
/** Temas personalizados creados desde Administración → Apariencia. Sin catálogo, ninguno —
 *  los 3 temas base (`js/tema.js`) no dependen de esto y siguen funcionando igual. */
export function temas()           { return ordenarEs(delCatalogo('temas', []), t => t.nombre); }

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

/** "Grupo Cliente" de la hoja de Clientes (mapa `clientes_grupo`). Vacío si no hay dato. */
export function grupoDeCliente(cliente) {
    const mapa = leerCatalogo()?.clientes_grupo;
    if (!mapa || typeof mapa !== 'object') return '';
    return String(mapa[cliente] || '').trim();
}

/** Grupos de cliente distintos, para el filtro de Estrategias. */
export function gruposDeCliente() {
    const mapa = leerCatalogo()?.clientes_grupo;
    if (!mapa || typeof mapa !== 'object') return [];
    return ordenarEs(new Set(Object.values(mapa).map(g => String(g || '').trim()).filter(Boolean)));
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
    return ordenarEs(unicas);
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
    return ordenarEs(ocultos.length === 0 ? todos : todos.filter(s => !ocultos.includes(s)));
}

/** Todos los que existen en Materiales, escondidos incluidos. Solo lo usa Administración. */
export function sectoresDelCatalogo() {
    const v = leerCatalogo()?.sectores;
    return Array.isArray(v) ? ordenarEs(v) : [];
}

export function sectoresOcultos() {
    const v = leerCatalogo()?.sectores_ocultos;
    return Array.isArray(v) ? v : [];
}

// ---------- reglas por tipo ----------

/**
 * Normaliza un modo que venga de la hoja; lo que no se reconozca, o que el campo no admita,
 * cae en el default del campo.
 *
 * Dos compatibilidades con lo que ya hay en las hojas:
 *  - `obligatorio` en un campo que solo admite "obligatorio después" (la evidencia) se lee
 *    como eso: antes "obligatorio" ya significaba "no bloquea".
 *  - `resultado_seguimiento: obligatorio` mientras el catálogo no traiga `formularios` (nadie
 *    ha guardado con esta versión) también: lo grabó el panel viejo con la semántica de
 *    entonces, y leerlo literal bloquearía de golpe los seguimientos de todos.
 */
function modoValido(valor, porDefecto, campoId) {
    const m = String(valor || '').trim().toLowerCase();
    if (!MODOS_VALIDOS.includes(m)) return porDefecto;

    const campo = CAMPO_POR_ID[campoId];
    const permitidos = modosPermitidos(campo);

    if (m === MODOS.OBLIGATORIO) {
        const heredado = campoId === 'resultado_seguimiento' && !leerCatalogo()?.formularios;
        if (heredado || !permitidos.includes(m)) {
            if (permitidos.includes(MODOS.OBLIGATORIO_DESPUES)) return MODOS.OBLIGATORIO_DESPUES;
        }
    }
    return permitidos.includes(m) ? m : porDefecto;
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
        if (def.evidencia === true) config.evidencia = MODOS.OBLIGATORIO_DESPUES;
        if (def.materiales === true) config.materiales = MODOS.OBLIGATORIO;
        if (def.materiales === false) config.materiales = MODOS.OCULTO;

        // Capa 3: lo que Administración configuró campo por campo.
        const campos = def.campos && typeof def.campos === 'object' ? def.campos : {};
        for (const id of IDS_CAMPOS) {
            if (campos[id] != null && campos[id] !== '') {
                config[id] = modoValido(campos[id], config[id], id);
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

/** Obligatorio, bloquee o no el guardado. */
export function campoObligatorio(tipo, campoId) {
    const m = modoCampo(tipo, campoId);
    return m === MODOS.OBLIGATORIO || m === MODOS.OBLIGATORIO_DESPUES;
}

export function campoEditable(tipo, campoId) {
    const m = modoCampo(tipo, campoId);
    return m === MODOS.OBLIGATORIO || m === MODOS.OBLIGATORIO_DESPUES || m === MODOS.OPCIONAL;
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

/** Solo cuenta como deuda lo que el tipo declara obligatorio. */
export function requiereEvidencia(actividad) {
    return campoObligatorio(actividad?.tipo, 'evidencia');
}

/**
 * ¿La "Fecha del documento" se pide al SUBIR la evidencia y no al capturar la actividad?
 *
 * Si la evidencia es obligatoria (se sube después de guardar), el documento que se adjunta es el
 * que tiene esa fecha: preguntarla antes, sin tener el documento a la mano, solo invitaba a
 * inventarla. Con la evidencia opcional u oculta no hay un momento de subida garantizado, así que
 * la fecha se queda en el formulario de la actividad como siempre. Con la fecha oculta o de solo
 * lectura tampoco hay nada que preguntar.
 */
export function fechaDocumentoEnEvidencia(tipo) {
    if (!tipo) return false;
    const config = configuracionCampos(tipo);
    return config.evidencia === MODOS.OBLIGATORIO_DESPUES
        && (config.fecha_documento === MODOS.OBLIGATORIO || config.fecha_documento === MODOS.OPCIONAL);
}

/**
 * ¿A esta actividad le FALTA la fecha del documento?
 *
 * Solo cuando se pide al subir la evidencia (evidencia obligatoria), la fecha es obligatoria, ya
 * hay un archivo adjunto (en cola o subido) y todavía no se capturó. Mientras falte, la evidencia
 * NO se sube y se avisa a la persona: subirla sin fecha dejaría en la nube un dato obligatorio vacío.
 */
export function fechaDocumentoFaltante(actividad) {
    if (!actividad || actividad.fecha_documento) return false;
    if (!fechaDocumentoEnEvidencia(actividad.tipo)) return false;
    if (configuracionCampos(actividad.tipo).fecha_documento !== MODOS.OBLIGATORIO) return false;
    const estado = actividad.evidencia?.estado;
    return estado === 'local' || estado === 'subida';
}

/** El resultado de un seguimiento que se dejó "obligatorio después" y aún no se captura. */
export function resultadoPendiente(actividad) {
    return modoCampo(actividad?.tipo, 'resultado_seguimiento') === MODOS.OBLIGATORIO_DESPUES
        && !String(actividad?.resultado_seguimiento || '').trim();
}

/** Lo que el tipo exige, para poder anunciarlo ANTES de pintar los campos. */
export function camposExtra(tipo) {
    if (!tipo) return [];
    const config = configuracionCampos(tipo);
    return CAMPOS_ACTIVIDAD
        .filter(c => !c.ambito)
        .filter(c => config[c.id] === MODOS.OBLIGATORIO || config[c.id] === MODOS.OBLIGATORIO_DESPUES)
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
export function materialesDe(sectores) {
    const todos = leerCatalogo()?.materiales;
    if (!Array.isArray(todos)) return [];

    // Acepta un sector o varios ("Subir actividad" aplica una actividad a varios a la vez). Con
    // varios, un mismo material puede estar en más de un sector: se ofrece una sola vez.
    const elegidos = new Set([].concat(sectores ?? []));
    const delosElegidos = todos.filter(m => elegidos.has(m.sector));
    if (elegidos.size > 1) {
        const vistos = new Set();
        return ordenarEs(delosElegidos.filter(m => {
            if (vistos.has(m.material)) return false;
            vistos.add(m.material);
            return true;
        }), m => m.material);
    }
    return ordenarEs(delosElegidos, m => m.material);
}

/**
 * Buscador. Empareja por palabras sueltas y en cualquier orden: quien busca "gasa 10x10"
 * debe encontrar "GASA SIMPLE 10X10 CM", que no contiene esa cadena literal.
 */
export function buscarMateriales(sector, consulta, limite = 40, grupo = '') {
    // Con grupo, estricto: solo los materiales de ese grupo de artículo, ninguno sin grupo.
    const lista = grupo
        ? materialesDe(sector).filter(m => m.grupo_articulo === grupo)
        : materialesDe(sector);
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
    return ordenarEs(delCatalogo('grupos_articulo', GRUPOS_ARTICULO_POR_DEFECTO));
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
    return grupos.length > 0 ? ordenarEs(grupos) : gruposArticulo();
}

// ---------- catálogos de Estrategia ----------
//
// Viven en Supabase (pdt_estrategia_tipos/pdt_etapas), administrables desde Administración —
// no en esta hoja. `doGet()` en Apps Script los agrega al mismo paquete de catálogos que ya se
// descarga para clientes/materiales/etc., así que se leen del mismo `leerCatalogo()` de
// siempre. Estos valores por defecto solo importan antes de la primera descarga.

export const TIPOS_ESTRATEGIA_POR_DEFECTO = [
    'Recuperación', 'Conversión', 'Catalogación', 'Ventas', 'BI', 'Desviación', 'Incremento'
];

export const ETAPAS_POR_DEFECTO = [
    'Presentación', 'Capacitación', 'Evaluación', 'Solicitud Muestra', 'Equipamiento',
    'Aceptado', 'Negociación', 'Cotización', 'Pedido', 'Venta', 'Rechazado', 'Descartado'
];

export const ESTATUS_POR_DEFECTO = ['Pendiente', 'En curso', 'En revisión'];

/**
 * Cómo termina una estrategia. No son etapas: son acciones que la archivan, con comentario
 * obligatorio. `descripcion` es lo que ve quien decide; `pregunta` es lo que se le pide explicar.
 */
export const DESENLACES = {
    finalizado: {
        etiqueta: 'Finalizar', participio: 'Finalizada',
        descripcion: 'Se concretó satisfactoriamente: se logró el objetivo.',
        pregunta: '¿Cómo se logró?'
    },
    cerrado: {
        etiqueta: 'Cerrar', participio: 'Cerrada',
        descripcion: 'No se concretó el negocio: no se logró el objetivo.',
        pregunta: '¿Por qué no se concretó?'
    }
};

/** Un catálogo ya descargado puede traer aún Finalizado/Cerrado: no se ofrecen como etapa ni estatus. */
const esDesenlace = (n) => ['finalizado', 'cerrado'].includes(String(n).trim().toLowerCase());

export function estatusEstrategia() {
    return delCatalogo('estatus_estrategia', ESTATUS_POR_DEFECTO).filter(n => !esDesenlace(n));
}

/** Definiciones de negocio de cada tipo: apoyo cuando el catálogo descargado no trae descripción. */
export const DESCRIPCIONES_TIPO_POR_DEFECTO = {
    'Conversión': 'Inclusión de una línea de productos que el cliente actualmente no compra.',
    'Catalogación': 'Aumentar el número de productos que el cliente compra de una línea.',
    'Recuperación': 'Recuperar venta de productos que antes compraba el cliente.',
    'Desviación': 'Recuperar volumen de consumo de un producto o línea de productos que ya compra el cliente.',
    'Incremento': 'Aumentar el volumen de consumo de un producto o línea de productos que ya compra el cliente.',
    'Ventas': 'Requerimiento directo realizado por el área de ventas.',
    'BI': 'Oportunidad de negocio identificada por el área de Business Intelligence (BI).'
};

/** Solo los nombres, para el `<select>` de "Estrategia" al capturar. */
export function tiposEstrategia() {
    const v = leerCatalogo()?.estrategia_tipos;
    // Alfabético, no por el `orden` que fija el administrador: es un menú, y se busca por nombre.
    // (Las ETAPAS sí conservan su orden: siguen el flujo de una estrategia.)
    if (Array.isArray(v) && v.length) return ordenarEs(v.map(t => t.nombre));
    return ordenarEs(TIPOS_ESTRATEGIA_POR_DEFECTO);
}

/** La ayuda de cada tipo (el "qué significa"), para mostrarla junto al select. */
export function descripcionTipoEstrategia(nombre) {
    const v = leerCatalogo()?.estrategia_tipos;
    const fila = Array.isArray(v) ? v.find(t => t.nombre === nombre) : null;
    return fila?.descripcion || DESCRIPCIONES_TIPO_POR_DEFECTO[nombre] || '';
}

export function etapasEstrategia() {
    return delCatalogo('etapas_estrategia', ETAPAS_POR_DEFECTO).filter(n => !esDesenlace(n));
}
