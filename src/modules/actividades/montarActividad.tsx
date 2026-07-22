/**
 * Puente entre el drawer y la ventana de actividad en React.
 *
 * Expone la misma firma que `js/actividad.js`: `abrirActividad({ host, visitaId, sectorId,
 * actividadId, alCambiar, alToast })`.
 *
 * ── El `host` NO es negociable ───────────────────────────────────────────────────────
 *
 * La raíz de React se crea DENTRO del `host` que llega, que es un nodo interno de
 * `.drawer-raiz`. Colgarla de `document.body` la sacaría de ese contexto de apilado —
 * `.drawer-raiz` es z-index 50, `.modal` es 20— y la ventana quedaría por debajo del drawer:
 * visible a medias y con los clics comidos por el scrim. Ya pasó una vez con la ventana de
 * sector, y el síntoma fue que la app ofrecía descartar la visita al intentar capturar.
 */

import { createRoot, type Root } from 'react-dom/client';
import { StrictMode } from 'react';

import { VentanaActividad } from './components/VentanaActividad';
import { nuevaActividad } from './services/fabricas';
import * as repo from '@modules/visitas/repository/visitasRepo';
import type { Avisar } from '@core/puente';
import type { Actividad, Visita } from '@core/tipos';

import { abrirModalMaterial } from '../../../js/materiales.js';
import { controlEvidencia, vistaEvidencia } from '../../../js/evidencias.js';
import { miniaturaEvidencia } from '../../../js/vistaprevia.js';
import { hiloComentarios, AMBITOS } from '../../../js/hilo.js';

export interface OpcionesActividad {
    host: HTMLElement;
    visitaId: string;
    sectorId: string;
    actividadId?: string | null;
    alCambiar?: () => void;
    alToast?: Avisar;
    /** La actividad es de otra persona: se ve, no se le sube evidencia ni se registra nada. */
    soloLectura?: boolean;
}

/**
 * Devuelve `destruir`: un desmontaje forzado y silencioso, para que el drawer que la aloja
 * pueda cerrarse sin dejarla viva. Ver la nota gemela en `montarSector.tsx` — misma raíz de
 * React separada, mismo riesgo de quedar huérfana con su `useEffect` de Escape escuchando en
 * `document` para siempre si el drawer se cierra sin haberla cerrado antes.
 */
export function abrirActividad({
    host, visitaId, sectorId, actividadId = null,
    alCambiar = () => {}, alToast = () => {}, soloLectura = false
}: OpcionesActividad): () => void {
    let actId = actividadId;

    // Sin id, se crea el borrador y se persiste de inmediato: perder lo escrito por un bloqueo
    // de pantalla es el peor error posible aquí. Pero una actividad NUEVA no tiene sentido
    // sobre la visita de otra persona —no hay nada que crear ahí—, así que en modo de solo
    // lectura ni se intenta: `actualizarVisita` ya lo bloquearía en silencio, y de ahí salía
    // una ventana en blanco (la actividad "creada" nunca existió de verdad).
    if (!actId && !soloLectura) {
        const nueva = nuevaActividad(repo.nuevoId);
        actId = nueva.id;
        repo.actualizarVisita(visitaId, v => {
            v.sectores?.find(s => s.id === sectorId)?.actividades?.push(nueva);
        });
    }

    // No debería llegar aquí (la UI no ofrece "+ Registrar actividad" en modo de solo lectura),
    // pero si algo lo invocara igual, no hay una actividad real que mostrar.
    if (!actId) return () => {};

    const contenedor = document.createElement('div');
    contenedor.className = 'actividad-host';
    host.appendChild(contenedor);

    const raiz: Root = createRoot(contenedor);
    let desmontada = false;

    const destruir = () => {
        if (desmontada) return;
        desmontada = true;
        raiz.unmount();
        contenedor.remove();
    };

    const cerrar = () => {
        // Se desmonta en un microtask: React se queja si `unmount` ocurre dentro del render
        // que lo provocó, y el cierre siempre llega desde un manejador de la propia ventana.
        queueMicrotask(destruir);
    };

    raiz.render(
        <StrictMode>
            <VentanaActividad
                visitaId={visitaId}
                sectorId={sectorId}
                actividadId={actId}
                avisar={alToast}
                alCambiar={alCambiar}
                onCerrar={cerrar}
                soloLectura={soloLectura}
                abrirVentanaMaterial={(sector, onAgregar) => {
                    abrirModalMaterial({
                        // Los materiales se cuelgan del MISMO host, por el mismo apilado.
                        host,
                        sector,
                        alToast,
                        onAgregar
                    } as never);
                }}
                construirEvidencia={(act: Actividad) => {
                    const fila = document.createDocumentFragment();

                    // La miniatura primero: quien revisa quiere VER el archivo, no leer su nombre.
                    const mini = miniaturaEvidencia(act);
                    if (mini) fila.appendChild(mini);

                    // Las funciones vanilla infieren su firma de los valores por defecto del
                    // JS, más estrechos que lo que de verdad aceptan. En modo de solo lectura,
                    // `vistaEvidencia` no ofrece "Subir"/"Quitar": esos botones escriben directo
                    // a `localStorage` (`escribirEvidencia` no pasa por el guardián de
                    // propiedad), así que mostrarlos sobre la actividad de otra persona
                    // invitaría a un intento que además de estar mal, ni siquiera fallaría con
                    // un aviso claro — se quedaría en un limbo que solo se nota al recargar.
                    fila.appendChild(
                        soloLectura ? vistaEvidencia(act) : controlEvidencia(act, { alCambiar, alToast } as never)
                    );
                    return fila;
                }}
                construirComentarios={(act: Actividad, visita: Visita) => hiloComentarios({
                    ambito: AMBITOS.ACTIVIDAD,
                    idAmbito: act.id,
                    visita,
                    alToast,
                    compacto: true
                } as never)}
            />
        </StrictMode>
    );

    return destruir;
}
