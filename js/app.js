/**
 * Arranque y coordinación.
 *
 * No hay router de vistas: el calendario ES la pantalla. Todo lo demás (agendar, ejecutar)
 * ocurre en un drawer encima, para no tapar el contexto que da sentido a lo que estás
 * haciendo — al agendar, la pregunta real es "¿dónde cabe esto?".
 */

import {
    migrarSiHaceFalta, leerCatalogo, adoptarVisitasPropias, leerVisitas, evidenciasLocales
} from './storage.js';
import { eventosPendientes } from './eventos.js';
import { fechaDocumentoFaltante } from './catalogos.js';
import {
    descargarCatalogo, catalogoEsFresco, sincronizarTodo, descargarVisitasEquipo, descargarRevisiones,
    progresoSubidaEvidencias, evidenciasSinArchivoLocal, descargarAvisos
} from './sync.js';
import { ponerAvisos, olvidarAvisos } from './avisos.js';
import { deudaGlobal } from './estado.js';
import {
    initVistas, refrescarVistas as refrescarCalendario, irAHoy, setModo, irADia, mostrarModulo
} from '../src/app/montarVistas';
import { initDrawer, abrirNuevaVisita, abrirVisita, hayDrawerAbierto } from '../src/modules/visitas/montarDrawer';
import { initPaleta, abrirPaleta, hayPaletaAbierta } from '../src/modules/paleta/montarPaleta';
import { configurarToken } from '../src/services/google/appsScript';
import {
    initPermisos, actualizarPerfil, olvidarPerfil,
    accesoBloqueado, aceptarInvitacion,
    enSimulacion, detalleSimulacion, salirSimulacion
} from './permisos.js';
import { ponerVisitasEquipo, olvidarVisitasEquipo, hayEquipoCargado } from './datos.js';
import { guardarCache, leerCache, borrarCache } from './cacheLocal.js';
import { ponerFlujos, ponerRevisiones, olvidarRevisiones, hayRevisionesCargadas } from './revisiones.js';
import { initAuth, sesionActual, pintarBotonEntrada, cerrarSesion } from './auth.js';
import { initTema, initEstilo } from './tema.js';
import { ES_PRUEBAS } from '../src/services/config';
import { conectarCanal } from '../src/services/supabase/realtime';

// Se pinta al cargar el módulo, no en `iniciarApp()`: tiene que verse en el gate de login,
// antes de cualquier sesión, o no cumple su propósito de evitar confundir esta app con la
// oficial. Sin condición de ocultarlo en `produccion` — `hidden` ya viene puesto en el HTML.
if (ES_PRUEBAS) {
    document.getElementById('banner-entorno').hidden = false;
}

let el = {};
let sincronizando = false;
let inicioCicloSync = 0;
let appIniciada = false;
// Cuántas veces seguidas falló un ciclo. Ya no apaga el auto-sync (ver `sincronizarFallo`
// antiguo): en vez de detenerse hasta un clic manual, cada fallo alarga el intervalo del
// siguiente reintento (backoff) y un ciclo bueno lo vuelve a poner en el intervalo normal —
// así "hay veces que no sincroniza" deja de depender de que alguien lo note y pulse el botón.
let fallosSeguidos = 0;
// El chip se queda en rojo mientras el último ciclo haya fallado. Antes el `finally` lo reemplazaba
// enseguida por "N en cola", y el fallo (p. ej. una foto que no sube) pasaba sin que nadie lo viera.
let ultimoCicloFallo = false;
const ESPERAS_BACKOFF_MS = [15000, 30000, 60000, 120000, 300000]; // 15s .. 5min, tope
const INTERVALO_NORMAL_MS = 60000;
// Un ciclo que nunca resuelve (pestaña congelada a media subida, promesa que no cierra) no
// debe dejar `sincronizando` en `true` para siempre: eso silenciaría todo intento posterior,
// automático o manual. Pasado este margen sobre el timeout de red, se da por muerto.
// La subida de evidencias es la única etapa que puede tardar de verdad (tres intentos por archivo,
// 90 s cada uno): un margen menor encimaba un ciclo nuevo sobre el que aún subía.
const WATCHDOG_MS = 6 * 60000;
let relojAutoSync = null;

document.addEventListener('DOMContentLoaded', () => {
    el = {
        gate: document.getElementById('gate'),
        sinInvitacion: document.getElementById('sin-invitacion'),
        sinInvitacionCorreo: document.getElementById('sin-invitacion-correo'),
        sinInvitacionSalir: document.getElementById('sin-invitacion-salir'),
        gateBoton: document.getElementById('gate-boton'),
        app: document.getElementById('app'),
        bannerSimulacion: document.getElementById('banner-simulacion'),
        bannerSimulacionTexto: document.getElementById('banner-simulacion-texto'),
        bannerSimulacionSalir: document.getElementById('banner-simulacion-salir'),
        sync: document.getElementById('btn-sync'),
        syncTxt: document.getElementById('sync-txt'),
        deuda: document.getElementById('btn-deuda'),
        buscar: document.getElementById('btn-buscar'),
        deudaN: document.getElementById('deuda-n'),
        sesion: document.getElementById('btn-sesion'),
        sesionFoto: document.getElementById('sesion-foto'),
        sesionNombre: document.getElementById('sesion-nombre'),
        fab: document.getElementById('fab'),
        toasts: document.getElementById('toasts')
    };

    el.sesion.addEventListener('click', () => {
        if (!confirm('¿Cerrar sesión en este dispositivo?')) return;
        // El perfil cacheado es de quien se va: dejarlo daría sus permisos a quien entre.
        olvidarPerfil();
        olvidarAvisos();
        borrarCache(sesionActual()?.correo);
        cerrarSesion();
    });

    el.sinInvitacionSalir.addEventListener('click', () => {
        olvidarPerfil();
        olvidarVisitasEquipo();
        olvidarRevisiones();
        borrarCache(sesionActual()?.correo);
        cerrarSesion();
    });

    el.bannerSimulacionSalir.addEventListener('click', () => {
        salirSimulacion();
        location.reload();
    });

    initTema(document.getElementById('tema-switch'));
    initEstilo(document.getElementById('estilo-switch'));

    initPermisos();
    pintarBannerSimulacion();
    initAuth({ onSesion: alCambiarSesion });
    pintarBotonEntrada(el.gateBoton);

    const sesion = sesionActual();
    if (!sesion) return mostrarGate();

    pintarSesion(sesion);
    // El bloqueo cacheado se respeta desde el arranque: si ya se supo que no hay invitación,
    // no tiene sentido armar la app entera para cerrarla medio segundo después. Pero esa
    // caché puede estar desactualizada —un administrador acaba de invitar a esta persona, o
    // la invitación se aceptó desde otro dispositivo— así que de todos modos se reintenta
    // contra el servidor en segundo plano: sin esto, quedarse una vez bloqueado era
    // definitivo, y la única salida era "Usar otra cuenta" para forzar el olvido de la caché.
    if (accesoBloqueado()) { mostrarSinInvitacion(sesion); refrescarPerfil(); }
    else { mostrarApp(); iniciarApp(); }
});

/** Login (primera vez en esta carga) o logout: no hay estado intermedio a medio armar. */
function alCambiarSesion(sesion) {
    pintarSesion(sesion);
    if (sesion) {
        if (accesoBloqueado()) return mostrarSinInvitacion(sesion);
        if (!appIniciada) { mostrarApp(); iniciarApp(); }
        return;
    }
    // Cerrar sesión con la app ya armada (calendario, drawer, listeners…) es más simple de
    // resolver recargando que desmontando todo módulo por módulo a mano.
    location.reload();
}

function mostrarGate() {
    el.gate.hidden = false;
    el.fab.hidden = true;
    el.app.hidden = true;
    el.sinInvitacion.hidden = true;
}

function mostrarApp() {
    el.gate.hidden = true;
    el.sinInvitacion.hidden = true;
    el.app.hidden = false;
}

/**
 * Puerta cerrada. Solo se llega aquí con un NO explícito del servidor —nunca por falta de
 * red— porque bloquear a alguien por no haber podido preguntar convertiría cada bache de
 * señal en un educador que no puede trabajar.
 */
function mostrarSinInvitacion(sesion) {
    el.gate.hidden = true;
    el.fab.hidden = true;
    el.app.hidden = true;
    el.sinInvitacion.hidden = false;
    el.sinInvitacionCorreo.textContent = sesion?.correo || '';
}

/**
 * El banner de "ver como" tiene que quedar fijo mientras dure la simulación: es la única
 * defensa contra olvidarse de que se está viendo la app como otra identidad. Entrar y salir de
 * la simulación recargan la página (ver `PanelSimular.tsx`), así que pintar una vez al arrancar
 * basta — no hace falta refrescarlo en cada re-render.
 */
function pintarBannerSimulacion() {
    const activa = enSimulacion();
    el.bannerSimulacion.hidden = !activa;
    // El corte real de escritura está en `postear` (appsScript.ts); esto es solo que el botón
    // no invite a una acción que de todos modos va a ser rechazada.
    // Sin sesión tampoco: este botón no debe verse en la pantalla de login (la app aún no existe).
    el.fab.hidden = activa || !sesionActual();
    if (!activa) return;

    const detalle = detalleSimulacion();
    const quien = detalle?.nombre || detalle?.ref || 'otra identidad';
    el.bannerSimulacionTexto.textContent = `Viendo como ${quien} — solo lectura`;
}

function pintarSesion(sesion) {
    el.sesion.hidden = !sesion;
    if (!sesion) return;
    el.sesionNombre.textContent = sesion.nombre;
    el.sesionFoto.hidden = !sesion.foto;
    if (sesion.foto) el.sesionFoto.src = sesion.foto;
    pintarAccesos();
}

/**
 * Qué módulos se ofrecen lo decide el RIEL, leyendo el registro de módulos.
 *
 * Aquí ya no se esconden botones a mano: cada módulo declara su propia condición de acceso y
 * el riel se redibuja. Repartir esa decisión en dos lugares es como se acaba con un botón
 * visible que lleva a "no tienes permiso".
 */
function pintarAccesos() {
    refrescarCalendario();
}

/**
 * Consulta Supabase en segundo plano. Si vuelve con que no hay invitación, se cierra la
 * puerta aunque la app ya estuviera armada: una invitación revocada tiene que surtir efecto
 * sin esperar a que la persona decida recargar.
 */
function refrescarPerfil() {
    actualizarPerfil().then((res) => {
        if (res === null) return;
        if (accesoBloqueado()) return mostrarSinInvitacion(sesionActual());

        aceptarInvitacion();      // trámite silencioso la primera vez

        // Llega aquí desbloqueado. Si la app todavía no se había armado —se llegó bloqueado
        // al arrancar y esto es el reintento en segundo plano—, se arma ahora: la persona
        // pasa de "no tienes invitación" a la app sin tener que recargar a mano.
        if (!appIniciada) { mostrarApp(); iniciarApp(); return; }

        pintarAccesos();
        cargarEquipo();
        cargarRevisiones();
    });
}

/**
 * Trae las visitas del equipo al espejo en memoria. Se pide SIEMPRE, tenga o no tenga equipo
 * la persona: es también cómo un educador sin nadie a cargo recupera, en OTRO dispositivo, lo
 * que capturó en el primero —su propio correo puede tener visitas en el espejo aunque
 * `pdt_alcance` no le devuelva a nadie más—. Pedirla de menos aquí significa que esa persona
 * abre la app en el celular y no ve nada de lo que hizo en la compu.
 *
 * `descargarVisitasEquipo()` pide con la identidad REAL (Apps Script la verifica, no la
 * simulación) y un administrador real trae TODO el espejo — de ahí sale lo que `visiblePara()`
 * va a recortar después al alcance de la persona simulada. Eso ya cubre "ver como" sin nada
 * especial aquí.
 *
 * De lo que llega, se ADOPTA a este disco la parte que es del correo real de la sesión —para
 * que sea editable, no solo visible—, salvo en simulación: un admin "viendo como" alguien no
 * debe terminar con las visitas de esa persona en su propio localStorage.
 */
function cargarEquipo() {
    return descargarVisitasEquipo().then(({ visitas, espejo }) => {
        if (!espejo) return;      // el espejo no está configurado: se sigue con lo local
        ponerVisitasEquipo(visitas);
        guardarCache(sesionActual()?.correo, 'visitas', visitas);
        if (!enSimulacion()) adoptarVisitasPropias(visitas, sesionActual()?.correo);
        refrescarTodo();
    });
}

/**
 * Flujos y revisiones. Se piden aunque no haya equipo: un educador también necesita ver
 * qué le rechazaron, y eso es una revisión sobre sus propias visitas.
 */
function cargarRevisiones() {
    return descargarRevisiones().then(({ flujos, revisiones, espejo }) => {
        if (!espejo) return;
        ponerFlujos(flujos);
        ponerRevisiones(revisiones);
        guardarCache(sesionActual()?.correo, 'revisiones', { flujos, revisiones });
        pintarAccesos();
        refrescarTodo();
    });
}

/**
 * Lo que un revisor le devolvió a ESTA persona (rechazado, requiere corrección). Se baja junto con
 * todo lo demás, así que el aviso en tiempo real que ya dispara cada revisión nueva, el poll de
 * 60 s y volver a primer plano lo actualizan sin cableado propio.
 */
function cargarAvisos() {
    return descargarAvisos().then(({ avisos, espejo }) => {
        if (!espejo) return;
        const nuevos = ponerAvisos(avisos);
        guardarCache(sesionActual()?.correo, 'avisos', avisos);
        pintarAccesos();   // la insignia del menú

        if (nuevos.length > 0) {
            // Uno solo, aunque lleguen varios juntos: un toast por aviso taparía la pantalla.
            const primero = nuevos[0];
            const texto = nuevos.length === 1
                ? `Te devolvieron: ${primero.titulo}${primero.detalle ? ` — ${primero.detalle}` : ''}`
                : `Tienes ${nuevos.length} avisos de revisión por atender.`;
            toast(texto, {
                estado: 'sin-registrar',
                accion: { texto: 'Ver avisos', fn: () => mostrarModulo('avisos') }
            });
        }
    });
}

/**
 * Toda la BAJADA del espejo (visitas del equipo, revisiones, catálogo), separada de la SUBIDA.
 * Nunca lanza: cada pieza ya atrapa sus propios errores (`descargarVisitasEquipo`,
 * `descargarRevisiones` y `descargarCatalogoSiSePuede` devuelven vacío/registran en consola en
 * vez de rechazar), así que esto puede llamarse en cualquier momento —incluso si la subida
 * falló— sin arriesgar nada más.
 */
let bajadaEnVuelo = null;

/**
 * Deduplica bajadas simultáneas: `alCambiarConexion`, `volverAPrimerPlano` y el `finally` de
 * `sincronizar()` pueden pedirla casi al mismo tiempo (p. ej. al recuperar señal con la pestaña
 * recién vuelta a primer plano). Sin esto, cada disparador metía su propia ronda de peticiones
 * en vez de compartir la que ya estaba en camino.
 */
function bajarDelEspejo() {
    if (bajadaEnVuelo) return bajadaEnVuelo;
    bajadaEnVuelo = Promise.all([cargarEquipo(), cargarRevisiones(), cargarAvisos(), descargarCatalogoSiSePuede()])
        .finally(() => { bajadaEnVuelo = null; });
    return bajadaEnVuelo;
}

/**
 * Arranque instantáneo: pinta lo último que se bajó del equipo (IndexedDB) mientras el servidor
 * responde. Solo llena lo que aún está vacío — si la bajada real ya llegó, esa manda.
 */
async function hidratarDesdeCache() {
    const correo = sesionActual()?.correo;
    const [visitas, rev, avisos] = await Promise.all([
        leerCache(correo, 'visitas'), leerCache(correo, 'revisiones'), leerCache(correo, 'avisos')
    ]);
    let algo = false;

    if (Array.isArray(visitas) && !hayEquipoCargado()) {
        ponerVisitasEquipo(visitas);
        algo = true;
    }
    if (rev && !hayRevisionesCargadas()) {
        ponerFlujos(rev.flujos);
        ponerRevisiones(rev.revisiones);
        algo = true;
    }
    // Sin señal también se ve lo último que se supo: un aviso no depende de tener red para leerse.
    if (Array.isArray(avisos)) { ponerAvisos(avisos); algo = true; }
    if (algo) { pintarAccesos(); refrescarTodo(); }
}

/** Todo lo que antes vivía suelto en DOMContentLoaded: ahora espera a que haya sesión. */
function iniciarApp() {
    appIniciada = true;
    hidratarDesdeCache();

    configurarToken(() => {
        const sesion = sesionActual();
        return sesion?.sesion_token ? { sesion_token: sesion.sesion_token } : { id_token: sesion?.id_token || '' };
    });

    const migracion = migrarSiHaceFalta();
    if (migracion) {
        toast(`Se actualizaron ${migracion.visitas} visitas al formato nuevo.`, { estado: 'completa' });
    }

    initDrawer({ onCambio: refrescarTodo, onToast: toast });
    initVistas({
        onAbrirVisita: (id) => abrirVisita(id),
        onCrearEn: (dia, horaInicio, horaFin) => abrirNuevaVisita({ dia, hora_inicio: horaInicio, hora_fin: horaFin }),
        onCambio: refrescarTodo,
        onToast: toast
    });
    initPaleta({
        onNuevaVisita: () => abrirNuevaVisita(),
        onIrAHoy: irAHoy,
        onSetModo: setModo,
        onAbrirVisita: abrirVisita,
        onIrADia: irADia
    });

    el.fab.addEventListener('click', () => abrirNuevaVisita());
    el.sync.addEventListener('click', () => sincronizar({ manual: true }));
    el.deuda.addEventListener('click', () => mostrarModulo('evidencias'));
    // Único disparador táctil de la paleta: sin esto, Ctrl+K la deja inalcanzable en el celular.
    el.buscar.addEventListener('click', () => abrirPaleta());

    document.addEventListener('keydown', atajos);
    document.addEventListener('keydown', atajoPaleta);
    window.addEventListener('online', alCambiarConexion);
    window.addEventListener('offline', alCambiarConexion);
    // "Ingresar" en el celular casi siempre es retomar la pestaña, no un arranque nuevo: sin
    // esto, volver de otra app podía dejar horas de trabajo sin subir, y lo que el equipo
    // capturó mientras tanto sin bajar, hasta el próximo toque manual del chip de sync.
    // `volverAPrimerPlano` baja primero (lo del equipo aparece al instante) y sube después.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') volverAPrimerPlano();
    });
    // Complementa a `visibilitychange`: en Android, volver "atrás" desde otra app puede
    // restaurar la pestaña desde el bfcache sin pasar por un cambio de visibilidad, y
    // `focus` cubre el caso de escritorio (cambiar de ventana y volver).
    window.addEventListener('focus', volverAPrimerPlano);
    window.addEventListener('pageshow', volverAPrimerPlano);
    // Cada guardado (visita, evidencia, check-in/out) pasa por `guardarVisitas` en
    // storage.js, que emite esto — así sube solo sin esperar al botón.
    window.addEventListener('pdt:visitas-guardadas', alGuardarVisitas);
    // El avance de la subida de fotos se ve en el chip: sin esto solo decía "Enviando".
    window.addEventListener('pdt:evidencia-progreso', alProgresoDeEvidencias);
    // La bandeja de evidencias pide un ciclo manual ("Subir todo ahora") sin importar este módulo.
    window.addEventListener('pdt:sincronizar', (e) => sincronizar({ manual: true, ...(e.detail || {}) }));

    refrescarTodo();
    // Tras el primer pintado: bajar el catálogo (~1 MB), el espejo y sincronizar compiten por la red
    // y por Apps Script justo cuando la persona espera ver su agenda. La app ya se ve con lo
    // cacheado; esto solo la pone al día.
    despuesDelPrimerPintado(alCambiarConexion);
    // La línea de "ahora" se queda quieta si nadie la mueve.
    setInterval(refrescarCalendario, 60000);
    reanudarAutoSync();
    conectarRealtime();
}

/**
 * Vía rápida sobre el poll de 60s, no un reemplazo: si el canal no conecta —red corporativa
 * que bloquea WebSocket, por ejemplo— `reanudarAutoSync()` de todos modos sigue trayendo lo
 * del equipo, solo que una vez por minuto en vez de al instante. Por eso no hay manejo de
 * error aquí: lo peor que puede pasar ya tiene una red de seguridad.
 */
function conectarRealtime() {
    const sesion = sesionActual();
    if (!sesion?.sesion_token) return; // sesión vieja de Google (id_token): sin canal propio
    conectarCanal(sesion.sesion_token, bajarDelEspejo, (conectado) => {
        // Sin indicador en la UI todavía: esto es lo único que dice si la vía rápida está
        // viva o si la app quedó dependiendo del poll de 60s (red que bloquea WebSocket).
        console.log(conectado ? '[realtime] canal conectado' : '[realtime] canal no conectó — usando solo el poll de 60s');
        if (!conectado) return;
        // Al reconectar (recuperar señal, volver de segundo plano) puede haber pasado algo
        // mientras el canal estaba caído; una bajada de más no hace daño y cierra ese hueco.
        bajarDelEspejo();
    });
}

let volviendoAPrimerPlano = false;

/** Baja lo del equipo de inmediato y dispara la subida propia — ver comentario en el listener. */
function volverAPrimerPlano() {
    if (volviendoAPrimerPlano) return;
    volviendoAPrimerPlano = true;
    bajarDelEspejo().finally(() => { volviendoAPrimerPlano = false; });
    sincronizar();
}

/**
 * Reloj de fondo: reconciliación completa (backend + Calendar en ambos sentidos), para la app
 * abierta toda la tarde con señal intermitente o guardados espaciados.
 *
 * Ya NO se pausa en segundo plano: apagar el timer a mano (como antes) es lo que dejaba un
 * celular minimizado sin sincronizar hasta el próximo toque — el propio navegador ya limita
 * cuánto puede correr un timer en una pestaña oculta, así que no hace falta ayudarlo a quedarse
 * mudo. El intervalo baja de 5 min a 1 min: junto con el backoff de `sincronizar()`, un fallo
 * aislado ya no obliga a esperar 5 min completos para el siguiente intento.
 */
function reanudarAutoSync() {
    if (relojAutoSync) return;
    relojAutoSync = setInterval(() => sincronizar(), INTERVALO_NORMAL_MS);
}

// `sw.js` solo existe en el build (lo genera `serviceWorkerGenerado()`, vite.config.ts): en
// `vite dev` esa ruta no existe y el servidor responde con el `index.html` de siempre —
// registrar ese HTML como service worker no falla en silencio, tira un SecurityError de MIME
// que no tiene nada que ver con ningún bug de la app, solo ruido de consola en desarrollo.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
    });
}

// ---------- atajos ----------

function atajos(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Si estás escribiendo, "n" es una letra, no un comando.
    const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if (escribiendo) return;

    if (e.key === 'Escape') return;              // el drawer se cierra solo
    if (hayDrawerAbierto()) return;

    const acciones = {
        n: () => abrirNuevaVisita(),
        t: () => irAHoy(),
        d: () => setModo('dia'),
        s: () => setModo('semana'),
        m: () => setModo('mes'),
        i: () => mostrarModulo('dashboard'),
        r: () => mostrarModulo('revision')
    };
    const accion = acciones[e.key.toLowerCase()];
    if (accion) { e.preventDefault(); accion(); }
}

/** Separado de `atajos`: éste SÍ debe funcionar con el drawer abierto (para poder saltar). */
function atajoPaleta(e) {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
    e.preventDefault();
    if (hayDrawerAbierto() || hayPaletaAbierta()) return;
    abrirPaleta();
}

// ---------- refresco ----------

export function refrescarTodo() {
    // El riel se repinta con esto: su contador de pendientes lo calcula el propio módulo.
    refrescarCalendario();
    actualizarDeuda();
}

function actualizarDeuda() {
    const n = deudaGlobal().length;
    el.deudaN.textContent = n;
    el.deuda.hidden = n === 0;
    if (n > 0) {
        const { sinArchivo, porSubir } = desgloseDeEvidencias();
        el.deuda.title = `${sinArchivo} sin archivo · ${porSubir} por subir. Toca para abrir la bandeja.`;
    }
}

/** Corre `fn` cuando el navegador ya pintó la app, sin quitarle tiempo al primer render. */
function despuesDelPrimerPintado(fn) {
    requestAnimationFrame(() => setTimeout(fn, 0));
}

/**
 * La deuda de evidencias, partida en lo que solo una persona puede saldar (falta adjuntar el
 * archivo) y lo que ya solo espera red. Sin esto "evidencias" era un número que no se movía
 * aunque el teléfono tuviera señal: la mayor parte nunca ha tenido archivo.
 */
function desgloseDeEvidencias() {
    const deuda = deudaGlobal();
    const sinArchivoAqui = evidenciasSinArchivoLocal();
    const porSubir = deuda.filter(({ actividad }) =>
        actividad.evidencia?.estado === 'local' && !sinArchivoAqui.has(actividad.id)).length;
    return { sinArchivo: deuda.length - porSubir, porSubir };
}

/**
 * Lo que de verdad espera red: visitas por sincronizar, fotos ya adjuntas por subir y eventos de
 * bitácora. NO la deuda de evidencias (eso es "falta adjuntar", no una cola): confundirlas hacía
 * que "En cola" marcara siempre lo mismo.
 */
function contarEnCola() {
    const visitas = leerVisitas().filter(v => !v.sincronizado && !v.borrador).length;
    const sinArchivoAqui = evidenciasSinArchivoLocal();
    // Las que esperan la fecha del documento no son cola de red: son un dato que falta (van a Avisos).
    const fotos = evidenciasLocales()
        .filter(({ actividad }) => !sinArchivoAqui.has(actividad?.id) && !fechaDocumentoFaltante(actividad)).length;
    return visitas + fotos + eventosPendientes().length;
}

// ---------- toasts ----------

let toastSeq = 0;

/**
 * Un toast nombra qué pasó y, si aplica, qué hacer. Nunca se disculpa ni dice
 * "algo salió mal": eso no es información.
 */
// ---------- toasts ----------
//
// Severidad derivada del estado. Antes la `ms` era un parámetro suelto: cada llamador
// acordaba (mal) cuánto dura. Aquí se decide una vez: un fallo necesita más tiempo para
// leerse y reaccionar que un "guardado". El llamador puede siempre forzar `ms`.
const MS_POR_SEVERIDAD = {
    completa: 4000,        // éxito: se lee y se va
    programada: 4000,      // aviso neutro (offline, sync...)
    'sin-registrar': 6500 // error o recuperación: necesita tiempo para reaccionar
};

export function toast(texto, { estado = null, accion = null, ms } = {}) {
    const t = document.createElement('div');
    t.className = 'toast' + (estado ? ` st-${estado}` : '');
    t.dataset.id = ++toastSeq;

    // `aria-live` y `role` van AQUÍ, no solo en el contenedor `.toasts`: los lectores de
    // pantalla que arrancan después de que la página cargó no anuncian nodos insertados en
    // un `aria-live` cuyo contenedor principal ya existía al principio. Marcar cada toast
    // garantiza que el aviso se oiga sin importar cuándo se abra el lector.
    //
    // `polite` para todo, incluyendo errores: `assertive` interrumpe y en una app de uso
    // clínico constante (donde se reciben alertas y se reacciona en el momento) interrumpir
    // cada cancelación sería caos. El error se distingue por `role` y por el color del
    // borde (`--st-miss`), no por acaparar el habla.
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');

    if (estado) {
        const d = document.createElement('span');
        d.className = 'dot';
        if (estado === 'programada') d.classList.add('hollow');
        t.appendChild(d);
    }

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = texto;
    t.appendChild(txt);

    if (accion) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'u';
        btn.textContent = accion.texto;
        btn.addEventListener('click', () => { accion.fn(); t.remove(); });
        t.appendChild(btn);
    }

    // Si trae acción (botón "Deshacer"), no se retira solo: quitarlo antes de haber
    // pulsado es esconder el remedio. El doble de tiempo deja reaccionar.
    const base = ms ?? MS_POR_SEVERIDAD[estado ?? 'completa'] ?? 4000;
    const total = accion ? base * 2 : base;

    el.toasts.appendChild(t);
    setTimeout(() => t.remove(), total);
    return t;
}

// ---------- conexión y sync ----------

function alCambiarConexion() {
    if (navigator.onLine) {
        // La sesión propia (`sesion_token`) no caduca sola —a diferencia del viejo id_token de
        // ~1h de GIS— así que ya no hace falta renovar nada aquí antes de sincronizar.
        // Bajar primero: lo que el equipo sincronizó mientras este dispositivo estaba sin
        // señal aparece de inmediato, sin esperar a que la subida propia termine.
        bajarDelEspejo();
        sincronizar({ reintentoPorConexion: true });
        refrescarPerfil();
    } else {
        pintarSync('is-off', 'Sin conexión');
    }
}

let relojDebounceSync = null;
// Un guardado que llega mientras el ciclo anterior sigue en vuelo NO debe perderse: antes,
// `alGuardarVisitas` simplemente salía (`if (sincronizando) return`) y ese guardado se quedaba
// sin re-disparar nada hasta el próximo evento — el poll de 60s, u otro guardado más adelante.
// Con esta bandera, el `finally` de `sincronizar()` relanza un ciclo nuevo apenas el actual
// termina, así que lo que se guardó a media subida sale en cuanto hay hueco, no un minuto después.
let cambioPendienteMientrasSincroniza = false;

/**
 * Auto-sync tras guardar: agrupa la ráfaga de escrituras de un mismo guardado (visita,
 * evidencia, check-in/out) en un solo envío en vez de uno por escritura.
 */
function alGuardarVisitas() {
    if (sincronizando) {
        cambioPendienteMientrasSincroniza = true;
        return;
    }
    clearTimeout(relojDebounceSync);
    relojDebounceSync = setTimeout(() => sincronizar(), 2000);
}

function pintarSync(clase, texto) {
    el.sync.className = `sync ${clase}`;
    el.syncTxt.textContent = texto;
}

function estadoSyncEnReposo() {
    if (!navigator.onLine) return pintarSync('is-off', 'Sin conexión');
    if (ultimoCicloFallo) return pintarSync('is-error', 'Error · reintentar');

    const pendientes = contarEnCola();
    if (pendientes > 0) return pintarSync('is-queue', `${pendientes} en cola`);
    pintarSync('', 'Al día');
}

/** "Subiendo 2/5…" mientras hay fotos en vuelo; al terminar vuelve al estado de reposo. */
function alProgresoDeEvidencias() {
    const p = progresoSubidaEvidencias();
    if (p.enCurso && p.total > 0) {
        pintarSync('is-busy', `Subiendo ${Math.min(p.hechas + 1, p.total)}/${p.total}…`);
    }
    // El estado final lo pinta `sincronizar()` al cerrar el ciclo; aquí solo el avance.
    actualizarDeuda();
}

let relojReintentoBackoff = null;

/** Cancela un reintento con backoff ya programado — un ciclo bueno o uno manual lo reemplazan. */
function cancelarReintentoBackoff() {
    clearTimeout(relojReintentoBackoff);
    relojReintentoBackoff = null;
}

/**
 * Programa el siguiente intento tras un fallo, cada vez más espaciado
 * (`ESPERAS_BACKOFF_MS`), en vez de apagar el auto-sync hasta un clic manual. El reloj de
 * fondo (`reanudarAutoSync`, cada `INTERVALO_NORMAL_MS`) de todos modos volvería a intentarlo,
 * pero esto reacciona antes cuando la señal se cae por rachas cortas.
 */
function programarReintentoBackoff() {
    cancelarReintentoBackoff();
    const espera = ESPERAS_BACKOFF_MS[Math.min(fallosSeguidos - 1, ESPERAS_BACKOFF_MS.length - 1)];
    relojReintentoBackoff = setTimeout(() => sincronizar(), espera);
}

async function sincronizar({ manual = false, reintentoPorConexion = false } = {}) {
    if (!navigator.onLine) {
        if (manual) {
            toast('Sin conexión. Lo que registres se guarda y sube solo al recuperar señal.', { estado: 'programada' });
        }
        return;
    }
    // Un ciclo colgado (pestaña congelada, promesa que nunca cierra) no debe dejar el
    // auto-sync mudo para siempre: pasado el watchdog, se permite empezar uno nuevo aunque el
    // anterior nunca haya llegado a su `finally`.
    if (sincronizando) {
        if (Date.now() - inicioCicloSync < WATCHDOG_MS) return;
        console.error('Un ciclo de sincronización no cerró a tiempo; se intenta uno nuevo.');
    }
    cancelarReintentoBackoff();
    sincronizando = true;
    inicioCicloSync = Date.now();
    pintarSync('is-busy', 'Enviando');
    ultimoCicloFallo = false;

    try {
        const r = await sincronizarTodo();
        const huboErrores = r.errores && Object.keys(r.errores).length > 0;

        if (huboErrores) {
            fallosSeguidos++;
            ultimoCicloFallo = true;
            console.error('sincronizarTodo terminó con etapas fallidas:', r.errores);
            pintarSync('is-error', 'Error');
            programarReintentoBackoff();
            if (manual) {
                toast('Algunas partes no se pudieron sincronizar. Se reintenta solo.', { estado: 'sin-registrar' });
            }
        } else {
            fallosSeguidos = 0;
        }

        const nada = r.visitas.enviadas === 0 && r.evidencias.subidas === 0;
        if (manual && nada && !huboErrores) toast('Todo está sincronizado.', { estado: 'completa' });
        if (!nada) {
            const partes = [];
            if (r.visitas.enviadas) partes.push(`${r.visitas.enviadas} visita${r.visitas.enviadas > 1 ? 's' : ''}`);
            if (r.evidencias.subidas) partes.push(`${r.evidencias.subidas} evidencia${r.evidencias.subidas > 1 ? 's' : ''}`);
            toast(`${partes.join(' y ')} sincronizada${partes.length > 1 || r.visitas.enviadas > 1 ? 's' : ''}.`, { estado: 'completa' });
        }
    } catch (error) {
        // `sincronizarTodo` ya aísla cada etapa; llegar aquí es algo más grave (red caída de
        // golpe, sesión inválida). Mismo backoff que arriba, nunca un apagado definitivo.
        console.error('Error al sincronizar:', error);
        fallosSeguidos++;
        ultimoCicloFallo = true;
        pintarSync('is-error', 'Error');
        programarReintentoBackoff();
        if (manual || reintentoPorConexion) {
            toast(`No se pudo sincronizar: ${error.message}`, { estado: 'sin-registrar', ms: 8000 });
        }
    } finally {
        sincronizando = false;
        refrescarTodo();
        estadoSyncEnReposo();

        // Con lo propio ya subido (o al menos intentado), se vuelve a bajar el espejo: así lo
        // que otro dispositivo acaba de sincronizar aparece aquí sin esperar a recargar la
        // página. Va en `finally`, no solo en el camino feliz: antes, si `sincronizarTodo`
        // lanzaba, la bajada nunca ocurría y ese ciclo dejaba al dispositivo sin ver nada de
        // lo que el equipo hizo mientras tanto — la causa más probable de "lo que capturo en
        // la compu no se ve en el celular".
        bajarDelEspejo();

        // Ver comentario en `alGuardarVisitas`: un guardado que llegó a media subida no se
        // queda esperando el próximo disparador — se relanza un ciclo nuevo de inmediato.
        if (cambioPendienteMientrasSincroniza) {
            cambioPendienteMientrasSincroniza = false;
            sincronizar();
        }
    }
}

// ---------- catálogo ----------

// El catálogo cambia poco (Administración fuerza su propia descarga al guardar): no hace falta
// repetirlo en cada sincronización, foco o aviso de realtime.
const EDAD_MAXIMA_CATALOGO_MS = 30 * 60 * 1000;

async function descargarCatalogoSiSePuede() {
    if (catalogoEsFresco(EDAD_MAXIMA_CATALOGO_MS)) return;
    try {
        await descargarCatalogo();
        pintarAccesos();   // el catálogo pudo cambiar
        refrescarTodo();
        // Los temas personalizados viven en el catálogo (`js/catalogos.js`): si Administración
        // agregó o quitó uno desde otro dispositivo, el selector del header debe reflejarlo
        // sin esperar a un recargado. Ver `js/tema.js:initTema`.
        window.dispatchEvent(new CustomEvent('pdt:catalogo-actualizado'));
    } catch (err) {
        // Silencioso a propósito: el catálogo cacheado sirve, y no hay nada que el
        // educador pueda hacer al respecto en un pasillo.
        console.error('No se pudieron descargar los catálogos:', err);
    }
}

export function catalogo() {
    return leerCatalogo() || { clientes: [], sectores: [], educadores: [] };
}
