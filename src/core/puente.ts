/**
 * Puente hacia los módulos vanilla que todavía no se han portado.
 *
 * Existe solo mientras dure la migración. Su trabajo es contener el `any`: `js/*.js` no está
 * anotado, así que sin este archivo cada componente importaría funciones sin tipo y el `any`
 * se derramaría por toda la capa nueva — que es exactamente cómo se pierde la ventaja de
 * haber migrado a TypeScript.
 *
 * Cuando un módulo de `js/` se porte a `src/`, se borra su bloque de aquí y los componentes
 * pasan a importarlo directo. Este archivo debe ENCOGER con cada iteración; si crece, la
 * migración se está estancando.
 */

import * as _estado from '../../js/estado.js';
import * as _catalogos from '../../js/catalogos.js';
import * as _visita from '../../js/visita.js';
import * as _fechas from '../../js/fechas.js';
import * as _geo from '../../js/geo.js';
import * as _auth from '../../js/auth.js';
import * as _eventos from '../../js/eventos.js';

import type {
    Visita, Sector, Actividad, Marca, Sesion, SaludVisita, EstadoSector, ModoCampo,
    IndicadoresEducador, Revision, ResultadoRevision, FlujoRevision, Perfil,
    PendienteRevision, Comentario, CampoConfigurable, Catalogo, BorradorCatalogo,
    ResultadoFlujo, RolAdmin, CapacidadAdmin, UsuarioAdmin, FlujoAdmin
} from './tipos';

// ---------- estado (salud, ciclo de vida, tiempo) ----------

export const ESTADOS = _estado.ESTADOS as Record<string, string>;

export const saludDe = _estado.saludDe as (v: Visita) => SaludVisita;
export const estadoDe = _estado.estadoDe as (v: Visita) => string;
export const detalleEstado = _estado.detalleEstado as (v: Visita) => string;
export const duracionTexto = _estado.duracionTexto as (v: Visita) => string;
export const permanenciaTexto = _estado.permanenciaTexto as (v: Visita) => string | null;
export const tieneCheckIn = _estado.tieneCheckIn as (v: Visita) => boolean;
export const tieneCheckOut = _estado.tieneCheckOut as (v: Visita) => boolean;
export const estaGuardada = _estado.estaGuardada as (a: Actividad) => boolean;
export const estadoSector = _estado.estadoSector as (v: Visita, s: Sector) => EstadoSector;
export const etiquetaSector = _estado.etiquetaSector as (e: string) => string;
export const buscarSolapes = _estado.buscarSolapes as (
    visitas: Visita[], candidata: Visita, ignorarId?: string | null
) => Visita[];

// ---------- catálogos ----------

export const requiereEvidencia = _catalogos.requiereEvidencia as (a: Actividad) => boolean;

export const MODOS = _catalogos.MODOS as Record<string, ModoCampo>;
export const configuracionCampos = _catalogos.configuracionCampos as (
    tipo?: string
) => Record<string, ModoCampo>;
export const campoVisible = _catalogos.campoVisible as (tipo: string | undefined, campo: string) => boolean;
export const campoEditable = _catalogos.campoEditable as (tipo: string | undefined, campo: string) => boolean;
export const camposExtra = _catalogos.camposExtra as (tipo?: string) => string[];
export const tiposActividad = _catalogos.tiposActividad as () => Array<{ nombre: string }>;
export const areas = _catalogos.areas as () => string[];
export const tiposEvidencia = _catalogos.tiposEvidencia as () => string[];
export const sectores = _catalogos.sectores as () => string[];
export const origenes = _catalogos.origenes as () => string[];

export const ETIQUETAS_MODO = _catalogos.ETIQUETAS_MODO as Record<string, string>;
/**
 * Los campos capturables de una actividad. Es la ÚNICA fuente de qué se puede configurar:
 * Administración se dibuja recorriéndola y el formulario de captura también.
 */
export const CAMPOS_ACTIVIDAD = _catalogos.CAMPOS_ACTIVIDAD as CampoConfigurable[];
export const IDS_CAMPOS = _catalogos.IDS_CAMPOS as string[];
/** Todos los sectores que existen en Materiales, escondidos incluidos. */
export const sectoresDelCatalogo = _catalogos.sectoresDelCatalogo as () => string[];

import { leerCatalogo as _leerCatalogo } from '../../js/storage.js';
export const leerCatalogo = _leerCatalogo as () => Catalogo | null;

import * as _sync from '../../js/sync.js';
export const guardarCatalogosAdmin = _sync.guardarCatalogosAdmin as (
    cambios: BorradorCatalogo
) => Promise<unknown>;
export const descargarCatalogo = _sync.descargarCatalogo as () => Promise<unknown>;

/** Roles, catálogo de capacidades y usuarios, en una sola ida. Ver `js/sync.js: leerRBAC`. */
export const leerRBAC = _sync.leerRBAC as () => Promise<{
    roles: RolAdmin[];
    capacidades: CapacidadAdmin[];
    usuarios: UsuarioAdmin[];
}>;

/** Guarda roles y borra los que se pidieron borrar. */
export const guardarRoles = _sync.guardarRoles as (cambios: {
    roles: Array<{
        clave: string; nombre: string; descripcion: string | null; orden: number;
        activo: boolean; hereda_de: string | null; capacidades: string[];
    }>;
    eliminar: string[];
}) => Promise<unknown>;

/** Guarda usuarios —con su conjunto de roles— y la jerarquía de quién ve a quién. */
export const guardarUsuarios = _sync.guardarUsuarios as (cambios: {
    usuarios: Array<{ correo: string; nombre: string | null; activo: boolean; roles: string[] }>;
    jerarquia: Array<{ jefe: string; subordinados: string[] }>;
}) => Promise<unknown>;

/** Todos los flujos de revisión (activos e inactivos), con su conteo de uso. Ver `js/sync.js: leerFlujos`. */
export const leerFlujosAdmin = _sync.leerFlujos as () => Promise<{ flujos: FlujoAdmin[] }>;

/** Guarda flujos de revisión y borra los que se pidieron borrar. */
export const guardarFlujosAdmin = _sync.guardarFlujos as (cambios: {
    flujos: Array<{
        clave: string; nombre: string; descripcion: string | null;
        ambito: 'visita' | 'actividad'; permiso: string; activo: boolean; orden: number;
        resultados: ResultadoFlujo[] | null;
    }>;
    eliminar: string[];
}) => Promise<unknown>;

export const describirDispositivo = _geo.describirDispositivo as () => string;

// ---------- acciones de negocio ----------

/**
 * Todas devuelven un resultado en vez de lanzar. Una acción que falla —sin GPS, sin cliente,
 * ya finalizada— es un caso normal aquí, no una excepción.
 */
export interface Resultado {
    ok: boolean;
    error?: string;
    visita?: Visita;
    ubicacion?: { error?: string; precision_m?: number };
    permanencia_min?: number | null;
}

export const iniciarVisita = _visita.iniciarVisita as (id: string) => Promise<Resultado>;
export const finalizarVisita = _visita.finalizarVisita as (id: string) => Promise<Resultado>;
export const cancelarVisita = _visita.cancelarVisita as (id: string, motivo: string) => Resultado;
export const reactivarVisita = _visita.reactivarVisita as (id: string) => Resultado;
export const reagendarVisita = _visita.reagendarVisita as (
    id: string,
    datos: { dia: string; hora_inicio: string; hora_fin: string; motivo: string }
) => Resultado;

export const puedeIniciar = _visita.puedeIniciar as (v: Visita) => boolean;
/** Motivo por el que no se pueden capturar actividades, o `null` si sí se puede. */
export const bloqueoParaActividades = _visita.bloqueoParaActividades as (v: Visita) => string | null;

// ---------- fechas, ubicación, sesión ----------

export const etiquetaDiaLarga = _fechas.etiquetaDiaLarga as (dia?: string) => string;
export const claveDia = _fechas.claveDia as (d: Date | string) => string;
export const claveHoy = _fechas.claveHoy as () => string;
export const desdeClave = _fechas.desdeClave as (clave: string) => Date;
export const sumarDias = _fechas.sumarDias as (d: Date, n: number) => Date;
export const sumarMeses = _fechas.sumarMeses as (d: Date, n: number) => Date;
export const diasDeSemana = _fechas.diasDeSemana as (d: Date) => string[];
export const diasDeCuadriculaMes = _fechas.diasDeCuadriculaMes as (d: Date) => string[];
export const etiquetaMes = _fechas.etiquetaMes as (d: Date) => string;
export const etiquetaRangoSemana = _fechas.etiquetaRangoSemana as (d: Date) => string;
export const inicialesDias = _fechas.inicialesDias as () => string[];
export const DIAS_ABREV = _fechas.DIAS_ABREV as string[];
export const hora = _fechas.hora as (h: string) => string;
/** Lunes de la semana que contiene a `fecha` (la semana laboral arranca en lunes). */
export const inicioSemana = _fechas.inicioSemana as (fecha: Date) => Date;

export const SALUD = _estado.SALUD as Record<string, string>;
export const duracionHoras = _estado.duracionHoras as (v: Visita) => number;
export const inicioDe = _estado.inicioDe as (v: Visita) => Date | null;
export const finDe = _estado.finDe as (v: Visita) => Date | null;
export const repartirEnColumnas = _estado.repartirEnColumnas as (
    visitas: Visita[]
) => Array<{ visita: Visita; columna: number; columnas: number }>;
export const describirUbicacion = _geo.describirUbicacion as (m: Marca) => string;
export const precisionDudosa = _geo.precisionDudosa as (u: unknown) => boolean;
export const sesionActual = _auth.sesionActual as () => Sesion | null;

export const registrar = _eventos.registrar as (
    tipo: string, visita: Visita, extra?: Record<string, unknown>
) => void;
export const TIPOS_EVENTO = _eventos.TIPOS as Record<string, string>;

// ---------- consulta e indicadores ----------

import * as _datos from '../../js/datos.js';
import * as _revisiones from '../../js/revisiones.js';
import * as _permisos from '../../js/permisos.js';

export interface Filtro {
    educador: string; cliente: string; hospital: string; sector: string;
    tipo_actividad: string; estado: string; desde: string; hasta: string;
}

export interface Indicadores {
    visitas: number; programadas: number; en_proceso: number; finalizadas: number;
    canceladas: number; realizadas: number; pendientes: number;
    actividades: number; actividades_borrador: number;
    sectores: number; sectores_distintos: number;
    materiales: number; piezas: number;
    evidencias_pendientes: number; evidencias_subidas: number;
    reagendaciones: number; retrasos: number;
    minutos_efectivos: number; horas_efectivas: number; cumplimiento: number;
    por_educador: Record<string, number>; por_tipo: Record<string, number>;
    por_sector: Record<string, number>; por_cliente: Record<string, number>;
    por_hospital: Record<string, number>; por_dia: Record<string, number>;
}

export const consultarVisitas = _datos.consultarVisitas as (f?: Partial<Filtro>) => Visita[];
export const calcularIndicadores = _datos.calcularIndicadores as (v: Visita[]) => Indicadores;
export const indicadoresPorEducador = _datos.indicadoresPorEducador as (
    v: Visita[]
) => IndicadoresEducador[];
export const opcionesDeFiltro = _datos.opcionesDeFiltro as (v?: Visita[]) => {
    educadores: string[]; clientes: string[]; hospitales: string[];
    sectores: string[]; tipos: string[]; estados: string[];
};
export const filtroVacio = _datos.filtroVacio as () => Filtro;
export const top = _datos.top as (mapa: Record<string, number>, n?: number) => Array<[string, number]>;

/** Dónde vive el archivo de una evidencia, o `null` si no hay nada que mostrar todavía. */
export const urlEvidencia = _datos.urlEvidencia as (
    actividad: Actividad
) => { tipo: 'remota' | 'local'; url?: string; id?: string; mime: string } | null;

export const etiquetaEstado = _estado.etiquetaEstado as (e: string) => string;
export const ESTADOS_VISITA = _estado.ESTADOS as Record<string, string>;

export const revisionVigente = _revisiones.revisionVigente as (
    flujo: string, idAmbito: string
) => Revision | null;
export const RESULTADOS = _revisiones.RESULTADOS as Record<string, ResultadoRevision>;
export const flujosDisponibles = _revisiones.flujosDisponibles as () => FlujoRevision[];
export const conteoPendientes = _revisiones.conteoPendientes as (
    visitas?: Visita[]
) => { porFlujo: Record<string, number>; total: number };

export const ETIQUETAS_RESULTADO = _revisiones.ETIQUETAS_RESULTADO as Record<string, string>;

/** Los veredictos que admite un flujo: los suyos, o los tres de siempre. */
export const resultadosDe = _revisiones.resultadosDe as (
    flujo: FlujoRevision | string
) => ResultadoFlujo[];
export const resultadoDe = _revisiones.resultadoDe as (
    flujo: FlujoRevision | string, valor: string
) => ResultadoFlujo | null;
export const pendientesDe = _revisiones.pendientesDe as (
    flujo: FlujoRevision, visitas?: Visita[]
) => PendienteRevision[];
export const historialDe = _revisiones.historialDe as (
    flujo: string, idAmbito: string
) => Revision[];
export const minutosDeRetraso = _revisiones.minutosDeRetraso as (v: Visita) => number;

/**
 * Registra una revisión. Devuelve `{ ok: false, error }` en vez de lanzar: los rechazos que
 * importan aquí —sin permiso, sin explicación— son cosas que el revisor debe LEER, no
 * excepciones.
 */
export const revisar = _revisiones.revisar as (datos: {
    flujo: string;
    ambito: string;
    idAmbito: string;
    idVisita: string;
    resultado: ResultadoRevision;
    observaciones?: string;
}) => { ok: boolean; error?: string; revision?: Revision };

import * as _comentarios from '../../js/comentarios.js';
export const comentariosDeVisita = _comentarios.comentariosDeVisita as (
    idVisita: string
) => Comentario[];
/** Lo que ya se dijo antes de este hospital, de lo más reciente hacia atrás. */
export const historicoDeHospital = _comentarios.historicoDeHospital as (
    hospital: string, opciones?: { excluirVisita?: string | null; limite?: number }
) => Comentario[];

import * as _hilo from '../../js/hilo.js';
/** Los cuatro ámbitos a los que se puede enganchar un comentario. */
export const AMBITOS = _hilo.AMBITOS as { VISITA: string; SECTOR: string; ACTIVIDAD: string; EVIDENCIA: string };
/** El hilo de comentarios completo (lista + redactor), como nodo DOM. Se monta con `NodoVanilla`. */
export const hiloComentarios = _hilo.hiloComentarios as (opciones: {
    ambito: string;
    idAmbito: string;
    visita?: Visita;
    alToast?: Avisar;
    compacto?: boolean;
}) => HTMLElement;

import * as _vistaprevia from '../../js/vistaprevia.js';
/** Devuelve un nodo DOM; se monta con `NodoVanilla` hasta que se porte. */
export const miniaturaEvidencia = _vistaprevia.miniaturaEvidencia as (
    actividad: Actividad
) => HTMLElement | null;

export const puede = _permisos.puede as (modulo: string, accion: string) => boolean;
export const perfilActual = _permisos.perfilActual as () => Perfil | null;
export const tieneEquipo = _permisos.tieneEquipo as () => boolean;
export const esAdministrador = _permisos.esAdministrador as () => boolean;

// ---------- avisos ----------

export type EstadoAviso = 'completa' | 'sin-registrar' | 'programada' | 'faltan-evidencias';

export interface OpcionesAviso {
    estado?: EstadoAviso;
    ms?: number;
    accion?: { texto: string; fn: () => void };
}

export type Avisar = (mensaje: string, opciones?: OpcionesAviso) => void;
