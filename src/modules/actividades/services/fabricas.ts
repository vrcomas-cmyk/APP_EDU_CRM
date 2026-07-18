/**
 * Cómo nace y cómo se sella una actividad.
 */

import type { Actividad, Sello, Sesion } from '@core/tipos';

export type GeneradorId = (prefijo: string) => string;

/**
 * Una actividad nace como BORRADOR y se persiste de inmediato.
 *
 * Lo segundo es deliberado y es distinto de la visita: la actividad cuelga de una visita que ya
 * existe, así que un borrador se ve en su lista y se puede retomar. Perder lo escrito por un
 * bloqueo de pantalla o un pasillo sin señal es el peor error posible aquí — "no lo guardé" no
 * es una explicación aceptable para quien capturó de pie frente al cliente.
 */
export function nuevaActividad(nuevoId: GeneradorId, ahora: Date = new Date()): Actividad {
    return {
        id: nuevoId('a'),
        tipo: '',
        area_visitada: '',
        creada: ahora.toISOString(),
        contacto: { nombre: '', cargo: '', servicio: '' },
        materiales: [],
        evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' }
    };
}

/**
 * El sello. A partir de aquí la actividad es un hecho histórico y no se edita.
 *
 * Guarda el DISPOSITIVO además de quién y cuándo: la actividad afirma que alguien hizo algo en
 * un lugar a una hora, y desde dónde se capturó es parte de esa afirmación.
 */
export function selloDeActividad(
    sesion: Sesion | null,
    dispositivo: string,
    ahora: Date = new Date()
): Sello {
    return {
        momento: ahora.toISOString(),
        usuario: sesion?.nombre || '',
        usuario_correo: sesion?.correo || '',
        dispositivo
    };
}

/** Texto del sello, tal como se lee en la ventana de una actividad ya guardada. */
export function textoDelSello(sello: Sello | undefined): string {
    if (!sello) return '—';

    // No se finge un sello que nunca existió: estas actividades se capturaron antes de que
    // hubiera guardado explícito, y presentar una firma inventada sería peor que no tenerla.
    if (sello.migrada) {
        return 'Registrada antes de que existiera el guardado con sello. No se edita.';
    }

    const cuando = sello.momento
        ? new Date(sello.momento).toLocaleString('es-MX', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        })
        : '—';

    return `Guardada el ${cuando}${sello.usuario ? ` por ${sello.usuario}` : ''}.`;
}
