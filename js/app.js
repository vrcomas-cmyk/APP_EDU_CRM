/**
 * Arranque, navegación y sincronización.
 *
 * Vistas: #/agenda (calendario + lista), #/nueva (agendar), #/visita/:id (ejecución),
 * #/pendientes (bandeja de evidencias).
 */

import {
    migrarSiHaceFalta, leerCatalogo, agregarVisita, nuevoId
} from './storage.js';
import { descargarCatalogo, sincronizarTodo } from './sync.js';
import { initSelectorSectores, setCatalogoSectores, getSeleccion, mostrarError, limpiarSeleccion } from './sectores.js';
import { initCalendario, clavesVisibles, refrescarCalendario, irADia } from './calendario.js';
import { renderAgenda } from './agenda.js';
import { initDetalle, renderDetalle } from './detalle.js';
import { renderPendientes, contarPendientes, subirTodasLasPendientes } from './evidencias.js';
import { etiquetaDiaLarga } from './fechas.js';

const VISTAS = ['agenda', 'nueva', 'visita', 'pendientes'];

let statusBadge, btnSync;

// ---------- arranque ----------

document.addEventListener('DOMContentLoaded', () => {
    statusBadge = document.getElementById('online-status');
    btnSync = document.getElementById('btn-sync');

    migrarSiHaceFalta();

    initSelectorSectores();
    initCalendario(() => renderAgendaVisible());
    initDetalle(() => refrescarTodo());

    cargarCatalogoEnUI();
    cablearFormulario();
    cablearAcciones();

    window.addEventListener('hashchange', enrutar);
    window.addEventListener('online', actualizarEstadoConexion);
    window.addEventListener('offline', actualizarEstadoConexion);

    enrutar();
    actualizarEstadoConexion();
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
    });
}

// ---------- navegación ----------

function enrutar() {
    const ruta = location.hash.replace(/^#\/?/, '') || 'agenda';
    const [seccion, parametro] = ruta.split('/');
    const vista = VISTAS.includes(seccion) ? seccion : 'agenda';

    VISTAS.forEach(v => {
        document.getElementById(`vista-${v}`).hidden = (v !== vista);
    });
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.vista === vista);
    });

    if (vista === 'agenda') renderAgendaVisible();
    if (vista === 'visita') renderDetalle(parametro);
    if (vista === 'pendientes') renderPendientes(() => refrescarTodo());

    window.scrollTo(0, 0);
}

function renderAgendaVisible() {
    const claves = clavesVisibles();
    renderAgenda(claves);

    const titulo = document.getElementById('agenda-titulo');
    titulo.textContent = claves.length === 1
        ? etiquetaDiaLarga(claves[0])
        : `${claves.length} días`;

    actualizarContadorPendientes();
}

/** Repinta todo lo que depende de los datos, sin importar en qué vista estemos. */
function refrescarTodo() {
    refrescarCalendario();
    if (!document.getElementById('vista-agenda').hidden) renderAgendaVisible();
    if (!document.getElementById('vista-pendientes').hidden) renderPendientes(() => refrescarTodo());
    actualizarContadorPendientes();
}

function actualizarContadorPendientes() {
    const contador = document.getElementById('contador-pendientes');
    const total = contarPendientes();
    contador.textContent = total;
    contador.hidden = total === 0;
}

// ---------- formulario de agendar ----------

function cablearFormulario() {
    const form = document.getElementById('visita-form');

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const seleccion = getSeleccion();
        if (seleccion.length === 0) {
            mostrarError(true);
            return;
        }
        mostrarError(false);

        const fecha = document.getElementById('fecha').value;
        agregarVisita({
            id: nuevoId('v'),
            educador: document.getElementById('educador').value,
            educador_correo: document.getElementById('educador-correo').value,
            cliente: document.getElementById('cliente').value,
            fecha,
            estado: 'agendada',
            sectores: seleccion.map(s => ({
                id: nuevoId('s'),
                nombre: s.nombre,
                objetivo: s.objetivo,
                actividades: []
            })),
            sincronizado: false
        });

        form.reset();
        document.getElementById('educador-correo').value = '';
        limpiarSeleccion();

        // Se salta al día agendado: si no, al volver a la agenda (que abre en "hoy")
        // una visita de la próxima semana no aparecería y parecería que no se guardó.
        location.hash = '#/agenda';
        irADia(fecha);
        refrescarTodo();

        if (navigator.onLine) sincronizar();
    });

    const educador = document.getElementById('educador');
    educador.addEventListener('change', (e) => {
        const datos = leerCatalogo();
        const encontrado = datos?.educadores?.find(edu => edu.nombre === e.target.value);
        document.getElementById('educador-correo').value = encontrado ? encontrado.correo : '';
    });
}

function cablearAcciones() {
    btnSync.addEventListener('click', sincronizar);

    document.getElementById('btn-subir-todas').addEventListener('click', async (e) => {
        const boton = e.currentTarget;
        boton.disabled = true;
        boton.textContent = '⏳ Subiendo...';

        const resultado = await subirTodasLasPendientes();
        if (resultado.fallidas > 0) {
            alert(`Subieron ${resultado.subidas}, fallaron ${resultado.fallidas}. Reintenta con señal.`);
        }
        refrescarTodo();
    });
}

// ---------- catálogo ----------

function cargarCatalogoEnUI() {
    const datos = leerCatalogo();
    if (!datos) return;

    if (datos.sectores) setCatalogoSectores(datos.sectores);
    llenarDatalist('lista-clientes', datos.clientes);
    llenarDatalist('lista-educadores', (datos.educadores || []).map(e => e.nombre));
}

function llenarDatalist(id, valores) {
    const lista = document.getElementById(id);
    if (!lista || !valores) return;

    const fragmento = document.createDocumentFragment();
    valores.forEach(valor => {
        const opcion = document.createElement('option');
        opcion.value = valor;
        fragmento.appendChild(opcion);
    });

    lista.innerHTML = '';
    lista.appendChild(fragmento);
}

async function descargarCatalogoSiSePuede() {
    try {
        await descargarCatalogo();
        cargarCatalogoEnUI();
    } catch (err) {
        console.error('No se pudieron descargar los catálogos:', err);
    }
}

// ---------- conexión y sync ----------

function actualizarEstadoConexion() {
    if (navigator.onLine) {
        statusBadge.textContent = 'Online';
        statusBadge.className = 'badge online';
        btnSync.disabled = false;
        sincronizar();
        descargarCatalogoSiSePuede();
    } else {
        statusBadge.textContent = 'Offline';
        statusBadge.className = 'badge offline';
        btnSync.disabled = true;
    }
    refrescarTodo();
}

let sincronizando = false;

async function sincronizar() {
    if (sincronizando || !navigator.onLine) return;
    sincronizando = true;
    btnSync.textContent = '⌛ Enviando...';

    try {
        const resultado = await sincronizarTodo();
        const nada = resultado.visitas.enviadas === 0 && resultado.evidencias.subidas === 0;
        btnSync.textContent = nada ? '✅ ¡Al día!' : '✅ Sincronizado';
    } catch (error) {
        console.error('Error al sincronizar:', error);
        btnSync.textContent = '❌ Error';
    } finally {
        sincronizando = false;
        setTimeout(() => { btnSync.textContent = '🔄 Sincronizar'; }, 2000);
        refrescarTodo();
    }
}
