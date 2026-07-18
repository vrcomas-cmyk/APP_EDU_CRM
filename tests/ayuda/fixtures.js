/**
 * Constructores de datos de prueba.
 *
 * Cada uno arma la forma MÍNIMA válida y acepta un objeto para pisar lo que a la prueba le
 * importa. Así cada prueba dice solo lo que está probando: si una prueba menciona
 * `check_in`, es porque el check-in es el tema, no porque haga falta para construir el objeto.
 */

let contador = 0;
const id = (p) => `${p}-prueba-${++contador}`;

export function visita(campos = {}) {
    return {
        id: id('v'),
        educador: 'Ana López',
        educador_correo: 'ana@degasa.com',
        cliente: 'Cliente Uno',
        hospital: 'Hospital General',
        dia: '2026-07-15',
        hora_inicio: '09:00',
        hora_fin: '11:00',
        estado: 'programada',
        reagendas: [],
        sectores: [],
        sincronizado: false,
        ...campos
    };
}

export function sector(campos = {}) {
    return {
        id: id('s'),
        nombre: 'GASAS',
        objetivo: 'Revisar rotación',
        origen: ['BI'],
        solicitado_por: 'Gerencia',
        guardado: { momento: '2026-07-15T09:00:00.000Z', usuario: 'Ana López' },
        actividades: [],
        ...campos
    };
}

/** Actividad SELLADA: cuenta como registro. Es el caso normal. */
export function actividad(campos = {}) {
    return {
        id: id('a'),
        tipo: 'Capacitación',
        area_visitada: 'Área Usuaria',
        creada: '2026-07-15T09:30:00.000Z',
        guardada: {
            momento: '2026-07-15T09:35:00.000Z',
            usuario: 'Ana López',
            usuario_correo: 'ana@degasa.com',
            dispositivo: 'Android'
        },
        contacto: { nombre: 'Dr. Pérez', cargo: 'Jefe', servicio: 'Urgencias' },
        materiales: [],
        evidencia: { estado: 'subida', nombre: 'foto.jpg', mime: 'image/jpeg', url: 'https://x/1' },
        ...campos
    };
}

/** Actividad en captura: existe en el teléfono pero todavía no afirma nada. */
export function borrador(campos = {}) {
    const a = actividad(campos);
    delete a.guardada;
    return a;
}

/** Marca de haber estado ahí. `hora` es local, para poder probar retrasos. */
export function checkIn(hora = '09:00', campos = {}) {
    return {
        momento: momentoLocal('2026-07-15', hora),
        lat: 19.4, lng: -99.1, precision_m: 12,
        direccion: 'Av. Siempre Viva 1',
        usuario: 'Ana López',
        dispositivo: 'Android',
        ...campos
    };
}

export function checkOut(hora = '11:00', campos = {}) {
    return {
        momento: momentoLocal('2026-07-15', hora),
        lat: 19.4, lng: -99.1, precision_m: 12,
        usuario: 'Ana López',
        ...campos
    };
}

/**
 * ISO en hora LOCAL. `new Date('2026-07-15T09:00')` sin zona se interpreta distinto según el
 * motor, y los retrasos se calculan con `getHours()`, que es local: construirlo en UTC haría
 * que la prueba pasara o fallara según la zona horaria de quien la corre.
 */
export function momentoLocal(dia, hora) {
    const [a, m, d] = dia.split('-').map(Number);
    const [hh, mm] = hora.split(':').map(Number);
    return new Date(a, m - 1, d, hh, mm).toISOString();
}

/** Atajo: visita completa y sana — llegó, registró y subió su evidencia. */
export function visitaCompleta(campos = {}) {
    return visita({
        estado: 'finalizada',
        check_in: checkIn('09:00'),
        check_out: checkOut('11:00'),
        sectores: [sector({ actividades: [actividad()] })],
        ...campos
    });
}
