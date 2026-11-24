/**
 * Carga del histórico, con memoria.
 *
 * El histórico son datos de antes de esta app: fijos y de solo lectura. Aun así cada visita a la
 * pantalla volvía a pedir las dos listas a Apps Script (~4 s cada una, y más si van juntas), y en
 * desarrollo `StrictMode` ejecuta el efecto dos veces, así que salían 4 peticiones idénticas.
 *
 * Aquí se hace una sola vez por persona y sesión:
 *   · si ya hay una petición en camino, quien llega después comparte ESA (no duplica);
 *   · si ya llegó bien, se devuelve al instante;
 *   · si falla (red, error del servidor), NO se guarda: el siguiente intento vuelve a pedir.
 *
 * La llave incluye el correo: otra persona que inicie sesión en el mismo navegador no debe ver el
 * histórico de la anterior.
 */

import { leerHistoricoActividades, leerHistoricoPlanTrabajo, sesionActual } from '@core/puente';

type RespuestaActividades = Awaited<ReturnType<typeof leerHistoricoActividades>>;
type RespuestaPlan = Awaited<ReturnType<typeof leerHistoricoPlanTrabajo>>;
export type RespuestaHistorico = [RespuestaActividades, RespuestaPlan];

let llave = '';
let enCamino: Promise<RespuestaHistorico> | null = null;

const llaveActual = () => String(sesionActual()?.correo || '').toLowerCase();

/** Olvida lo guardado (p. ej. para forzar una recarga o al cerrar sesión). */
export function olvidarHistorico(): void {
    llave = '';
    enCamino = null;
}

export function cargarHistorico(): Promise<RespuestaHistorico> {
    const actual = llaveActual();

    // Otra persona: lo anterior no le corresponde.
    if (llave !== actual) olvidarHistorico();
    if (enCamino) return enCamino;

    llave = actual;
    const peticion: Promise<RespuestaHistorico> = Promise.all([
        leerHistoricoActividades(), leerHistoricoPlanTrabajo()
    ]).then((par) => {
        // Una respuesta con error del servidor tampoco se queda: se reintenta la próxima vez.
        if (par[0].status === 'error' || par[1].status === 'error') {
            if (enCamino === peticion) enCamino = null;
        }
        return par;
    }, (err) => {
        if (enCamino === peticion) enCamino = null;
        throw err;
    });

    enCamino = peticion;
    return peticion;
}
