/**
 * Autorización.
 *
 * La regla que hace que esto sirva: **nunca se pregunta por el rol**. Ni aquí ni en ningún
 * otro archivo. `if (rol === 'admin')` esparcido por la app significa que crear un rol nuevo
 * —"supervisor regional", "coordinador de zona"— obliga a buscar y editar cada condición, y
 * la que se olvide se convierte en una fuga silenciosa que nadie ve hasta que alguien lee lo
 * que no debía.
 *
 * Se pregunta por la CAPACIDAD: `can('visitas', 'crear')`. Los permisos vienen de la base de
 * datos, no del código. Agregar un rol es insertar filas, no desplegar.
 *
 * ── Por qué no hay lista de denegados ────────────────────────────────────────────────
 *
 * La ausencia de permiso ES la negación. Con dos listas —permitidos y denegados— la pregunta
 * "¿y si está en las dos?" no tiene respuesta obvia, y las respuestas no obvias en control de
 * acceso terminan en fugas.
 */

import type { Perfil, Permiso } from '@core/tipos';

/**
 * De dónde sale el perfil. Se inyecta para que este módulo no dependa de cómo se obtuvo
 * —Supabase, caché o respaldo offline—: su único trabajo es decidir, no cargar.
 */
export type LectorDePerfil = () => Perfil | null;

let leerPerfil: LectorDePerfil = () => null;

export function configurarPerfil(lector: LectorDePerfil): void {
    leerPerfil = lector;
}

/**
 * ¿Puede el usuario hacer `accion` en `modulo`?
 *
 * Sin perfil devuelve `false`. No saber quién eres no es permiso para nada: el lado seguro
 * ante la duda es cerrar, porque lo que se protege son datos de pacientes y de clientes.
 */
export function can(modulo: string, accion: string): boolean {
    const perfil = leerPerfil();
    if (!perfil) return false;

    // El administrador no se enumera: enumerarlo obligaría a recordar cada permiso nuevo en
    // dos lugares, y el que se olvide deja al admin sin poder hacer su trabajo.
    if (perfil.es_admin) return true;

    return perfil.permisos.includes(`${modulo}.${accion}`);
}

/** Igual, pero con el permiso ya escrito como `modulo.accion`. */
export function canDo(permiso: Permiso): boolean {
    const punto = permiso.indexOf('.');
    if (punto <= 0) return false;
    return can(permiso.slice(0, punto), permiso.slice(punto + 1));
}

/** ¿Puede TODAS? Para habilitar una acción que necesita varias capacidades. */
export function canAll(...permisos: Permiso[]): boolean {
    return permisos.every(canDo);
}

/** ¿Puede ALGUNA? Para mostrar una sección que tiene varias entradas posibles. */
export function canAny(...permisos: Permiso[]): boolean {
    return permisos.some(canDo);
}

/**
 * Correos que este usuario puede ver: el suyo y los de quien tenga a cargo, a cualquier
 * profundidad. Lo resuelve Postgres con un recorrido recursivo, no el cliente: calcularlo
 * aquí exigiría descargar el organigrama completo, que es justo lo que no debe salir.
 */
export function alcance(): string[] {
    return leerPerfil()?.alcance ?? [];
}

const norm = (s: string) => s.trim().toLowerCase();

export function enAlcance(correo: string | undefined | null): boolean {
    if (!correo) return false;
    const objetivo = norm(correo);
    return alcance().some(c => norm(c) === objetivo);
}

/** ¿Tiene gente a cargo? Es lo que distingue una vista personal de una gerencial. */
export function tieneEquipo(): boolean {
    return alcance().length > 1;
}

/**
 * Estado de la invitación: `true` la tiene, `false` no, `null` todavía no se ha podido
 * preguntar.
 *
 * Los tres valores importan. Negar por no saber dejaría fuera a un educador que abre la app
 * en un sótano sin cobertura, que es exactamente cuando más necesita capturar.
 */
export function estadoInvitacion(): boolean | null {
    const perfil = leerPerfil();
    if (!perfil) return null;
    return perfil.invitado;
}

export function accesoBloqueado(): boolean {
    return estadoInvitacion() === false;
}
