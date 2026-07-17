/**
 * Bitácora de eventos de negocio.
 *
 * Cada acción deja un evento inmutable. No es un log de depuración: es el registro del que
 * van a colgar los indicadores y el CRM más adelante. Por eso se guarda lo que pasó y cuándo
 * pasó DE VERDAD, no cuando se sincronizó.
 *
 * Se escribe en modo append y nunca se edita: un evento que se puede corregir no sirve para
 * auditar nada.
 */

import { nuevoId } from './storage.js';
import { describirDispositivo } from './geo.js';

const CLAVE = 'eventos';
const MAX_LOCALES = 2000;   // ~400KB; a partir de ahí solo crecería sin que nadie los lea

export const TIPOS = {
    VISITA_PROGRAMADA: 'Visita Programada',
    VISITA_REAGENDADA: 'Visita Reagendada',
    VISITA_CANCELADA: 'Visita Cancelada',
    CHECK_IN: 'Check-in Realizado',
    ACTIVIDAD: 'Actividad Registrada',
    MATERIAL: 'Material Registrado',
    CONTACTO: 'Contacto Registrado',
    EVIDENCIA: 'Evidencia Cargada',
    CHECK_OUT: 'Check-out Realizado',
    VISITA_FINALIZADA: 'Visita Finalizada'
};

export function leerEventos() {
    try {
        const crudo = localStorage.getItem(CLAVE);
        return crudo ? JSON.parse(crudo) : [];
    } catch (err) {
        console.error('Bitácora ilegible:', err);
        return [];
    }
}

/**
 * Registra un evento. `datos` lleva solo lo que el evento significa, no la visita entera:
 * duplicarla aquí la volvería a contar y la haría mentir cuando la visita cambie.
 */
export function registrar(tipo, visita, datos = {}) {
    const eventos = leerEventos();

    eventos.push({
        id: nuevoId('e'),
        tipo,
        momento: new Date().toISOString(),
        id_visita: visita?.id || '',
        cliente: visita?.cliente || '',
        hospital: visita?.hospital || '',
        educador: visita?.educador || '',
        educador_correo: visita?.educador_correo || '',
        dispositivo: describirDispositivo(),
        datos,
        sincronizado: false
    });

    // Se podan los más viejos YA SINCRONIZADOS: los pendientes nunca se tiran, aunque
    // sobren, porque son los únicos que todavía no existen en ningún otro lado.
    if (eventos.length > MAX_LOCALES) {
        const pendientes = eventos.filter(e => !e.sincronizado);
        const subidos = eventos.filter(e => e.sincronizado);
        const conservar = Math.max(0, MAX_LOCALES - pendientes.length);
        localStorage.setItem(CLAVE, JSON.stringify([...subidos.slice(-conservar), ...pendientes]));
        return;
    }

    localStorage.setItem(CLAVE, JSON.stringify(eventos));
}

export function eventosPendientes() {
    return leerEventos().filter(e => !e.sincronizado);
}

export function marcarSincronizados(ids) {
    const set = new Set(ids);
    const eventos = leerEventos();
    eventos.forEach(e => { if (set.has(e.id)) e.sincronizado = true; });
    localStorage.setItem(CLAVE, JSON.stringify(eventos));
}

/** Historial de una visita, del más reciente al más viejo. Alimenta la línea de tiempo. */
export function eventosDe(idVisita) {
    return leerEventos()
        .filter(e => e.id_visita === idVisita)
        .sort((a, b) => b.momento.localeCompare(a.momento));
}
