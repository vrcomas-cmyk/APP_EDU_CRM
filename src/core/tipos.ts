/**
 * El modelo de datos, en un solo lugar.
 *
 * Estos tipos describen lo que YA se guarda en localStorage y se sincroniza con Sheets. No
 * son un diseño nuevo: son la forma existente, escrita. Cambiar algo aquí sin migrar el dato
 * guardado no arregla nada, solo hace que el compilador mienta.
 *
 * Por eso casi todo lo opcional lo es de verdad: hay visitas capturadas hace meses, en
 * versiones anteriores del modelo, que no tienen contacto ni sello ni correo. Marcar esos
 * campos como obligatorios describiría la app que nos gustaría tener, no la que corre.
 */

// ---------- ciclo de vida ----------

export type EstadoVisita = 'programada' | 'en-proceso' | 'finalizada' | 'cancelada';

/**
 * La salud del registro. Se CALCULA, no se guarda: es una lectura sobre lo capturado, y
 * persistirla permitiría que contradijera a los datos de los que sale.
 */
export type SaludVisita = 'neutra' | 'sin-registrar' | 'faltan-evidencias' | 'completa' | 'cancelada';

export type EstadoSector = 'pendiente' | 'en-proceso' | 'finalizado';

/** Modo de un campo capturable, resuelto por tipo de actividad desde Administración. */
export type ModoCampo = 'obligatorio' | 'opcional' | 'solo-lectura' | 'oculto';

// ---------- marcas de tiempo y lugar ----------

/**
 * El hecho de haber estado ahí. Inmutable una vez escrito.
 *
 * `precision_m` se guarda junto a las coordenadas a propósito: una ubicación sin su margen de
 * error invita a tratarla como exacta, y dentro de un hospital el GPS se equivoca por decenas
 * de metros con normalidad.
 */
export interface Marca {
    momento: string;                  // ISO 8601
    lat?: number;
    lng?: number;
    precision_m?: number;
    direccion?: string;
    usuario?: string;
    dispositivo?: string;
}

/**
 * Sello de guardado. Su PRESENCIA es lo que distingue un hecho de un borrador; no hay una
 * bandera `bloqueada` aparte que pudiera contradecirlo.
 */
export interface Sello {
    momento: string;
    usuario?: string;
    usuario_correo?: string;
    dispositivo?: string;
    /** El sello se reconstruyó en una migración; no lo puso nadie al guardar. */
    migrada?: boolean;
    migrado?: boolean;
}

export interface Reagenda {
    momento: string;
    usuario?: string;
    motivo?: string;
    antes: { dia: string; hora_inicio: string; hora_fin: string };
    despues: { dia: string; hora_inicio: string; hora_fin: string };
}

// ---------- el árbol ----------

/**
 * `pendiente` = todavía no se eligió archivo. `local` = hay archivo en el teléfono esperando
 * señal. `subida` = ya está en Drive.
 *
 * Los tres estados importan: `pendiente` y `local` se ven igual en la lista —falta evidencia—
 * pero solo `local` significa que hay algo que subir, y confundirlos haría que la cola
 * intentara enviar archivos que no existen.
 */
export type EstadoEvidencia = 'pendiente' | 'local' | 'subida';

/** Una evidencia es un ARCHIVO. Dónde vive lo decide el repositorio, no quien la muestra. */
export interface Evidencia {
    estado: EstadoEvidencia;
    nombre?: string;
    mime?: string;
    url?: string;
    tipo?: string;                    // "Fotografía", "Lista de asistencia"…
    fecha_documento?: string;
}

export interface Material {
    id: string;
    material: string;
    cantidad?: string | number;
    unidad?: string;
    origen?: string;
    sector?: string;
}

export interface Contacto {
    nombre?: string;
    cargo?: string;
    servicio?: string;
}

export interface Actividad {
    id: string;
    tipo?: string;
    area_visitada?: string;
    creada?: string;
    /** Sin sello es un borrador: existe para no perderse, pero todavía no afirma nada. */
    guardada?: Sello;
    contacto?: Contacto;
    materiales?: Material[];
    evidencia?: Evidencia;
    tipo_evidencia?: string;
    fecha_documento?: string;
}

export interface Sector {
    id: string;
    nombre: string;
    objetivo?: string;
    origen?: string[];
    solicitado_por?: string;
    /** Sin sello el sector sigue siendo editable: la visita aún es un borrador. */
    guardado?: Sello;
    actividades?: Actividad[];
}

export interface Visita {
    id: string;
    educador?: string;
    educador_correo?: string;
    cliente?: string;
    hospital?: string;
    /** "Gpo. vendedores" del cliente (hoja Clientes). Se resuelve solo al elegir el cliente;
     *  el campo queda editable por si el catálogo no trae ese cliente todavía. */
    zona?: string;
    /** Automático: Zona → Ejecutivo (hoja Ejecutivos). No es el "solicitado_por" del sector
     *  —ese es por sector y puede variar—; este es a quién le reporta esa zona. */
    ejecutivo?: string;
    /** Libre, distinta de los comentarios: una nota de planeación, no una conversación. */
    notas?: string;
    /** Qué Estrategia (Cliente × Sector × Grupo de Artículo) avanza esta visita, si el
     *  educador eligió una al agendar. Opcional: una visita sin estrategia sigue siendo una
     *  visita normal — no todo cliente tiene un plan activo. */
    id_estrategia?: string;
    dia?: string;                     // 'YYYY-MM-DD'
    hora_inicio?: string;             // 'HH:MM'
    hora_fin?: string;
    estado?: EstadoVisita | string;   // abierta a propósito: agregar uno no debe romper nada
    check_in?: Marca;
    check_out?: Marca;
    reagendas?: Reagenda[];
    motivo_cancelacion?: string;
    /** Visita en captura. Desaparece al guardar; su ausencia es lo que la vuelve real. */
    borrador?: boolean;
    sectores?: Sector[];
    sincronizado?: boolean;
    /** Id del evento espejo en Google Calendar (el del propio educador), si se conectó. */
    calendar_event_id?: string;
}

/**
 * Cliente × Sector × Grupo de Artículo: qué plan se va a trabajar ahí. A diferencia de una
 * visita, no tiene dueño ni sello — cualquier educador o gerente la escribe o la corrige, y el
 * último en guardar manda. Alimenta la planeación: al agendar un sector, esto dice qué se
 * pretende conseguir con ese cliente en ese grupo de artículo.
 */
export interface Estrategia {
    id: string;
    cliente: string;
    sector?: string;
    grupo_articulo?: string;
    etapa?: string;
    proyecto?: string;
    /** Materiales/productos involucrados — varios, elegidos del catálogo del sector (ver
     *  `buscarMateriales`). Antes era texto libre de uno solo; una fila vieja que aún traiga
     *  un string se envuelve en un arreglo de un elemento al leerla (`js/storage.js`). */
    productos?: string[];
    observaciones?: string;
    actualizado?: string;          // ISO 8601
    actualizado_por?: string;
    actualizado_correo?: string;
    sincronizado?: boolean;
}

// ---------- personas y permisos ----------

/** Un permiso es siempre `modulo.accion`. Nunca un rol: los roles cambian, los permisos no. */
export type Permiso = string;

export interface Perfil {
    correo: string;
    nombre: string;
    rol: string;
    es_admin: boolean;
    permisos: Permiso[];
    /** Correos que este usuario puede ver. Lo resuelve Postgres, no el cliente. */
    alcance: string[];
    /** Zonas que puede operar HOY (titular + cobertura vigente). Dimensión distinta de
     *  `alcance`: esa es jerarquía de personas, esta es territorio de clientes. */
    zonas: string[];
    /** true / false / null: "no tiene" y "todavía no sé" son cosas distintas. */
    invitado: boolean | null;
    invitacion_estado?: string;
    origen: 'supabase' | 'cache' | 'respaldo' | string;
}

export interface Sesion {
    correo: string;
    nombre?: string;
    foto?: string;
    id_token: string;
    expira?: number;
}

// ---------- comentarios y revisiones ----------

export type AmbitoComentario = 'visita' | 'sector' | 'actividad' | 'evidencia';

/** Un comentario nunca se edita ni se borra. */
export interface Comentario {
    id: string;
    ambito: AmbitoComentario;
    id_ambito: string;
    id_visita?: string;
    texto: string;
    /**
     * Quién lo escribió. Se llama `usuario` y no `autor` porque así lo escribe
     * `js/comentarios.js` y así viaja a Supabase; el tipo decía `autor` y nadie lo usaba,
     * de modo que el primer componente que lo leyera habría pintado `undefined` sin que
     * `tsc` dijera nada.
     */
    usuario?: string;
    usuario_correo?: string;
    momento: string;
    sincronizado?: boolean;
}

/**
 * El valor que se guarda como veredicto.
 *
 * Es `string` y no una unión cerrada a propósito: cada flujo declara los suyos y pueden
 * llegar de la base de datos sin desplegar la app. Los tres de siempre se nombran aparte
 * porque siguen siendo el vocabulario por defecto, no porque sean los únicos.
 */
export type ResultadoRevision = string;

export type ResultadoClasico = 'aprobado' | 'rechazado' | 'correccion';

/**
 * Un veredicto posible, con todo lo que la app necesita saber de él.
 *
 * Que esté todo aquí es el punto: ningún componente pregunta "¿este es el aprobado?" para
 * decidir un color, un estilo o si exige explicación.
 */
export interface ResultadoFlujo {
    /** Lo que se guarda y lo único que viaja al servidor. */
    valor: string;
    /** Participio, para el historial: «Aprobado el 3 de julio». */
    etiqueta: string;
    /** Imperativo, para el botón: «Aprobar». */
    accion: string;
    /** Cromía de salud, la misma del calendario y el tablero. */
    tono: string;
    /** Peso visual del botón. */
    estilo?: 'principal' | 'txt' | 'peligro';
    /** No se puede mandar sin explicar por qué. */
    exige_observaciones?: boolean;
    /**
     * El trabajo se da por bueno.
     *
     * Eje distinto de `cierra`: «rechazado» cierra la revisión y no acepta el trabajo;
     * «requiere corrección» ni acepta ni cierra. Un «parcial» futuro podría aceptar y cerrar.
     */
    acepta?: boolean;
    /** Saca el elemento de la cola. Si es `false`, vuelve al educador. */
    cierra?: boolean;
}

export interface FlujoRevision {
    clave: string;
    nombre: string;
    ambito: 'visita' | 'actividad';
    /** Permiso que habilita este flujo, en forma `modulo.accion`. */
    permiso: Permiso;
    orden: number;
    descripcion?: string;
    /**
     * Los veredictos que admite este flujo. Si falta, se usan los tres de siempre — que es
     * el caso de todos los flujos que ya existen en la base.
     */
    resultados?: ResultadoFlujo[];
}

export interface Revision {
    id: string;
    flujo: string;
    ambito: 'visita' | 'actividad';
    id_ambito: string;
    id_visita?: string;
    resultado: ResultadoRevision;
    observaciones?: string;
    revisor?: string;
    revisor_correo?: string;
    momento: string;
    /**
     * Desempate. Dentro de una transacción `now()` es constante, así que un lote subido junto
     * comparte `momento`; sin esto, "la revisión vigente" saldría al azar.
     */
    seq?: number;
    sincronizado?: boolean;
}

/**
 * Un elemento en la cola de revisión.
 *
 * Lo arma `js/revisiones.js` a partir del árbol de la visita. Trae la visita entera —y la
 * actividad, si el flujo es de ámbito actividad— porque el revisor necesita el contexto para
 * juzgar: quién, dónde, cuándo. Sin eso hay que abrir otra pantalla por cada elemento, y una
 * bandeja que obliga a eso se deja de revisar.
 */
export interface PendienteRevision {
    flujo: string;
    ambito: 'visita' | 'actividad';
    /** Id de lo que se revisa: la visita o la actividad, según el ámbito. */
    id_ambito: string;
    id_visita: string;
    educador?: string;
    educador_correo?: string;
    visita: Visita;
    titulo: string;
    detalle: string;
    actividad?: Actividad;
    sector?: Sector;
}

// ---------- catálogos y administración ----------

/** Una entrada de `CAMPOS_ACTIVIDAD`: qué campo es y en qué modo cae si nadie lo configura. */
export interface CampoConfigurable {
    id: string;
    etiqueta: string;
    defecto: ModoCampo;
}

export interface TipoActividad {
    nombre: string;
    /**
     * Banderas heredadas de cuando la configuración era booleana. Se conservan porque la hoja
     * de cálculo sigue teniendo esas columnas y un administrador las lee ahí; `campos` es la
     * fuente real.
     */
    evidencia?: boolean;
    materiales?: boolean;
    campos?: Record<string, ModoCampo>;
}

export interface Educador {
    nombre: string;
    correo: string;
}

/** Lo que Administración edita y sube. Es el catálogo entero, no un parche. */
export interface BorradorCatalogo {
    tipos_actividad: TipoActividad[];
    origenes: string[];
    areas: string[];
    unidades: string[];
    tipos_evidencia: string[];
    sectores_ocultos: string[];
    educadores: Educador[];
    /** Correos, no nombres: el correo es lo que la sesión verifica. */
    admins: string[];
}

/** Lo que hay guardado en local. Todo opcional: puede no haber sincronizado nunca. */
export interface Catalogo extends Partial<BorradorCatalogo> {
    /** Los sectores que existen en Materiales. No se editan aquí, se curan. */
    sectores?: string[];
}

// ---------- indicadores ----------

export interface IndicadoresEducador {
    correo: string;
    nombre: string;
    visitas: number;
    realizadas: number;
    canceladas: number;
    actividades: number;
    evidencias_pendientes: number;
    reagendaciones: number;
    minutos: number;
    /** Nunca debe pasar de 100: un porcentaje imposible desacredita todo el tablero. */
    cumplimiento: number;
    horas: number;
}

// ---------- RBAC: roles, capacidades, usuarios ----------

/**
 * Un rol tal como lo devuelve `pdt_roles_admin`.
 *
 * `capacidades` son las PROPIAS del rol —lo que la pantalla deja marcar—; `efectivas` suma las
 * heredadas de `hereda_de`, resueltas por Postgres. La pantalla edita `capacidades` y solo
 * muestra `efectivas` para que se vea qué concede de verdad.
 */
export interface RolAdmin {
    clave: string;
    nombre: string;
    descripcion: string | null;
    orden: number;
    activo: boolean;
    /** Un rol del sistema (p. ej. `administrador`) no se puede borrar ni desactivar. */
    sistema: boolean;
    hereda_de: string | null;
    capacidades: string[];
    efectivas: string[];
    /** Cuántos usuarios lo tienen hoy: si es más de cero, no se puede borrar. */
    usuarios: number;
    /** Cuántos roles heredan de él: si es más de cero, no se puede borrar. */
    herederos: number;
}

/** Una capacidad del catálogo, tal como la devuelve `pdt_capacidades_admin`. */
export interface CapacidadAdmin {
    clave: string;
    modulo: string;
    accion: string;
    nombre: string;
    descripcion: string | null;
    grupo: string;
    orden: number;
}

/**
 * Un usuario tal como lo devuelve `pdt_usuarios_admin`: sus roles y su jerarquía en un solo
 * lugar, porque las tres cosas —el correo, sus roles, a quién ve— se editan juntas.
 */
export interface UsuarioAdmin {
    correo: string;
    nombre: string | null;
    activo: boolean;
    roles: string[];
    invitacion: string | null;
    /** Quién ve a este correo en su alcance. */
    jefes: string[];
    /** A quién ve este correo en su alcance. Es lo que edita el panel de Jerarquía. */
    subordinados: string[];
}

/** Lo que la pantalla de Accesos edita: el espejo local de `leerRBAC`. */
export interface BorradorRBAC {
    roles: RolAdmin[];
    capacidades: CapacidadAdmin[];
    usuarios: UsuarioAdmin[];
}

// ---------- territorios ----------

/** Una zona con su titular. Una zona, un titular — nunca ambigua. */
export interface TitularZona {
    zona: string;
    educador_correo: string;
}

/**
 * Cobertura temporal: `educador_correo` puede operar `zona` sin dejar de existir el titular.
 * `id` es un uuid real una vez guardada en Supabase; una fila nueva sin guardar todavía usa un
 * id temporal generado en el cliente (ver `nuevaCobertura` en `borradorTerritorios.ts`) para
 * poder distinguirla de una ya existente al calcular el diff.
 */
export interface CoberturaZona {
    id: string;
    zona: string;
    educador_correo: string;
    desde: string;             // ISO 8601
    hasta: string | null;      // null = indefinida
    motivo: string | null;
    creado_por?: string;
}

/** Lo que la pantalla de Territorios edita: el espejo local de `leerTerritorios`. */
export interface BorradorTerritorios {
    titulares: TitularZona[];
    coberturas: CoberturaZona[];
}

// ---------- flujos de revisión administrables ----------

/**
 * Un flujo de revisión tal como lo devuelve `pdt_flujos_revision_admin`.
 *
 * `resultados` es `null` cuando el flujo usa los tres veredictos de siempre
 * (aprobado/rechazado/corrección) — ver `RESULTADOS_POR_DEFECTO` en `js/revisiones.js`.
 */
export interface FlujoAdmin {
    clave: string;
    nombre: string;
    descripcion: string | null;
    ambito: 'visita' | 'actividad';
    /** `modulo.accion`: debe existir en el catálogo de capacidades (`pdt_capacidades`). */
    permiso: string;
    activo: boolean;
    orden: number;
    resultados: ResultadoFlujo[] | null;
    /** Cuántas revisiones ya se guardaron con este flujo: si es más de cero, no se borra. */
    revisiones: number;
}

/** Lo que la pantalla de Flujos edita: el espejo local de `leerFlujos`. */
export interface BorradorFlujos {
    flujos: FlujoAdmin[];
}
