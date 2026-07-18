/**
 * Dashboard.
 *
 * Responde "¿cómo voy?" de un vistazo. Todo sale de `datos.js`, así que respeta el alcance
 * jerárquico sin saber nada de él: un educador ve lo suyo y un gerente ve a su equipo con el
 * mismo código, porque la consulta ya viene recortada.
 *
 * ── Sobre el color ───────────────────────────────────────────────────────────────────
 *
 * Esta app reserva el color saturado para el ESTADO; no tiene acento de marca. Eso decide
 * cómo se codifican las gráficas, y no por gusto:
 *
 *   MAGNITUD (top de clientes, sectores, tipos)  una sola tinta. Es una serie comparándose
 *            consigo misma: darle un color por barra inventaría una identidad que no existe
 *            y gastaría la cromía que el producto reserva para otra cosa.
 *
 *   ESTADO   punto de color + ETIQUETA + número, cada uno en su renglón. Nunca segmentos
 *            pegados distinguidos por color: los cuatro estados de la paleta se separan
 *            apenas ΔE 4.2 en deuteranopía —rojo y verde son el caso clásico— así que quien
 *            no distingue esos dos vería una barra sin poder leerla. Con el nombre al lado,
 *            el color pasa a reforzar en vez de a informar, que es su papel correcto.
 *
 * Toda gráfica trae además su tabla equivalente: es la salida para lector de pantalla y para
 * quien necesite el número exacto en vez de la proporción.
 */

import {
    consultarVisitas, calcularIndicadores, opcionesDeFiltro, filtroVacio, top,
    indicadoresPorEducador
} from './datos.js';
import { revisionVigente, RESULTADOS } from './revisiones.js';
import { ESTADOS, etiquetaEstado } from './estado.js';
import { puede, tieneEquipo, perfilActual } from './permisos.js';
import { cabeceraModal, cerrarConEscape } from './campos.js';

let el = {};
let filtro = filtroVacio();
let alToast = () => {};

export function initDashboard({ onToast } = {}) {
    alToast = onToast || (() => {});

    const raiz = document.createElement('div');
    raiz.className = 'drawer-raiz';
    raiz.hidden = true;

    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.addEventListener('click', () => cerrar());

    const panel = document.createElement('aside');
    panel.className = 'panel-ancho';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Dashboard');

    raiz.append(scrim, panel);
    document.body.appendChild(raiz);
    el = { raiz, panel, soltarEscape: () => {} };
}

export function hayDashboardAbierto() { return el.raiz && !el.raiz.hidden; }

export function puedeVerDashboard() { return puede('dashboards', 'personal'); }

export function abrirDashboard() {
    if (!puedeVerDashboard() || !el.raiz) return;
    el.raiz.hidden = false;
    document.body.style.overflow = 'hidden';
    el.soltarEscape = cerrarConEscape(el.panel, cerrar);
    pintar();
}

function cerrar() {
    if (!el.raiz) return;
    el.raiz.hidden = true;
    document.body.style.overflow = '';
    el.soltarEscape();
}

// ---------- pintado ----------

function pintar() {
    const visitas = consultarVisitas(filtro);
    const ind = calcularIndicadores(visitas);
    const perfil = perfilActual();

    el.panel.innerHTML = '';
    el.panel.append(
        cabeceraModal(
            tieneEquipo() ? 'Dashboard del equipo' : 'Mi dashboard',
            `${perfil?.nombre || perfil?.correo || ''} · ${etiquetaRol(perfil?.rol)}`,
            cerrar
        ),
        barraFiltros(visitas),
        cuerpo(ind, visitas)
    );
}

function etiquetaRol(rol) {
    return {
        administrador: 'Administrador', gerente: 'Gerente',
        analista: 'Analista', educador: 'Educador Clínico'
    }[rol] || 'Educador Clínico';
}

// ---------- filtros ----------

/**
 * Los filtros van en UNA fila arriba de todo y afectan a cada número de la pantalla. Repetir
 * un filtro por gráfica dejaría dos cifras contradictorias visibles al mismo tiempo.
 */
function barraFiltros(visitas) {
    const caja = document.createElement('div');
    caja.className = 'filtros';

    const ops = opcionesDeFiltro(consultarVisitas());   // opciones sobre TODO lo visible,
                                                        // no sobre lo ya filtrado: si no,
                                                        // un filtro se auto-elimina de su
                                                        // propia lista y no se puede soltar.

    // El filtro por educador solo tiene sentido para quien ve a más de una persona.
    if (tieneEquipo()) caja.appendChild(selectFiltro('Educador', 'educador', ops.educadores));

    caja.append(
        selectFiltro('Cliente', 'cliente', ops.clientes),
        selectFiltro('Hospital', 'hospital', ops.hospitales),
        selectFiltro('Sector', 'sector', ops.sectores),
        selectFiltro('Tipo de actividad', 'tipo_actividad', ops.tipos),
        selectFiltro('Estado', 'estado', ops.estados, etiquetaEstado),
        campoFecha('Desde', 'desde'),
        campoFecha('Hasta', 'hasta')
    );

    const resumen = document.createElement('div');
    resumen.className = 'filtros-pie';

    const cuenta = document.createElement('span');
    cuenta.className = 'sector-cuenta';
    cuenta.textContent = `${visitas.length} visita${visitas.length === 1 ? '' : 's'} en el resultado`;
    resumen.appendChild(cuenta);

    const activos = Object.entries(filtro).filter(([, v]) => v).length;
    if (activos > 0) {
        const limpiar = document.createElement('button');
        limpiar.type = 'button';
        limpiar.className = 'btn-txt';
        limpiar.textContent = `Limpiar ${activos} filtro${activos === 1 ? '' : 's'}`;
        limpiar.addEventListener('click', () => { filtro = filtroVacio(); pintar(); });
        resumen.appendChild(limpiar);
    }

    caja.appendChild(resumen);
    return caja;
}

function selectFiltro(etiqueta, clave, opciones, formato = (x) => x) {
    const campo = document.createElement('label');
    campo.className = 'filtro';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;

    const sel = document.createElement('select');
    sel.className = 'inp';

    const todos = document.createElement('option');
    todos.value = '';
    todos.textContent = 'Todos';
    sel.appendChild(todos);

    (opciones || []).forEach(o => {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = formato(o);
        if (filtro[clave] === o) op.selected = true;
        sel.appendChild(op);
    });

    sel.addEventListener('change', () => { filtro[clave] = sel.value; pintar(); });
    campo.append(lbl, sel);
    return campo;
}

function campoFecha(etiqueta, clave) {
    const campo = document.createElement('label');
    campo.className = 'filtro';

    const lbl = document.createElement('span');
    lbl.className = 'campo-lbl';
    lbl.textContent = etiqueta;

    const inp = document.createElement('input');
    inp.type = 'date';
    inp.className = 'inp';
    inp.value = filtro[clave] || '';
    inp.addEventListener('change', () => { filtro[clave] = inp.value; pintar(); });

    campo.append(lbl, inp);
    return campo;
}

// ---------- cuerpo ----------

function cuerpo(ind, visitas) {
    const body = document.createElement('div');
    body.className = 'panel-body';

    if (visitas.length === 0) {
        body.appendChild(vacio());
        return body;
    }

    body.append(
        tiles(ind),
        seccion('Estado de las visitas', filasEstado(ind)),
        seccion('Evidencias', filasEvidencias(visitas, ind))
    );

    // La vista gerencial: quién necesita ayuda. El promedio del equipo esconde justo al que
    // se está quedando atrás, así que va desglosado por persona y no agregado.
    if (tieneEquipo()) {
        body.appendChild(seccion('Cumplimiento por educador', tablaEducadores(visitas)));
    }

    // Estas tres solo aparecen si hay de dónde: una gráfica con una sola barra no compara nada.
    const magnitudes = [
        ['Actividades por tipo', ind.por_tipo, 'actividades'],
        ['Sectores más atendidos', ind.por_sector, 'sectores'],
        ['Clientes más visitados', ind.por_cliente, 'visitas'],
        ['Hospitales con más actividad', ind.por_hospital, 'visitas']
    ];
    magnitudes.forEach(([titulo, mapa, unidad]) => {
        const datos = top(mapa, 8);
        if (datos.length >= 2) body.appendChild(seccion(titulo, barras(datos, unidad)));
    });

    if (tieneEquipo()) {
        const porEducador = top(ind.por_educador, 10);
        if (porEducador.length >= 2) {
            body.appendChild(seccion('Visitas por educador', barras(porEducador, 'visitas')));
        }
    }

    return body;
}

function vacio() {
    const caja = document.createElement('div');
    caja.className = 'vacio-grande';

    const t = document.createElement('p');
    t.className = 'vacio-titulo';
    t.textContent = 'Nada que mostrar todavía';

    const p = document.createElement('p');
    p.className = 'ayuda';
    p.textContent = 'Cuando guardes visitas —o cambies los filtros— los indicadores aparecen aquí.';

    caja.append(t, p);
    return caja;
}

function seccion(titulo, contenido) {
    const s = document.createElement('section');
    s.className = 'dash-sec';

    const h = document.createElement('h4');
    h.className = 'dash-titulo';
    h.textContent = titulo;

    s.append(h, contenido);
    return s;
}

// ---------- tiles ----------

/**
 * Los números que se leen solos. Un indicador único no es una gráfica: dibujarle ejes lo
 * haría más difícil de leer, no más fácil.
 */
function tiles(ind) {
    const grid = document.createElement('div');
    grid.className = 'tiles';

    const items = [
        ['Visitas', ind.visitas, ''],
        ['Realizadas', ind.realizadas, 'con check-in'],
        ['Pendientes', ind.pendientes, 'sin check-in'],
        ['Cumplimiento', `${ind.cumplimiento}%`, 'de lo no cancelado'],
        ['Actividades', ind.actividades, 'guardadas'],
        ['Evidencias pendientes', ind.evidencias_pendientes, ''],
        ['Sectores distintos', ind.sectores_distintos, ''],
        ['Material entregado', ind.piezas ? redondear(ind.piezas) : 0, `${ind.materiales} registros`],
        ['Horas efectivas', ind.horas_efectivas, 'en cliente'],
        ['Retrasos', ind.retrasos, 'más de 15 min'],
        ['Reagendaciones', ind.reagendaciones, ''],
        ['Cancelaciones', ind.canceladas, '']
    ];

    items.forEach(([etiqueta, valor, nota]) => grid.appendChild(tile(etiqueta, valor, nota)));
    return grid;
}

function tile(etiqueta, valor, nota) {
    const t = document.createElement('div');
    t.className = 'tile';

    const l = document.createElement('span');
    l.className = 'tile-lbl';
    l.textContent = etiqueta;

    const v = document.createElement('span');
    v.className = 'tile-val';
    v.textContent = String(valor);

    t.append(l, v);
    if (nota) {
        const n = document.createElement('span');
        n.className = 'tile-nota';
        n.textContent = nota;
        t.appendChild(n);
    }
    return t;
}

function redondear(n) {
    return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

// ---------- estado: punto + etiqueta + número ----------

/**
 * Cada estado en su renglón, con su nombre escrito.
 *
 * Deliberadamente NO es una barra apilada. Los cuatro colores de estado de esta app se
 * separan ΔE 4.2 en deuteranopía (el par rojo/verde), así que en segmentos pegados una parte
 * de los usuarios no podría leerlos. Con el nombre al lado el color solo refuerza.
 */
function filasEstado(ind) {
    const datos = [
        [ESTADOS.PROGRAMADA, ind.programadas],
        [ESTADOS.EN_PROCESO, ind.en_proceso],
        [ESTADOS.FINALIZADA, ind.finalizadas],
        [ESTADOS.CANCELADA, ind.canceladas]
    ];
    const total = datos.reduce((n, [, v]) => n + v, 0) || 1;

    const caja = document.createElement('div');
    caja.className = 'medidas';

    datos.forEach(([estado, n]) => {
        const fila = document.createElement('div');
        fila.className = 'medida';

        const etiqueta = document.createElement('span');
        etiqueta.className = 'medida-lbl';

        const punto = document.createElement('span');
        punto.className = `dot st-${salud(estado)}`;
        if (estado === ESTADOS.PROGRAMADA) punto.classList.add('hollow');

        const txt = document.createElement('span');
        txt.textContent = etiquetaEstado(estado);

        etiqueta.append(punto, txt);

        const barra = document.createElement('span');
        barra.className = 'medida-barra';
        const relleno = document.createElement('span');
        relleno.className = `medida-fill st-${salud(estado)}`;
        relleno.style.width = `${(n / total) * 100}%`;
        barra.appendChild(relleno);

        const valor = document.createElement('span');
        valor.className = 'medida-val mono';
        valor.textContent = `${n} · ${Math.round((n / total) * 100)}%`;

        fila.append(etiqueta, barra, valor);
        caja.appendChild(fila);
    });

    return caja;
}

/** El estado del ciclo de vida se mapea a la cromía de salud que ya usa el calendario. */
function salud(estado) {
    return {
        [ESTADOS.PROGRAMADA]: 'programada',
        [ESTADOS.EN_PROCESO]: 'faltan-evidencias',
        [ESTADOS.FINALIZADA]: 'completa',
        [ESTADOS.CANCELADA]: 'cancelada'
    }[estado] || 'neutra';
}

/**
 * Cuántas evidencias fueron rechazadas o devueltas a corrección. Sale del flujo de revisión,
 * no del árbol: "rechazada" es un juicio de una persona, no un estado del archivo.
 */
function evidenciasRechazadas(visitas) {
    let n = 0;
    for (const v of visitas) {
        for (const s of v.sectores || []) {
            for (const a of s.actividades || []) {
                const r = revisionVigente('evidencia', a.id);
                if (r && (r.resultado === RESULTADOS.RECHAZADO
                          || r.resultado === RESULTADOS.CORRECCION)) n++;
            }
        }
    }
    return n;
}

function filasEvidencias(visitas, ind) {
    const caja = document.createElement('div');
    caja.className = 'medidas';

    const rechazadas = evidenciasRechazadas(visitas);
    const total = ind.evidencias_subidas + ind.evidencias_pendientes;
    const datos = [
        ['Cargadas', ind.evidencias_subidas, 'completa'],
        ['Pendientes', ind.evidencias_pendientes, 'faltan-evidencias'],
        ['Rechazadas o a corregir', rechazadas, 'sin-registrar']
    ];

    if (total === 0) {
        const p = document.createElement('p');
        p.className = 'ayuda';
        p.textContent = 'Ninguna actividad de este resultado exige evidencia.';
        caja.appendChild(p);
        return caja;
    }

    datos.forEach(([nombre, n, tono]) => {
        const fila = document.createElement('div');
        fila.className = 'medida';

        const etiqueta = document.createElement('span');
        etiqueta.className = 'medida-lbl';
        const punto = document.createElement('span');
        punto.className = `dot st-${tono}`;
        const txt = document.createElement('span');
        txt.textContent = nombre;
        etiqueta.append(punto, txt);

        const barra = document.createElement('span');
        barra.className = 'medida-barra';
        const relleno = document.createElement('span');
        relleno.className = `medida-fill st-${tono}`;
        relleno.style.width = `${(n / total) * 100}%`;
        barra.appendChild(relleno);

        const valor = document.createElement('span');
        valor.className = 'medida-val mono';
        valor.textContent = `${n} · ${Math.round((n / total) * 100)}%`;

        fila.append(etiqueta, barra, valor);
        caja.appendChild(fila);
    });

    return caja;
}

// ---------- magnitud: barras de una sola tinta ----------

/**
 * Barras horizontales, una serie, una tinta.
 *
 * Horizontales porque las etiquetas son nombres largos —"GASAS Y APÓSITOS", razones sociales
 * de hospital— y en vertical habría que girarlas, que es la forma más segura de que nadie las
 * lea. El valor va al final de cada barra: leerlo no debe costar un viaje a un eje.
 */
/**
 * Tabla por educador. Una tabla y no barras porque son seis medidas por persona: seis
 * gráficas obligarían a cruzar la vista entre ellas para responder "¿y este cómo va?".
 */
function tablaEducadores(visitas) {
    const filas = indicadoresPorEducador(visitas);

    const envoltura = document.createElement('div');
    envoltura.className = 'tabla-scroll';

    const tabla = document.createElement('table');
    tabla.className = 'tabla';

    const columnas = ['Educador', 'Visitas', 'Realizadas', 'Cumpl.', 'Activ.',
                      'Evid. pend.', 'Reag.', 'Horas'];

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    columnas.forEach((c, i) => {
        const th = document.createElement('th');
        th.textContent = c;
        if (i > 0) th.className = 'num';
        trh.appendChild(th);
    });
    thead.appendChild(trh);

    const tbody = document.createElement('tbody');
    filas.forEach(e => {
        const tr = document.createElement('tr');

        const nombre = document.createElement('td');
        nombre.textContent = e.nombre;
        nombre.title = e.correo || e.nombre;
        tr.appendChild(nombre);

        [e.visitas, e.realizadas].forEach(v => {
            const td = document.createElement('td');
            td.className = 'num mono';
            td.textContent = String(v);
            tr.appendChild(td);
        });

        // El cumplimiento lleva punto de color Y el número: el color solo refuerza.
        const cumpl = document.createElement('td');
        cumpl.className = 'num mono';
        const punto = document.createElement('span');
        punto.className = `dot st-${tonoCumplimiento(e.cumplimiento)}`;
        const txt = document.createElement('span');
        txt.textContent = ` ${e.cumplimiento}%`;
        cumpl.append(punto, txt);
        tr.appendChild(cumpl);

        [e.actividades, e.evidencias_pendientes, e.reagendaciones, e.horas].forEach(v => {
            const td = document.createElement('td');
            td.className = 'num mono';
            td.textContent = String(v);
            tr.appendChild(td);
        });

        tbody.appendChild(tr);
    });

    tabla.append(thead, tbody);
    envoltura.appendChild(tabla);
    return envoltura;
}

function tonoCumplimiento(pct) {
    if (pct >= 90) return 'completa';
    if (pct >= 70) return 'faltan-evidencias';
    return 'sin-registrar';
}

function barras(datos, unidad) {
    const caja = document.createElement('div');
    caja.className = 'medidas';

    const max = Math.max(...datos.map(([, v]) => v)) || 1;

    datos.forEach(([nombre, valor]) => {
        const fila = document.createElement('div');
        fila.className = 'medida';

        const etiqueta = document.createElement('span');
        etiqueta.className = 'medida-lbl';
        etiqueta.title = nombre;
        etiqueta.textContent = nombre;

        const barra = document.createElement('span');
        barra.className = 'medida-barra';
        const relleno = document.createElement('span');
        relleno.className = 'medida-fill es-tinta';
        relleno.style.width = `${(valor / max) * 100}%`;
        barra.appendChild(relleno);

        const v = document.createElement('span');
        v.className = 'medida-val mono';
        v.textContent = String(redondear(valor));

        fila.append(etiqueta, barra, v);
        caja.appendChild(fila);
    });

    const pie = document.createElement('p');
    pie.className = 'ayuda';
    pie.textContent = `En ${unidad}. Se muestran los ${datos.length} más altos.`;
    caja.appendChild(pie);

    return caja;
}
