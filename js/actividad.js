/**
 * Registro de una actividad, en ventana propia.
 *
 * Una actividad a la vez. Antes se pintaban todas desplegadas dentro del sector y el sector
 * se volvía un formulario larguísimo donde no se sabía qué campo pertenecía a cuál: capturar
 * de pie, con el cliente esperando, exige una sola pregunta a la vez.
 *
 * ── Ciclo de vida ────────────────────────────────────────────────────────────────────
 *
 *   BORRADOR   Todo editable. Se autoguarda en cada tecla, igual que el resto de la app:
 *              perder lo escrito por un bloqueo de pantalla o un pasillo sin señal es el
 *              peor error posible aquí, y "no lo guardé" no es una explicación aceptable
 *              para el educador. Pero un borrador NO se sincroniza y se ve como borrador:
 *              nadie debe confundirlo con un registro terminado.
 *
 *   GUARDADA   Al presionar Guardar se valida, se sella con quién/cuándo/desde dónde y el
 *              formulario desaparece: quedan los datos, en frío. Es un hecho histórico.
 *
 * ── Por qué no se edita después ──────────────────────────────────────────────────────
 *
 * La actividad afirma que alguien hizo algo, en un lugar, con una persona, a una hora. Un
 * campo que se puede reescribir en silencio no prueba nada: lo que se corrige sin dejar
 * rastro deja de servir para auditar, y estas filas alimentan indicadores. Si hubo un error,
 * la salida es registrar una actividad nueva — no reescribir la historia.
 *
 * La evidencia es la excepción y no contradice lo anterior: no cambia lo que se afirma, lo
 * respalda. Por eso se puede cargar días después, cuando haya señal.
 */

import { obtenerVisita, actualizarVisita, nuevoId } from './storage.js';
import { estaGuardada } from './estado.js';
import {
    tiposActividad, areas, tiposEvidencia, camposExtra,
    configuracionCampos, campoVisible, campoEditable, MODOS
} from './catalogos.js';
import { registrar, TIPOS } from './eventos.js';
import { controlEvidencia, quitarEvidencia } from './evidencias.js';
import { describirDispositivo } from './geo.js';
import { sesionActual } from './auth.js';
import { abrirModalMaterial } from './materiales.js';
import {
    campoTexto, selectSimple, dato, envolver, cabeceraModal, marcarError, cerrarConEscape
} from './campos.js';

/**
 * Abre la ventana de una actividad. Sin `actividadId` crea un borrador nuevo.
 *
 * @param host       dónde colgar el modal (el drawer, para heredar su stacking context)
 * @param alCambiar  repinta a quien hospeda (el sector de atrás cambia sus contadores)
 */
export function abrirActividad({ host, visitaId, sectorId, actividadId = null, alCambiar = () => {}, alToast = () => {} }) {
    let actId = actividadId;

    if (!actId) {
        actId = nuevoId('a');
        actualizarVisita(visitaId, v => {
            v.sectores.find(s => s.id === sectorId).actividades.push({
                id: actId,
                tipo: '', area_visitada: '',
                creada: new Date().toISOString(),
                borrador: true,
                contacto: { nombre: '', cargo: '', servicio: '' },
                materiales: [],
                evidencia: { estado: 'pendiente', nombre: '', mime: '', url: '' }
            });
        });
    }

    const modal = document.createElement('div');
    modal.className = 'modal';

    const caja = document.createElement('div');
    caja.className = 'modal-caja es-actividad';
    modal.appendChild(caja);

    // ---------- lectura del árbol ----------

    const leer = () => {
        const visita = obtenerVisita(visitaId);
        const sector = visita?.sectores.find(s => s.id === sectorId);
        const act = sector?.actividades.find(a => a.id === actId);
        return { visita, sector, act };
    };

    const editarAct = (mutador, { repintar = false } = {}) => {
        actualizarVisita(visitaId, v => {
            const s = v.sectores.find(x => x.id === sectorId);
            mutador(s.actividades.find(a => a.id === actId));
        });
        alCambiar();
        if (repintar) pintar();
    };

    // ---------- cierre ----------

    /**
     * Un borrador en el que no se escribió nada no es una actividad a medias: es un botón
     * presionado por error. Dejarlo llenaría el sector de tarjetas vacías que después nadie
     * sabe si borrar.
     */
    const vacio = (act) => !act.tipo && !act.area_visitada
        && !(act.contacto?.nombre || '').trim()
        && (act.materiales || []).length === 0;

    const cerrar = () => {
        const { act } = leer();
        if (act && !estaGuardada(act) && vacio(act)) {
            actualizarVisita(visitaId, v => {
                const s = v.sectores.find(x => x.id === sectorId);
                s.actividades = s.actividades.filter(a => a.id !== actId);
            });
        }
        modal.remove();
        soltarEscape();
        alCambiar();
    };

    modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
    const soltarEscape = cerrarConEscape(modal, cerrar);

    // ---------- pintado ----------

    function pintar() {
        const { visita, sector, act } = leer();
        if (!visita || !sector || !act) return cerrar();

        caja.innerHTML = '';
        caja.append(
            cabeceraModal(
                estaGuardada(act) ? 'Actividad registrada' : 'Registrar actividad',
                sector.nombre,
                cerrar
            ),
            estaGuardada(act) ? cuerpoSellado(visita, sector, act) : cuerpoBorrador(visita, sector, act)
        );
    }

    // ---------- borrador: el formulario ----------

    function cuerpoBorrador(visita, sector, act) {
        const body = document.createElement('div');
        body.className = 'modal-body';

        // TODO lo que sigue sale de la configuración del tipo. No hay ningún `if` que decida
        // a mano si un campo aparece o es obligatorio: eso vive en Administración.
        const config = configuracionCampos(act.tipo);
        const campos = {};
        const ver = (id) => config[id] !== MODOS.OCULTO;
        const editable = (id) => campoEditable(act.tipo, id);

        // Lo que la app ya sabe no se pregunta. Se muestra para dar contexto, en frío.
        body.appendChild(contextoAutomatico(visita, sector));

        campos.tipo = selectTipo(act, (tipo) => editarAct(a => { a.tipo = tipo; }, { repintar: true }));
        body.appendChild(campos.tipo);

        // La regla se DECLARA antes de que los campos aparezcan: el formulario no cambia por magia.
        body.appendChild(barraRegla(act.tipo));

        if (ver('area_visitada')) {
            campos.area_visitada = editable('area_visitada')
                ? selectSimple(etiqueta('Área visitada', 'area_visitada', config), areas(),
                    act.area_visitada, (a) => editarAct(x => { x.area_visitada = a; }))
                : dato('Área visitada', act.area_visitada);
            body.appendChild(campos.area_visitada);
        }

        if (ver('fecha_documento')) {
            campos.fecha_documento = editable('fecha_documento')
                ? campoFecha(etiqueta('Fecha del documento', 'fecha_documento', config),
                    act.fecha_documento, (f) => editarAct(x => { x.fecha_documento = f; }))
                : dato('Fecha del documento', act.fecha_documento);
            body.appendChild(campos.fecha_documento);
        }

        const contacto = bloqueContacto(act, config);
        if (contacto) {
            Object.assign(campos, contacto.campos);
            body.appendChild(contacto.caja);
        }

        if (ver('materiales')) {
            campos.materiales = bloqueMateriales(sector, act, config);
            body.appendChild(campos.materiales);
        }

        if (ver('tipo_evidencia')) {
            campos.tipo_evidencia = editable('tipo_evidencia')
                ? selectSimple(etiqueta('Tipo de evidencia', 'tipo_evidencia', config),
                    tiposEvidencia(), act.evidencia?.tipo,
                    (t) => editarAct(x => { x.evidencia = { ...(x.evidencia || {}), tipo: t }; }))
                : dato('Tipo de evidencia', act.evidencia?.tipo);
            body.appendChild(campos.tipo_evidencia);
        }

        // La evidencia NO se pide durante la captura: exigir la foto aquí detiene al educador
        // por algo que puede resolverse después, y su tipo ya declara si hará falta.
        if (ver('evidencia')) {
            const nota = document.createElement('p');
            nota.className = 'ayuda';
            nota.textContent = config.evidencia === MODOS.OBLIGATORIO
                ? 'La evidencia se carga después de guardar; puede ser hoy o cuando haya señal.'
                : 'Este tipo admite evidencia, pero no la exige.';
            body.appendChild(nota);
        }

        body.appendChild(pieBorrador(act, campos, config));
        return body;
    }

    /** Un obligatorio se anuncia en su etiqueta, no solo al fallar el guardado. */
    function etiqueta(texto, campoId, config) {
        return config[campoId] === MODOS.OBLIGATORIO ? `${texto} *` : texto;
    }

    function campoFecha(etiquetaTxt, valor, onCambio) {
        const inp = document.createElement('input');
        inp.type = 'date';
        inp.className = 'inp';
        inp.value = valor || '';
        inp.addEventListener('change', () => onCambio(inp.value));
        return envolver(etiquetaTxt, inp);
    }

    function pieBorrador(act, campos, config) {
        const foot = document.createElement('div');
        foot.className = 'modal-foot';

        const estado = document.createElement('span');
        estado.className = 'sello es-borrador';
        estado.textContent = 'BORRADOR · sin guardar';

        const spacer = document.createElement('span');
        spacer.style.flex = '1';

        const descartar = document.createElement('button');
        descartar.type = 'button';
        descartar.className = 'btn-txt peligro';
        descartar.textContent = 'Descartar';
        descartar.addEventListener('click', async () => {
            if (!vacio(act) && !confirm('¿Descartar esta actividad? Lo capturado se pierde.')) return;
            await quitarEvidencia(act.id).catch(() => {});
            actualizarVisita(visitaId, v => {
                const s = v.sectores.find(x => x.id === sectorId);
                s.actividades = s.actividades.filter(a => a.id !== actId);
            });
            modal.remove();
            soltarEscape();
            alCambiar();
        });

        const guardar = document.createElement('button');
        guardar.type = 'button';
        guardar.className = 'btn btn-principal';
        guardar.textContent = 'Guardar actividad';
        guardar.addEventListener('click', () => intentarGuardar(campos, config));

        foot.append(estado, spacer, descartar, guardar);
        return foot;
    }

    // ---------- validación y sello ----------

    /**
     * Valida recorriendo la configuración, no una lista fija de `if`s. El tipo declara qué es
     * obligatorio; aquí solo se pregunta si eso que declaró tiene valor.
     */
    function valorDe(act, campoId) {
        switch (campoId) {
            case 'area_visitada':     return act.area_visitada;
            case 'contacto_nombre':   return act.contacto?.nombre;
            case 'contacto_cargo':    return act.contacto?.cargo;
            case 'contacto_servicio': return act.contacto?.servicio;
            case 'fecha_documento':   return act.fecha_documento;
            case 'tipo_evidencia':    return act.evidencia?.tipo;
            // Los materiales no son un campo de texto: cuenta cuántos hay.
            case 'materiales':        return (act.materiales || []).length ? 'si' : '';
            // La evidencia obligatoria NO bloquea el guardado: es deuda, se salda después.
            case 'evidencia':         return 'si';
            default:                  return '';
        }
    }

    const MENSAJES = {
        area_visitada:     'Indica el área que visitaste.',
        contacto_nombre:   'El nombre de quien te atendió es obligatorio.',
        contacto_cargo:    'El cargo del contacto es obligatorio para este tipo.',
        contacto_servicio: 'El servicio del contacto es obligatorio para este tipo.',
        fecha_documento:   'Este tipo de actividad exige la fecha del documento.',
        tipo_evidencia:    'Elige el tipo de evidencia.',
        materiales:        'Este tipo de actividad exige al menos un material.'
    };

    function intentarGuardar(campos, config) {
        const { act } = leer();
        if (!act) return cerrar();

        const faltantes = [];
        if (!act.tipo) faltantes.push([campos.tipo, 'Elige el tipo de actividad.']);

        for (const [campoId, modo] of Object.entries(config)) {
            if (modo !== MODOS.OBLIGATORIO) continue;
            if (String(valorDe(act, campoId) || '').trim()) continue;
            faltantes.push([campos[campoId], MENSAJES[campoId] || `Falta ${campoId}.`]);
        }

        if (faltantes.length > 0) {
            faltantes.forEach(([campo, mensaje]) => marcarError(campo, mensaje));
            // Se lleva la vista al primero: en un teléfono el campo en falta puede estar
            // fuera de pantalla y el rojo no sirve si no se ve.
            faltantes[0][0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            alToast(
                faltantes.length === 1
                    ? 'Falta un dato para poder guardar.'
                    : `Faltan ${faltantes.length} datos para poder guardar.`,
                { estado: 'sin-registrar' }
            );
            return;
        }

        sellar();
    }

    function sellar() {
        const sesion = sesionActual();
        const sello = {
            momento: new Date().toISOString(),
            usuario: sesion?.nombre || '',
            usuario_correo: sesion?.correo || '',
            dispositivo: describirDispositivo()
        };

        editarAct(a => { a.guardada = sello; delete a.borrador; });

        // Los eventos se emiten AQUÍ, no al crear el borrador: la bitácora registra hechos, y
        // hasta este momento no había ninguno. Antes el contacto emitía un evento por cada
        // tecla escrita en su nombre, que inflaba la bitácora con estados intermedios.
        const { visita, sector, act } = leer();
        registrar(TIPOS.ACTIVIDAD, visita, {
            sector: sector.nombre, id_actividad: act.id,
            tipo: act.tipo, area_visitada: act.area_visitada,
            materiales: (act.materiales || []).length
        });
        if ((act.contacto?.nombre || '').trim()) {
            registrar(TIPOS.CONTACTO, visita, {
                id_actividad: act.id,
                contacto: act.contacto.nombre.trim(),
                cargo: act.contacto.cargo || '',
                servicio: act.contacto.servicio || ''
            });
        }
        (act.materiales || []).forEach(m => registrar(TIPOS.MATERIAL, visita, {
            sector: sector.nombre, id_actividad: act.id,
            material: m.material, cantidad: m.cantidad, unidad: m.unidad, origen: m.origen
        }));

        alToast('Actividad guardada. Queda registrada y ya no se edita.', { estado: 'completa' });
        alCambiar();
        pintar();
    }

    // ---------- guardada: solo lectura ----------

    function cuerpoSellado(visita, sector, act) {
        const body = document.createElement('div');
        body.className = 'modal-body';

        body.appendChild(selloDe(act));

        const datos = document.createElement('div');
        datos.className = 'datos';
        datos.append(
            dato('Tipo de actividad', act.tipo),
            dato('Área visitada', act.area_visitada),
            dato('Sector', sector.nombre),
            dato('Educador', visita.educador),
            dato('Cliente', visita.cliente),
            dato('Hospital', visita.hospital)
        );
        body.appendChild(datos);

        if (act.fecha_documento) {
            datos.appendChild(dato('Fecha del documento', act.fecha_documento));
        }
        if (act.evidencia?.tipo) {
            datos.appendChild(dato('Tipo de evidencia', act.evidencia.tipo));
        }

        const c = act.contacto || {};
        if (c.nombre || c.cargo || c.servicio) {
            body.appendChild(seccion('Contacto responsable', (caja) => {
                const datosC = document.createElement('div');
                datosC.className = 'datos';
                datosC.append(
                    dato('Nombre', c.nombre),
                    dato('Cargo', c.cargo),
                    dato('Servicio', c.servicio)
                );
                caja.appendChild(datosC);
            }));
        }

        if ((act.materiales || []).length > 0) {
            body.appendChild(seccion(`Materiales · ${act.materiales.length}`, (caja) => {
                act.materiales.forEach(m => caja.appendChild(filaMaterialSellada(m)));
            }));
        }

        // La evidencia sigue viva después del sello: respalda el hecho, no lo cambia.
        if (campoVisible(act.tipo, 'evidencia')) {
            body.appendChild(seccion('Evidencia', (caja) => {
                caja.appendChild(controlEvidencia(act, { alCambiar: () => { alCambiar(); pintar(); }, alToast }));
            }));
        }

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
        body.appendChild(foot);

        return body;
    }

    function selloDe(act) {
        const caja = document.createElement('div');
        caja.className = 'sello es-guardada';

        const icono = document.createElement('span');
        icono.className = 'sello-ico';
        icono.textContent = '✓';

        const txt = document.createElement('span');
        txt.className = 'sello-txt';

        const g = act.guardada || {};
        if (g.migrada) {
            // No se finge un sello que nunca existió: esta actividad se capturó antes de que
            // hubiera guardado explícito, y decir lo contrario sería inventar una firma.
            txt.textContent = 'Registrada antes de que existiera el guardado con sello. No se edita.';
        } else {
            const cuando = g.momento
                ? new Date(g.momento).toLocaleString('es-MX', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                })
                : '—';
            txt.textContent = `Guardada el ${cuando}${g.usuario ? ` por ${g.usuario}` : ''}.`;
        }

        caja.append(icono, txt);
        return caja;
    }

    function filaMaterialSellada(m) {
        const fila = document.createElement('div');
        fila.className = 'mat-fila es-sellada';

        const txt = document.createElement('span');
        txt.className = 'mat-txt';

        const nombre = document.createElement('span');
        nombre.className = 'mat-nombre';
        nombre.textContent = m.material;

        const meta = document.createElement('span');
        meta.className = 'mat-meta mono';
        meta.textContent = [
            [m.cantidad, m.unidad].filter(Boolean).join(' '),
            m.origen
        ].filter(Boolean).join(' · ');

        txt.append(nombre, meta);
        fila.appendChild(txt);
        return fila;
    }

    // ---------- piezas del borrador ----------

    function contextoAutomatico(visita, sector) {
        const caja = document.createElement('div');
        caja.className = 'ctx-auto';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = 'Se registra automáticamente';
        caja.appendChild(lbl);

        const datos = document.createElement('div');
        datos.className = 'datos';
        datos.append(
            dato('Educador', visita.educador),
            dato('Cliente', visita.cliente),
            dato('Sector', sector.nombre)
        );
        caja.appendChild(datos);
        return caja;
    }

    function selectTipo(act, onCambio) {
        const opciones = tiposActividad().map(t => t.nombre);
        const huerfano = act.tipo && !opciones.includes(act.tipo);
        return selectSimple('Tipo de actividad', opciones, act.tipo, onCambio,
            huerfano ? `${act.tipo} (ya no está en el catálogo)` : null);
    }

    function barraRegla(tipo) {
        const barra = document.createElement('p');
        barra.className = 'regla';

        if (!tipo) {
            barra.textContent = 'ELIGE UN TIPO Y APARECERÁ LO QUE PIDE';
            return barra;
        }
        const partes = camposExtra(tipo).map(c => c.toUpperCase());
        if (partes.length === 0) {
            barra.textContent = 'ESTE TIPO NO PIDE NADA MÁS';
            return barra;
        }
        barra.classList.add('es-activa');
        barra.textContent = `ESTE TIPO PIDE ${partes.join(' · ')}`;
        return barra;
    }

    /**
     * Contacto responsable, uno POR ACTIVIDAD. Aunque sea la misma persona en varias, se
     * guarda en cada una: quién atendió QUÉ es justo lo que se querrá reportar después.
     */
    function bloqueContacto(act, config) {
        const partes = [
            { id: 'contacto_nombre',   clave: 'nombre',   lbl: 'Nombre',   ph: 'Dr. Juan Pérez' },
            { id: 'contacto_cargo',    clave: 'cargo',    lbl: 'Cargo',    ph: 'Jefa de piso' },
            { id: 'contacto_servicio', clave: 'servicio', lbl: 'Servicio', ph: 'Quirófano' }
        ].filter(p => config[p.id] !== MODOS.OCULTO);

        // Si el tipo esconde los tres, el bloque entero sobra: un encabezado sin campos
        // debajo se lee como un error de la app.
        if (partes.length === 0) return null;

        const caja = document.createElement('div');
        caja.className = 'contacto';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = 'Contacto responsable';
        caja.appendChild(lbl);

        const c = act.contacto || {};
        const set = (clave) => (t) => editarAct(a => {
            a.contacto = { ...(a.contacto || {}), [clave]: t };
        });

        const campos = {};
        const construir = (p) => {
            const nodo = campoEditable(act.tipo, p.id)
                ? campoTexto(etiqueta(p.lbl, p.id, config), c[p.clave], p.ph, set(p.clave))
                : dato(p.lbl, c[p.clave]);
            campos[p.id] = nodo;
            return nodo;
        };

        // El nombre va solo y los otros dos en pareja: es la jerarquía real del dato.
        const nombre = partes.find(p => p.id === 'contacto_nombre');
        if (nombre) caja.appendChild(construir(nombre));

        const resto = partes.filter(p => p.id !== 'contacto_nombre');
        if (resto.length) {
            const fila = document.createElement('div');
            fila.className = resto.length === 2 ? 'grid-2' : '';
            resto.forEach(p => fila.appendChild(construir(p)));
            caja.appendChild(fila);
        }

        return { caja, campos };
    }

    function bloqueMateriales(sector, act) {
        const caja = document.createElement('div');
        caja.className = 'campo';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = `Materiales · ${(act.materiales || []).length}`;
        caja.appendChild(lbl);

        (act.materiales || []).forEach(m => caja.appendChild(filaMaterialEditable(m)));

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn-dashed';
        add.textContent = '+ Agregar material';
        add.addEventListener('click', () => abrirModalMaterial({
            host,
            sector: sector.nombre,
            alToast,
            onAgregar: (nuevo) => editarAct(a => {
                a.materiales = [...(a.materiales || []), nuevo];
            }, { repintar: true })
        }));
        caja.appendChild(add);

        return caja;
    }

    /** Mientras la actividad es borrador el material aún se puede quitar; después ya no. */
    function filaMaterialEditable(m) {
        const fila = filaMaterialSellada(m);
        fila.classList.remove('es-sellada');

        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'icon-btn';
        x.setAttribute('aria-label', `Quitar ${m.material}`);
        x.textContent = '✕';
        x.addEventListener('click', () => editarAct(a => {
            a.materiales = (a.materiales || []).filter(otro => otro.id !== m.id);
        }, { repintar: true }));

        fila.appendChild(x);
        return fila;
    }

    function seccion(titulo, llenar) {
        const caja = document.createElement('div');
        caja.className = 'campo';

        const lbl = document.createElement('span');
        lbl.className = 'campo-lbl';
        lbl.textContent = titulo;
        caja.appendChild(lbl);

        llenar(caja);
        return caja;
    }

    host.appendChild(modal);
    pintar();
    caja.querySelector('select, input')?.focus({ preventScroll: true });
}
