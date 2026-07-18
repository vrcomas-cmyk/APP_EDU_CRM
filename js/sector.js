/**
 * Captura de sectores, en ventana propia y en dos pasos.
 *
 * Antes los sectores del catálogo se pintaban como una fila de chips dentro del formulario de
 * la visita: con un catálogo de verdad eso es una pared de botones encima de los campos que
 * de verdad importan, y al tocar uno se entraba a otra pantalla de la que había que volver a
 * mano. Capturar tres sectores costaba seis cambios de pantalla.
 *
 * Ahora:
 *
 *   ELEGIR     buscador con los sectores que faltan por agregar.
 *   COMPLETAR  objetivo, origen y quién lo pidió. Los tres obligatorios.
 *   GUARDAR    vuelve solo al buscador, con el sector ya en la lista.
 *
 * El ciclo se cierra sin salir de la ventana: encadenar sectores es el caso normal, y cada
 * "volver" intermedio era un clic que no aportaba nada.
 *
 * ── Cuándo se puede editar ───────────────────────────────────────────────────────────
 *
 * Mientras la visita sea borrador, un sector se puede reabrir y corregir: todavía no se ha
 * afirmado nada. Al guardar la visita quedan sellados y esta ventana ya no los abre — desde
 * ahí solo admiten actividades.
 */

import { obtenerVisita, actualizarVisita, nuevoId } from './storage.js';
import { origenes, sectores } from './catalogos.js';
import { campoTexto, resaltar, cabeceraModal, cerrarConEscape, dato } from './campos.js';

const MAX_SUGERENCIAS = 60;

/** Los tres que el sector exige. Sin ellos no dice nada útil sobre qué se fue a hacer. */
export function faltaEnSector(sector) {
    const falta = [];
    if (!(sector?.objetivo || '').trim()) falta.push('Objetivo');
    if (!(sector?.origen || []).length) falta.push('Origen de la actividad');
    if (!(sector?.solicitado_por || '').trim()) falta.push('Solicitado por');
    return falta;
}

export function sectorCompleto(sector) { return faltaEnSector(sector).length === 0; }

/**
 * Abre la ventana de sectores.
 *
 * @param sectorId  con id abre ese sector para corregirlo; sin él, arranca en el buscador
 */
export function abrirSector({
    host, visitaId, sectorId = null,
    alCambiar = () => {}, alToast = () => {}, alCerrar = () => {}
}) {
    // `paso` es 'elegir' o el id del sector que se está completando.
    let paso = sectorId || 'elegir';

    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja es-sector';
    modal.appendChild(caja);

    const leer = () => obtenerVisita(visitaId);
    const leerSector = (id) => leer()?.sectores.find(s => s.id === id) || null;

    const editarSector = (id, mutador) => {
        actualizarVisita(visitaId, v => { mutador(v.sectores.find(s => s.id === id)); });
        alCambiar();
    };

    /**
     * Al cerrar, un sector a medio completar se descarta. No es "trabajo perdido": un sector
     * sin objetivo ni origen no dice nada, y dejarlo colgado obligaría después a adivinar si
     * se quiso agregar o si fue un clic de más.
     */
    const limpiarIncompletos = () => {
        actualizarVisita(visitaId, v => {
            v.sectores = v.sectores.filter(s => s.guardado || sectorCompleto(s));
        });
    };

    const cerrar = () => {
        limpiarIncompletos();
        modal.remove();
        soltarEscape();
        alCambiar();
        alCerrar();   // el drawer decide si lo capturado aquí ya nace sellado
    };

    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    const soltarEscape = cerrarConEscape(modal, () => {
        // Escape desde el formulario regresa al buscador; solo cierra desde el buscador.
        if (paso !== 'elegir') { limpiarIncompletos(); paso = 'elegir'; pintar(); }
        else cerrar();
    });

    // ---------- pintado ----------

    function pintar() {
        const visita = leer();
        if (!visita) return cerrar();

        caja.innerHTML = '';
        if (paso === 'elegir') {
            caja.append(
                cabeceraModal('Agregar sector', visita.hospital || visita.cliente || 'Visita', cerrar),
                cuerpoElegir(visita)
            );
            caja.querySelector('input')?.focus({ preventScroll: true });
        } else {
            const sector = leerSector(paso);
            if (!sector) { paso = 'elegir'; return pintar(); }
            caja.append(
                cabeceraModal(sector.nombre, 'Completa la información del sector', cerrar),
                cuerpoCompletar(sector)
            );
            caja.querySelector('input')?.focus({ preventScroll: true });
        }
    }

    // ---------- paso 1: elegir ----------

    function cuerpoElegir(visita) {
        const body = document.createElement('div');
        body.className = 'modal-body';

        const catalogo = sectores();   // ya viene curado por Administración
        const usados = (visita.sectores || []).map(s => s.nombre);
        const libres = catalogo.filter(s => !usados.includes(s));

        // Lo ya agregado se muestra arriba: es la respuesta a "¿cuál me falta?", que es la
        // pregunta real de quien está encadenando sectores.
        if (usados.length) body.appendChild(bloqueAgregados(visita));

        if (catalogo.length === 0) {
            body.appendChild(nota('El catálogo de sectores no ha cargado todavía. Conéctate para descargarlo.'));
            body.appendChild(pieElegir());
            return body;
        }
        if (libres.length === 0) {
            body.appendChild(nota('Ya agregaste todos los sectores del catálogo.'));
            body.appendChild(pieElegir());
            return body;
        }

        const busq = document.createElement('div');
        busq.className = 'campo';

        const lbl = document.createElement('label');
        lbl.className = 'campo-lbl';
        lbl.textContent = `Sector · ${libres.length} disponible${libres.length === 1 ? '' : 's'}`;

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'inp';
        inp.placeholder = 'Escribe para buscar…';
        inp.autocomplete = 'off';
        lbl.appendChild(inp);

        const res = document.createElement('div');
        res.className = 'mat-res';
        busq.append(lbl, res);

        const pintarRes = () => {
            const q = inp.value.trim();
            const encontrados = filtrar(libres, q);
            res.innerHTML = '';

            if (encontrados.length === 0) {
                res.appendChild(nota(`Ningún sector coincide con "${q}".`));
                return;
            }

            encontrados.forEach(nombre => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'mat-opt';
                b.append(...resaltar(nombre, q));
                b.addEventListener('click', () => elegir(nombre));
                res.appendChild(b);
            });
        };

        inp.addEventListener('input', pintarRes);
        // Enter con una sola coincidencia la elige: encadenar sectores no debería pedir ratón.
        inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const encontrados = filtrar(libres, inp.value.trim());
            if (encontrados.length === 1) elegir(encontrados[0]);
        });

        body.append(busq, pieElegir());
        pintarRes();
        return body;
    }

    function elegir(nombre) {
        const id = nuevoId('s');
        actualizarVisita(visitaId, v => {
            v.sectores.push({
                id, nombre, objetivo: '', origen: [], solicitado_por: '', actividades: []
            });
        });
        alCambiar();
        paso = id;      // se entra directo a completarlo: elegirlo solo no sirve de nada
        pintar();
    }

    function bloqueAgregados(visita) {
        const caja2 = document.createElement('div');
        caja2.className = 'campo';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = `Ya agregados · ${visita.sectores.length}`;
        caja2.appendChild(lbl);

        const chips = document.createElement('div');
        chips.className = 'chips';
        visita.sectores.forEach(s => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip on';
            chip.textContent = s.nombre;
            if (s.guardado) {
                chip.disabled = true;
                chip.title = 'Sector sellado: ya no se edita';
            } else {
                chip.title = 'Corregir este sector';
                chip.addEventListener('click', () => { paso = s.id; pintar(); });
            }
            chips.appendChild(chip);
        });
        caja2.appendChild(chips);
        return caja2;
    }

    function pieElegir() {
        const foot = document.createElement('div');
        foot.className = 'modal-foot';

        const spacer = document.createElement('span');
        spacer.style.flex = '1';

        const listo = document.createElement('button');
        listo.type = 'button';
        listo.className = 'btn';
        listo.textContent = 'Listo';
        listo.addEventListener('click', cerrar);

        foot.append(spacer, listo);
        return foot;
    }

    // ---------- paso 2: completar ----------

    function cuerpoCompletar(sector) {
        const body = document.createElement('div');
        body.className = 'modal-body';

        // Ya sellado: se abre para consultarlo, no para cambiarlo.
        if (sector.guardado) {
            body.append(vistaSellada(sector), pieElegir());
            return body;
        }

        let guardar;
        const revalidar = () => {
            const falta = faltaEnSector(leerSector(sector.id) || {});
            guardar.disabled = falta.length > 0;
            guardar.title = falta.length ? `Falta: ${falta.join(', ')}` : '';
            pista.textContent = falta.length
                ? `Falta ${falta.join(' · ')}`
                : 'Listo para guardar.';
            pista.classList.toggle('es-ok', falta.length === 0);
        };

        body.appendChild(campoTexto('Objetivo', sector.objetivo, '¿Qué se busca lograr aquí?',
            (t) => { editarSector(sector.id, s => { s.objetivo = t; }); revalidar(); }));

        body.appendChild(chipsOrigen(sector, revalidar));

        body.appendChild(campoTexto('Solicitado por', sector.solicitado_por,
            'Nombre de quien pidió la actividad',
            (t) => { editarSector(sector.id, s => { s.solicitado_por = t; }); revalidar(); },
            { ayuda: 'Quién originó la visita a este sector: el gerente de marca, el vendedor, el propio cliente…' }));

        // --- pie ---
        const foot = document.createElement('div');
        foot.className = 'modal-foot';

        const pista = document.createElement('span');
        pista.className = 'pista';

        const spacer = document.createElement('span');
        spacer.style.flex = '1';

        const quitar = document.createElement('button');
        quitar.type = 'button';
        quitar.className = 'btn-txt peligro';
        quitar.textContent = 'Quitar';
        quitar.addEventListener('click', () => {
            actualizarVisita(visitaId, v => {
                v.sectores = v.sectores.filter(s => s.id !== sector.id);
            });
            alCambiar();
            paso = 'elegir';
            pintar();
        });

        guardar = document.createElement('button');
        guardar.type = 'button';
        guardar.className = 'btn btn-principal';
        guardar.textContent = 'Guardar sector';
        guardar.addEventListener('click', () => {
            const actual = leerSector(sector.id);
            if (!sectorCompleto(actual)) return;   // el botón ya está deshabilitado; cinturón

            // El sello del sector lo pone Guardar visita, no este botón: mientras la visita
            // sea borrador todo sigue siendo corregible, y sellar aquí mentiría sobre eso.
            // En una visita ya guardada sí se sella de inmediato (lo hace el drawer).
            alToast(`${actual.nombre} agregado a la visita.`, { estado: 'completa' });
            paso = 'elegir';
            pintar();
        });

        foot.append(pista, spacer, quitar, guardar);
        body.appendChild(foot);

        revalidar();
        return body;
    }

    function chipsOrigen(sector, revalidar) {
        const caja2 = document.createElement('div');
        caja2.className = 'campo';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = 'Origen de la actividad';

        const chips = document.createElement('div');
        chips.className = 'chips';

        origenes().forEach(origen => {
            const chip = document.createElement('button');
            chip.type = 'button';
            const activo = () => (leerSector(sector.id)?.origen || []).includes(origen);
            chip.className = 'chip' + (activo() ? ' on' : '');
            chip.setAttribute('aria-pressed', String(activo()));
            chip.textContent = origen;
            chip.addEventListener('click', () => {
                const estaba = activo();
                editarSector(sector.id, s => {
                    s.origen = estaba
                        ? s.origen.filter(o => o !== origen)
                        : [...(s.origen || []), origen];
                });
                chip.classList.toggle('on', !estaba);
                chip.setAttribute('aria-pressed', String(!estaba));
                revalidar();
            });
            chips.appendChild(chip);
        });

        caja2.append(lbl, chips);
        return caja2;
    }

    function vistaSellada(sector) {
        const caja2 = document.createElement('div');
        caja2.className = 'datos';
        caja2.append(
            dato('Sector', sector.nombre),
            dato('Objetivo', sector.objetivo),
            dato('Origen de la actividad', (sector.origen || []).join(', ')),
            dato('Solicitado por', sector.solicitado_por)
        );
        return caja2;
    }

    // ---------- utilidades ----------

    function nota(texto) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = texto;
        return p;
    }

    function filtrar(lista, q) {
        if (!q) return lista.slice(0, MAX_SUGERENCIAS);
        const palabras = q.toLowerCase().split(/\s+/).filter(Boolean);
        const salida = [];
        for (const item of lista) {
            const texto = item.toLowerCase();
            if (palabras.every(p => texto.includes(p))) {
                salida.push(item);
                if (salida.length === MAX_SUGERENCIAS) break;
            }
        }
        return salida;
    }

    host.appendChild(modal);
    pintar();
}
