/**
 * El borrador de Accesos (roles, capacidades, usuarios y jerarquía): cómo se arma, cómo se
 * valida y cómo se traduce a lo que esperan `guardarRoles`/`guardarUsuarios`.
 *
 * A diferencia del borrador de catálogos, esto no sale de una caché local: `leerRBAC` es una
 * ida de red. El borrador se materializa cuando esa respuesta llega, y de ahí en adelante se
 * edita igual que cualquier otro — ver `useRBAC`.
 */

import type { BorradorRBAC, CapacidadAdmin, RolAdmin, UsuarioAdmin } from '@core/tipos';

export const VACIO_RBAC: BorradorRBAC = { roles: [], capacidades: [], usuarios: [] };

// ---------- roles ----------

export function rolNuevo(): RolAdmin {
    return {
        clave: '', nombre: '', descripcion: null, orden: 0, activo: true, sistema: false,
        hereda_de: null, capacidades: [], efectivas: [], usuarios: 0, herederos: 0
    };
}

/**
 * Duplica un rol con una clave libre. No arrastra ni `sistema` ni cuántos lo usan: es un rol
 * nuevo que hoy no tiene a nadie, aunque haya nacido copiando las capacidades de otro.
 */
export function duplicarRol(r: RolAdmin, claveOcupada: (clave: string) => boolean): RolAdmin {
    const base = `${r.clave}_copia`;
    let clave = base;
    let n = 2;
    while (claveOcupada(clave)) { clave = `${base}_${n}`; n++; }

    return {
        ...r, clave, nombre: `${r.nombre} (copia)`, sistema: false, usuarios: 0, herederos: 0
    };
}

export function conCapacidad(r: RolAdmin, clave: string, concedida: boolean): RolAdmin {
    const capacidades = concedida
        ? (r.capacidades.includes(clave) ? r.capacidades : [...r.capacidades, clave])
        : r.capacidades.filter(c => c !== clave);
    return { ...r, capacidades };
}

/**
 * De qué roles puede heredar `clave` sin cerrar un ciclo: descarta al propio rol y a toda su
 * descendencia (quien hereda de él, directa o indirectamente).
 */
export function candidatosDeHerencia(roles: RolAdmin[], clave: string): RolAdmin[] {
    const excluidos = new Set<string>([clave]);
    let cambio = true;
    while (cambio) {
        cambio = false;
        for (const r of roles) {
            if (r.hereda_de && excluidos.has(r.hereda_de) && !excluidos.has(r.clave)) {
                excluidos.add(r.clave);
                cambio = true;
            }
        }
    }
    return roles.filter(r => !excluidos.has(r.clave));
}

/** Qué impide guardar los roles. Devuelve TODOS los problemas, no el primero. */
export function problemasDeRoles(roles: RolAdmin[]): string[] {
    const problemas: string[] = [];

    if (roles.some(r => !r.clave.trim())) {
        problemas.push('hay un rol sin clave');
    }
    if (roles.some(r => r.clave.trim() && !/^[a-z][a-z0-9_]*$/.test(r.clave.trim()))) {
        problemas.push('hay una clave de rol con mayúsculas, espacios o acentos');
    }

    const claves = roles.map(r => r.clave.trim().toLowerCase());
    if (new Set(claves).size !== claves.length) {
        problemas.push('hay dos roles con la misma clave');
    }

    return problemas;
}

// ---------- usuarios ----------

export function usuarioNuevo(): UsuarioAdmin {
    return { correo: '', nombre: '', activo: true, roles: [], invitacion: null, jefes: [], subordinados: [] };
}

export function conCorreoDeUsuario(usuarios: UsuarioAdmin[], indice: number, correo: string): UsuarioAdmin[] {
    const limpio = correo.trim().toLowerCase();
    return usuarios.map((u, i) => (i === indice ? { ...u, correo: limpio } : u));
}

export function conNombreDeUsuario(usuarios: UsuarioAdmin[], indice: number, nombre: string): UsuarioAdmin[] {
    return usuarios.map((u, i) => (i === indice ? { ...u, nombre } : u));
}

/**
 * Por ÍNDICE y no por correo: dos filas "+ Invitar" sin llenar comparten el mismo correo
 * vacío, y editar por correo tocaría las dos a la vez.
 */
export function conActivoDeUsuario(usuarios: UsuarioAdmin[], indice: number, activo: boolean): UsuarioAdmin[] {
    return usuarios.map((u, i) => (i === indice ? { ...u, activo } : u));
}

export function conRolesDeUsuario(usuarios: UsuarioAdmin[], indice: number, roles: string[]): UsuarioAdmin[] {
    return usuarios.map((u, i) => (i === indice ? { ...u, roles } : u));
}

/**
 * Quita una fila añadida en esta misma sesión y aún sin correo real. No hay forma de borrar
 * una cuenta ya existente —`pdt_usuario_guardar` no tiene ese camino, solo `activo:false`— así
 * que esto solo tiene sentido para deshacer un "+ Invitar" antes de guardar.
 */
export function sinUsuarioNuevo(usuarios: UsuarioAdmin[], indice: number): UsuarioAdmin[] {
    return usuarios.filter((_, i) => i !== indice);
}

export function problemasDeUsuarios(usuarios: UsuarioAdmin[]): string[] {
    const problemas: string[] = [];
    const correoValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

    if (usuarios.some(u => !correoValido.test(u.correo.trim()))) {
        problemas.push('hay un correo de usuario que no parece válido');
    }

    const correos = usuarios.map(u => u.correo.trim().toLowerCase());
    if (new Set(correos).size !== correos.length) {
        problemas.push('hay dos usuarios con el mismo correo');
    }

    return problemas;
}

// ---------- jerarquía ----------

export function conSubordinados(usuarios: UsuarioAdmin[], jefe: string, subordinados: string[]): UsuarioAdmin[] {
    return usuarios.map(u => (u.correo === jefe ? { ...u, subordinados } : u));
}

/**
 * Quita a `subordinado` de la lista de subordinados de `jefe`.
 *
 * Es la misma operación que desmarcar el chip desde la ficha del jefe, pero expresada desde el
 * lado del subordinado —"quítame a este jefe de encima"—, que es como se nota el problema
 * cuando alguien tiene un jefe de más y no sabía ni por dónde estaba.
 */
export function quitarJefe(usuarios: UsuarioAdmin[], jefe: string, subordinado: string): UsuarioAdmin[] {
    return conSubordinados(usuarios, jefe, usuarios.find(u => u.correo === jefe)?.subordinados.filter(c => c !== subordinado) ?? []);
}

/** Los jefes actuales de `correo`, para mostrarlos aunque no sea el jefe elegido en pantalla. */
export function jefesDe(usuarios: UsuarioAdmin[], correo: string): UsuarioAdmin[] {
    return usuarios.filter(u => u.subordinados.includes(correo));
}

/**
 * ¿Poner a `candidato` bajo `jefe` cerraría un ciclo? Se ve mirando si el candidato YA tiene a
 * `jefe` en su propio alcance —directo o de varios saltos—, con los datos que hay en pantalla.
 *
 * Es una guarda de cliente, no la autoridad: el servidor (`pdt_jerarquia_guardar`) vuelve a
 * comprobarlo contra la base real y es el que de verdad puede rechazarlo. Esta solo evita el
 * caso obvio antes de gastar una ida de red.
 */
export function cerrariaCiclo(usuarios: UsuarioAdmin[], jefe: string, candidato: string): boolean {
    if (jefe === candidato) return true;

    const vistos = new Set<string>();
    const pendientes = [candidato];
    while (pendientes.length > 0) {
        const actual = pendientes.pop()!;
        if (actual === jefe) return true;
        if (vistos.has(actual)) continue;
        vistos.add(actual);

        const u = usuarios.find(x => x.correo === actual);
        if (u) pendientes.push(...u.subordinados);
    }
    return false;
}

// ---------- payload para el servidor ----------

/**
 * Roles a enviar y roles a borrar.
 *
 * Se reenvían TODOS los roles actuales —`pdt_rol_guardar` hace upsert— y se listan para borrar
 * los que estaban en la carga original y ya no están en la lista de trabajo. Los roles de
 * sistema nunca entran a `eliminar`: el servidor los rechazaría igual, pero no vale la pena
 * gastar la ida de red en algo que no puede pasar desde esta pantalla.
 */
export function rolesParaGuardar(original: RolAdmin[], actual: RolAdmin[]) {
    const clavesActuales = new Set(actual.map(r => r.clave));
    const eliminar = original
        .filter(r => !r.sistema && !clavesActuales.has(r.clave))
        .map(r => r.clave);

    const roles = actual.map(r => ({
        clave: r.clave.trim().toLowerCase(),
        nombre: r.nombre,
        descripcion: r.descripcion,
        orden: r.orden,
        activo: r.activo,
        hereda_de: r.hereda_de,
        capacidades: r.capacidades
    }));

    return { roles, eliminar };
}

export function usuariosParaGuardar(actual: UsuarioAdmin[]) {
    return actual.map(u => ({
        correo: u.correo.trim().toLowerCase(),
        nombre: u.nombre,
        activo: u.activo,
        roles: u.roles
    }));
}

/**
 * Jefes a incluir en el envío: los que tienen subordinados ahora, o los tenían al cargar —para
 * poder mandar la lista vacía y así vaciarlos de verdad. `pdt_jerarquia_guardar` reemplaza por
 * jefe completo: no enviar una entrada deja esos subordinados intactos, aunque en pantalla se
 * hayan quitado todos.
 */
export function jerarquiaParaGuardar(original: UsuarioAdmin[], actual: UsuarioAdmin[]) {
    const relevantes = new Set<string>();
    for (const u of original) if (u.subordinados.length > 0) relevantes.add(u.correo);
    for (const u of actual) if (u.subordinados.length > 0) relevantes.add(u.correo);

    const porCorreo = new Map(actual.map(u => [u.correo, u]));

    return [...relevantes].map(jefe => ({
        jefe,
        subordinados: porCorreo.get(jefe)?.subordinados ?? []
    }));
}

/** Capacidades agrupadas y ordenadas, listas para pintar la cuadrícula. */
export function capacidadesPorGrupo(capacidades: CapacidadAdmin[]): Array<[string, CapacidadAdmin[]]> {
    const grupos = new Map<string, CapacidadAdmin[]>();
    for (const c of [...capacidades].sort((a, b) => a.orden - b.orden)) {
        const lista = grupos.get(c.grupo) ?? [];
        lista.push(c);
        grupos.set(c.grupo, lista);
    }
    return [...grupos.entries()];
}
