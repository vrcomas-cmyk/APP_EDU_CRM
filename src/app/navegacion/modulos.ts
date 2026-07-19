/**
 * El registro de módulos.
 *
 * Es una LISTA DE DATOS, no una serie de condiciones repartidas por la app. Agregar CRM,
 * Reportes o Analytics es añadir una entrada aquí; el riel, el orden y las reglas de acceso
 * salen solos.
 *
 * ── Quién ve qué ─────────────────────────────────────────────────────────────────────
 *
 * Cada módulo declara su propia condición de acceso y NUNCA pregunta por el rol. Un educador
 * ve el calendario y su tablero personal; un gerente ve además revisión; un administrador lo
 * ve todo. Lo que no se puede abrir no se dibuja: un botón que lleva a "no tienes permiso" es
 * una promesa rota, y además revela que el módulo existe.
 */

import { puede, esAdministrador, flujosDisponibles, conteoPendientes } from '@core/puente';

export type ClaveModulo = 'calendario' | 'dashboard' | 'revision' | 'administracion';

export interface Modulo {
    clave: ClaveModulo;
    nombre: string;
    /** Rótulo corto para la barra inferior, donde no caben dos palabras. */
    corto: string;
    icono: string;
    /** ¿Este usuario puede entrar? Se evalúa en cada pintado: el perfil llega tarde. */
    disponible: () => boolean;
    /** Número que se muestra sobre el icono, si lo hay. Cero se oculta. */
    insignia?: () => number;
    /** Barra de contexto propia en la appbar (fechas, vistas del calendario). */
    contexto?: boolean;
    /**
     * Todavía se abre como MODAL en vez de ser una vista.
     *
     * Es transitorio: `admin.js` sigue siendo vanilla y construye su propio panel a pantalla
     * completa. Al portarlo, esta bandera desaparece con él y el campo entero se borra. Se
     * declara aquí en vez de esconderse en el shell para que la deuda se vea desde el registro.
     */
    modal?: boolean;
}

export const MODULOS: Modulo[] = [
    {
        clave: 'calendario',
        nombre: 'Calendario',
        corto: 'Agenda',
        icono: '🗓',
        // Sin condición: es la pantalla de trabajo. Quien entra a la app viene a esto.
        disponible: () => true,
        contexto: true
    },
    {
        clave: 'dashboard',
        nombre: 'Indicadores',
        corto: 'Datos',
        icono: '📊',
        disponible: () => puede('dashboards', 'personal')
    },
    {
        clave: 'revision',
        nombre: 'Revisión',
        corto: 'Revisar',
        icono: '✓',
        // Los dos permisos, y no solo los flujos: la cola sale de `consultarVisitas()`, que
        // devuelve vacío sin `visitas.consultar`. Con flujos pero sin consulta, la bandeja
        // está garantizadamente vacía y el botón solo promete trabajo que no se puede ver.
        disponible: () => flujosDisponibles().length > 0 && puede('visitas', 'consultar'),
        insignia: () => {
            try {
                return conteoPendientes().total;
            } catch {
                // Los pendientes dependen de datos que pueden no haber cargado. Un badge no
                // vale tumbar la navegación entera.
                return 0;
            }
        }
    },
    {
        clave: 'administracion',
        nombre: 'Administración',
        corto: 'Admin',
        icono: '⚙',
        disponible: () => esAdministrador(),
        modal: true
    }
];

/** Los que este usuario puede abrir, en orden. */
export function modulosDisponibles(): Modulo[] {
    return MODULOS.filter(m => {
        try {
            return m.disponible();
        } catch {
            return false;   // ante la duda, no se ofrece
        }
    });
}

export function moduloDe(clave: ClaveModulo): Modulo | undefined {
    return MODULOS.find(m => m.clave === clave);
}

/**
 * Resuelve a qué módulo ir.
 *
 * Si el pedido no está disponible —el perfil cambió, o se restauró una sesión con menos
 * permisos— cae al primero que sí lo esté en vez de dejar la pantalla en blanco.
 */
export function resolverModulo(pedido: ClaveModulo | null): ClaveModulo {
    const disponibles = modulosDisponibles().filter(m => !m.modal);
    if (pedido && disponibles.some(m => m.clave === pedido)) return pedido;
    return disponibles[0]?.clave ?? 'calendario';
}
