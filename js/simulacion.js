/**
 * "Ver como": un administrador prueba lo que ve otro rol u otra persona, sin cerrar su sesión.
 *
 * ── Por qué `sessionStorage` y no `localStorage` ─────────────────────────────────────────
 *
 * La simulación tiene que morir con la pestaña. `pdt_perfil_cache` (en `permisos.js`) es la
 * caché del usuario REAL y vive en `localStorage` a propósito, para servir offline; si la
 * simulación compartiera almacén, un cierre accidental de sesión con la simulación puesta
 * podría dejarla pegada a la sesión de otra persona en el mismo dispositivo. Con
 * `sessionStorage`, cerrar la pestaña ya la borra sola.
 *
 * ── Por qué esto NO decide permisos ──────────────────────────────────────────────────────
 *
 * Este módulo solo GUARDA y ARMA el perfil simulado; no decide quién puede entrar a simular.
 * Esa decisión la toma `permisos.js` contra el perfil REAL (`perfilReal()`), nunca contra el
 * simulado — si se mirara el simulado, entrar a un rol sin `administracion.configurar` dejaría
 * al propio admin sin permiso para salir de su simulación.
 *
 * ── Por qué es de solo lectura ────────────────────────────────────────────────────────────
 *
 * Las escrituras (Apps Script, `postear`) se cortan aparte, en `appsScript.ts`, mirando
 * `simulacionActiva()`. Aquí no hace falta repetirlo: ni `simularUsuario` ni `simularRol`
 * tocan nada que escriba.
 */

import { rpcEstricto } from '../src/services/supabase/rpc';

const CLAVE = 'pdt_simulacion';

function leer() {
    try { return JSON.parse(sessionStorage.getItem(CLAVE)) || null; }
    catch { return null; }
}

function guardar(estado) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(estado)); }
    catch { /* si no cabe, la simulación simplemente no persiste entre recargas */ }
}

export function simulacionActiva() {
    return leer() !== null;
}

/** Metadata para pintar el banner: quién se está simulando, sin exponer el perfil completo. */
export function estadoSimulacion() {
    const e = leer();
    return e ? { tipo: e.tipo, ref: e.ref, nombre: e.nombre } : null;
}

export function perfilSimulado() {
    return leer()?.perfil || null;
}

/**
 * Simula a una persona real: pide su perfil de verdad a Supabase (`pdt_perfil`), así que
 * alcance, zonas y clientes_extra quedan tan coherentes entre sí como los de esa persona hoy.
 * Es la vía FIEL: lo que se ve es exactamente lo que vería ese correo.
 */
export async function simularUsuario(correo) {
    const limpio = String(correo || '').trim().toLowerCase();
    if (!limpio) throw new Error('Hace falta un correo para simular.');

    const datos = await rpcEstricto('pdt_perfil', { p_correo: limpio });
    if (!datos || typeof datos !== 'object') throw new Error('No se pudo leer el perfil de ese correo.');

    const perfil = {
        correo: datos.correo || limpio,
        nombre: datos.nombre || limpio,
        rol: datos.rol || 'educador',
        es_admin: datos.es_admin === true,
        permisos: Array.isArray(datos.permisos) ? datos.permisos : [],
        alcance: Array.isArray(datos.alcance) ? datos.alcance : [limpio],
        zonas: Array.isArray(datos.zonas) ? datos.zonas : [],
        clientes_extra: Array.isArray(datos.clientes_extra) ? datos.clientes_extra : [],
        invitado: datos.invitado === true,
        invitacion_estado: datos.invitacion_estado || 'sin_invitacion',
        origen: 'simulacion'
    };

    guardar({ tipo: 'usuario', ref: limpio, nombre: perfil.nombre, perfil });
    return perfil;
}

/**
 * Simula un ROL suelto, sin persona detrás: útil para probar un rol recién creado que todavía
 * no tiene a nadie asignado. `efectivas` ya viene con la herencia resuelta por Postgres
 * (`pdt_rol_capacidades`, ver `useRBAC`/`pdt_roles_admin`).
 *
 * Es la vía RÁPIDA pero NO fiel en datos: un rol no tiene territorio propio, así que
 * `alcance`/`zonas`/`clientes_extra` quedan vacíos. Se ven los MENÚS y CAPACIDADES del rol,
 * pero ninguna lista filtrada por alcance o zona va a mostrar nada. Para fidelidad de datos,
 * simular por usuario.
 */
export function simularRol({ clave, nombre, efectivas }) {
    if (!clave) throw new Error('Hace falta la clave del rol a simular.');

    const permisos = Array.isArray(efectivas) ? efectivas : [];
    const perfil = {
        correo: '',
        nombre: `Rol simulado: ${nombre || clave}`,
        rol: clave,
        es_admin: permisos.includes('administracion.configurar'),
        permisos,
        alcance: [],
        zonas: [],
        clientes_extra: [],
        invitado: true,
        invitacion_estado: 'aceptada',
        origen: 'simulacion'
    };

    guardar({ tipo: 'rol', ref: clave, nombre: perfil.nombre, perfil });
    return perfil;
}

export function salirSimulacion() {
    try { sessionStorage.removeItem(CLAVE); } catch { /* da igual */ }
}
