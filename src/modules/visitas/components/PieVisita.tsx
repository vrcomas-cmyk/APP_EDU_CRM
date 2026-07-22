/**
 * Pie del drawer. Es donde viven las acciones, y por eso donde más importa la jerarquía:
 * un solo botón principal por pantalla, el resto como texto.
 */

import { estadoDe, ESTADOS, tieneCheckOut } from '@core/puente';
import { faltaParaGuardar } from '../validators/requisitos';
import type { Visita } from '@core/tipos';

interface PropsPie {
    visita: Visita;
    enSector: boolean;
    reagendando: boolean;
    guardadoReciente: boolean;
    /** Visita de otra persona: se puede consultar, no reagendar ni cancelar. */
    soloLectura?: boolean;
    onVolver: () => void;
    onCerrar: () => void;
    onGuardar: () => void;
    onDuplicar: () => void;
    onReagendar: () => void;
    onCancelar: () => void;
}

export function PieVisita(props: PropsPie) {
    const { visita, enSector, onVolver } = props;

    if (enSector) {
        return (
            <div className="drawer-foot">
                <span style={{ flex: 1 }} />
                <button type="button" className="btn" onClick={onVolver}>
                    ‹ Volver a la visita
                </button>
            </div>
        );
    }

    return visita.borrador ? <PieBorrador {...props} /> : <PieGuardada {...props} />;
}

/**
 * Un borrador no tiene "Listo": tiene Guardar.
 *
 * El botón se queda deshabilitado hasta que no falte nada, pero al lado SIEMPRE se lee qué lo
 * impide. Un botón gris sin motivo se interpreta como que la app está rota, y el usuario deja
 * de intentarlo en vez de completar el campo que falta.
 */
function PieBorrador({ visita, onCerrar, onGuardar }: PropsPie) {
    const falta = faltaParaGuardar(visita);
    const listo = falta.length === 0;

    return (
        <div className="drawer-foot">
            <span className={'pista' + (listo ? ' es-ok' : '')}>
                {listo ? 'Listo para guardar.' : `Falta ${falta.join(' · ')}`}
            </span>
            <span style={{ flex: 1 }} />

            <button type="button" className="btn-txt peligro" onClick={onCerrar}>
                Descartar
            </button>
            <button
                type="button"
                className="btn btn-principal"
                disabled={!listo}
                title={listo ? undefined : `Falta: ${falta.join(', ')}`}
                onClick={onGuardar}
            >
                Guardar visita
            </button>
        </div>
    );
}

function PieGuardada({
    visita, reagendando, guardadoReciente, soloLectura, onCerrar, onDuplicar, onReagendar, onCancelar
}: PropsPie) {
    // Reagendar y cancelar dejan de tener sentido una vez que se marcó la salida: la visita
    // ya ocurrió, y moverla reescribiría un hecho. Tampoco tienen sentido sobre la visita de
    // otra persona: reagendarla o cancelarla la pasaría a nombre de quien la mira, no de quien
    // la capturó — el mismo motivo por el que `puedeEditarVisita` la bloquea al guardar.
    const movible = estadoDe(visita) !== ESTADOS.CANCELADA && !tieneCheckOut(visita) && !soloLectura;

    return (
        <div className="drawer-foot">
            <span className={'saving' + (guardadoReciente ? ' is-on' : '')}>
                <span className="led" />
                <span className="saving-txt">{guardadoReciente ? 'Guardado' : 'Guardado local'}</span>
            </span>
            <span style={{ flex: 1 }} />

            <button type="button" className="btn-txt" onClick={onDuplicar}>⧉ Duplicar</button>

            {movible && (
                <>
                    <button type="button" className="btn-txt" onClick={onReagendar}>
                        {reagendando ? 'Cerrar' : '⟳ Reagendar'}
                    </button>
                    <button type="button" className="btn-txt peligro" onClick={onCancelar}>
                        ⊘ Cancelar
                    </button>
                </>
            )}

            <button type="button" className="btn" onClick={onCerrar}>Listo</button>
        </div>
    );
}
