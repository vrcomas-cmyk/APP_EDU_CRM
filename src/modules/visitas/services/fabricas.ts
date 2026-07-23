/**
 * Cómo nace una visita.
 *
 * Funciones puras: reciben lo que necesitan y devuelven el objeto. No tocan almacenamiento ni
 * generan efectos, para que la regla de qué se copia y qué no pueda probarse sin montar nada.
 */

import type { Visita, Sector, Sesion } from '@core/tipos';

/** Se inyecta para que estas fábricas sean deterministas en las pruebas. */
export type GeneradorId = (prefijo: string) => string;

export interface DatosNuevaVisita {
    dia?: string;
    hora_inicio?: string;
    hora_fin?: string;
    /** Prellenados al generar la visita desde una Estrategia — igual que arrastrar sobre el
     *  calendario, esto no es un valor por defecto: el clic en la Estrategia ya eligió cliente
     *  y sectores, así que llegan puestos en vez de obligar a repetirlos a mano. */
    cliente?: string;
    zona?: string;
    ejecutivo?: string;
    id_estrategia?: string;
    sectorNombres?: string[];
}

/**
 * Una visita nueva nace como BORRADOR: no existe para nadie hasta que se guarde.
 *
 * Fecha y horario llegan VACÍOS a propósito. Antes se sembraban con hoy y 09:00, y bastaba
 * abrir el formulario sin querer para dejar una cita real en el calendario con una fecha que
 * nadie eligió. Un campo vacío obliga a decidir; uno prellenado se acepta sin leerlo.
 *
 * La excepción es arrastrar sobre el calendario: ahí el gesto YA eligió día y horas, así que
 * llegan puestas. Eso no es un valor por defecto, es lo que el usuario acaba de señalar.
 */
export function nuevaVisita(
    {
        dia = '', hora_inicio = '', hora_fin = '',
        cliente = '', zona, ejecutivo, id_estrategia, sectorNombres
    }: DatosNuevaVisita,
    sesion: Sesion | null,
    nuevoId: GeneradorId
): Visita {
    const sectores: Sector[] = (sectorNombres || []).map(nombre => ({
        id: nuevoId('s'),
        nombre,
        objetivo: '',
        origen: [],
        actividades: []
    }));

    return {
        id: nuevoId('v'),
        educador: sesion?.nombre || '',
        educador_correo: sesion?.correo || '',
        cliente,
        zona,
        ejecutivo,
        id_estrategia,
        hospital: '',
        dia, hora_inicio, hora_fin,
        estado: 'programada',
        reagendas: [],
        sectores,
        sincronizado: false,
        borrador: true
    };
}

/**
 * Duplicar copia la ESTRUCTURA, nunca lo que pasó en sitio.
 *
 * Una visita se repite mucho por cliente: mismo hospital, mismos sectores con el mismo
 * objetivo. Eso se copia porque es la plantilla de trabajo.
 *
 * Lo que NO se copia son las actividades, el check-in/out y las evidencias, y no es una
 * omisión por comodidad: son el registro de que alguien estuvo en un lugar a una hora e hizo
 * algo. Arrastrarlos a una visita nueva fabricaría un hecho que no ocurrió, con foto y todo.
 *
 * Los sectores se copian con id NUEVO. Reusar el id haría que ambas visitas apuntaran al mismo
 * sector, y un comentario escrito en una aparecería en la otra.
 */
export function duplicarVisita(
    original: Visita,
    sesion: Sesion | null,
    nuevoId: GeneradorId
): Visita {
    const sectores: Sector[] = (original.sectores || []).map(s => ({
        id: nuevoId('s'),
        nombre: s.nombre,
        objetivo: s.objetivo || '',
        origen: [...(s.origen || [])],
        solicitado_por: s.solicitado_por || '',
        actividades: []
    }));

    return {
        id: nuevoId('v'),
        // El educador es quien duplica, no quien hizo la original: la visita nueva es suya.
        educador: sesion?.nombre || original.educador || '',
        educador_correo: sesion?.correo || original.educador_correo || '',
        cliente: original.cliente || '',
        hospital: original.hospital || '',
        dia: original.dia,
        hora_inicio: original.hora_inicio,
        hora_fin: original.hora_fin,
        estado: 'programada',
        reagendas: [],
        sectores,
        sincronizado: false,
        borrador: true
    };
}

/**
 * El sello que se estampa al guardar. Sella la visita y, en el mismo acto, sus sectores: a
 * partir de ese clic objetivo, origen y solicitado_por dejan de editarse.
 */
export function selloDeGuardado(sesion: Sesion | null, ahora: Date = new Date()) {
    return { momento: ahora.toISOString(), usuario: sesion?.nombre || '' };
}

/**
 * Aplica el sello a una visita: le quita el borrador y sella los sectores que no lo estuvieran.
 *
 * Los ya sellados no se tocan. En una visita ya guardada se pueden agregar sectores nuevos, y
 * volver a estampar los viejos reescribiría la fecha en que de verdad se registraron.
 */
export function sellarVisita(visita: Visita, sello: ReturnType<typeof selloDeGuardado>): void {
    delete visita.borrador;
    (visita.sectores || []).forEach(s => {
        if (!s.guardado) s.guardado = { ...sello };
    });
}
