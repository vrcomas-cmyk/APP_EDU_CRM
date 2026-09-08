/**
 * Selector de tema: Claro / Oscuro / DEGASA, más los que un administrador haya creado.
 *
 * El valor real ya se aplicó antes del primer paint (script bloqueante en index.html); esto
 * pinta los botones —ahora una lista dinámica, no tres fijos— y escucha los clics. Sin sesión
 * de por medio: es una preferencia del dispositivo, no de la cuenta.
 *
 * Los 3 temas base siguen siendo bloques CSS estáticos (`style.css`, `:root[data-theme="…"]`)
 * — cero cambio de comportamiento para ellos. Uno PERSONALIZADO no tiene bloque propio: sus
 * variables se calculan en caliente (`derivarTema`, `color.ts`) y se inyectan sobre `:root`
 * como custom properties inline, que ganan a cualquier regla de la hoja de estilos.
 */

import { temas as temasPersonalizados } from './catalogos.js';
import { derivarTema, VARIABLES_DE_TEMA } from '../src/modules/administracion/services/color';

const CLAVE = 'pdt_tema';
// Cache del tema PERSONALIZADO activo, ya derivado — es lo que el script anti-flash de
// `index.html` lee sin red y sin montar nada de la app, para no parpadear al recargar.
const CLAVE_CUSTOM = 'pdt_tema_custom';

const BASE = ['light', 'dark', 'degasa'];
const COLOR_BARRA_BASE = { light: '#F5F8F7', dark: '#0D1112', degasa: '#F7F9F1' };
const NOMBRE_BASE = { light: 'Claro', dark: 'Oscuro', degasa: 'DEGASA' };
const SWATCH_BASE = { light: 'tema-swatch-claro', dark: 'tema-swatch-oscuro', degasa: 'tema-swatch-degasa' };

function temaPersonalizadoPorClave(clave) {
    return temasPersonalizados().find(t => t.clave === clave) || null;
}

function temasDisponibles() {
    return [...BASE, ...temasPersonalizados().map(t => t.clave)];
}

export function temaActual() {
    const guardado = localStorage.getItem(CLAVE);
    return temasDisponibles().includes(guardado) ? guardado : null;
}

function limpiarVariables() {
    for (const v of VARIABLES_DE_TEMA) document.documentElement.style.removeProperty(v);
}

function colorDeBarraDeTema(clave) {
    if (BASE.includes(clave)) return COLOR_BARRA_BASE[clave];
    const personalizado = temaPersonalizadoPorClave(clave);
    return personalizado ? derivarTema(personalizado)['--paper'] : '';
}

/**
 * Aplica un tema (base o personalizado) o, sin argumento, vuelve a seguir al sistema.
 *
 * Siempre limpia las variables inline primero: si no, un tema personalizado oscuro seguido de
 * "Claro" dejaría `--paper` oscuro pegado encima del bloque claro de `style.css`, y la app se
 * vería a medias de cada uno.
 */
export function aplicarTema(tema) {
    limpiarVariables();

    if (!tema) {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem(CLAVE);
        localStorage.removeItem(CLAVE_CUSTOM);
    } else if (BASE.includes(tema)) {
        document.documentElement.dataset.theme = tema;
        localStorage.setItem(CLAVE, tema);
        localStorage.removeItem(CLAVE_CUSTOM);
    } else {
        const personalizado = temaPersonalizadoPorClave(tema);
        // Clave que ya no existe (se borró desde Administración en otro dispositivo): no hay
        // nada honesto que aplicar. Mejor quedarse en el tema anterior que romper el pintado.
        if (!personalizado) return;

        const variables = derivarTema(personalizado);
        document.documentElement.dataset.theme = 'custom';
        for (const [prop, valor] of Object.entries(variables)) {
            document.documentElement.style.setProperty(prop, valor);
        }
        localStorage.setItem(CLAVE, tema);
        localStorage.setItem(CLAVE_CUSTOM, JSON.stringify({ clave: tema, variables }));
    }

    const metaColor = document.getElementById('meta-tema-elegido');
    if (metaColor) metaColor.setAttribute('content', tema ? colorDeBarraDeTema(tema) : '');
}

/**
 * Devuelve el color que la barra de estado del móvil debería llevar, considerando el tema
 * ELEGIDO (manual) si lo hay, y si no, el que el SO está pidiendo ahora mismo
 * (`prefers-color-scheme`). La distinción importa: el tema manual siempre gana, pero la
 * barra de estado del móvil cuando NO hay tema manual debe seguir al SO en vivo — anda
 * cambiando de claro a oscuro según la hora del día en iOS, y antes dejábamos el `theme-color`
 * congelado en el de arranque.
 */
function colorDeBarraActivo() {
    const elegido = temaActual();
    if (elegido) return colorDeBarraDeTema(elegido);
    const oscuro = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return oscuro ? COLOR_BARRA_BASE.dark : COLOR_BARRA_BASE.light;
}

function sincronizarBarraMovil() {
    const metaColor = document.getElementById('meta-tema-elegido');
    if (!metaColor) return;
    // Si hay tema elegido a mano el `aplicarTema` ya lo escribió — este es para el caso
    // "el usuario nunca tocó el switch, el SO cambió solo": reescribimos el meta con el color
    // que corresponde ahora. No tiene sentido fiarlo del arranque y olvidarse.
    if (!temaActual()) metaColor.setAttribute('content', colorDeBarraActivo());
}

/**
 * Pinta los botones del selector — ya no son markup fijo en `index.html`: la lista depende de
 * cuántos temas personalizados haya, así que se construye aquí cada vez que `initTema` corre
 * (al arrancar, y otra vez si el catálogo cambia — ver `reconstruir` más abajo).
 */
function construirBoton(clave, nombre) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.dataset.tema = clave;
    boton.setAttribute('aria-pressed', 'false');
    boton.setAttribute('aria-label', nombre);
    boton.title = nombre;

    const swatch = document.createElement('span');
    swatch.className = 'tema-swatch';
    if (BASE.includes(clave)) {
        swatch.classList.add(SWATCH_BASE[clave]);
    } else {
        const personalizado = temaPersonalizadoPorClave(clave);
        if (personalizado) {
            const variables = derivarTema(personalizado);
            swatch.style.background = variables['--paper'];
            swatch.style.borderColor = variables['--ink'];
        }
    }
    boton.appendChild(swatch);
    return boton;
}

export function initTema(host) {
    if (!host) return;

    const pintar = () => {
        const activo = temaActual() || 'light';
        host.querySelectorAll('button[data-tema]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.tema === activo));
        });
    };

    const reconstruir = () => {
        host.innerHTML = '';
        const lista = [
            ...BASE.map(clave => ({ clave, nombre: NOMBRE_BASE[clave] })),
            ...temasPersonalizados().map(t => ({ clave: t.clave, nombre: t.nombre }))
        ];
        for (const { clave, nombre } of lista) {
            const boton = construirBoton(clave, nombre);
            boton.addEventListener('click', () => { aplicarTema(clave); pintar(); });
            host.appendChild(boton);
        }
        pintar();
    };

    // Cuando el SO cambia de claro a oscuro (o viceversa) en vivo, sincronizar la barra de
    // estado del móvil SI Y SOLO SI el usuario no tiene tema manual elegido: con un tema
    // manual activo queremos marca fija, no seguimiento del SO.
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const alCambiar = () => sincronizarBarraMovil();
        // addListener/removeListener son la API web legacy compatible; addEventListener
        // también existe hoy en todos los navegadores objetivo.
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', alCambiar);
        else if (typeof mq.addListener === 'function') mq.addListener(alCambiar);
    }

    reconstruir();
    sincronizarBarraMovil();

    // Si Administración guarda un tema nuevo mientras la app está abierta, el selector debe
    // verlo sin recargar — mismo evento que ya usa el resto de la app para "el catálogo
    // cambió" (ver `js/app.js`, se dispara tras `descargarCatalogo()`).
    window.addEventListener('pdt:catalogo-actualizado', reconstruir);
}
