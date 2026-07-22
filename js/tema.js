/**
 * Selector de tema: Claro / Oscuro / DEGASA.
 *
 * El valor real ya se aplicó antes del primer paint (script bloqueante en index.html); esto
 * solo pinta qué botón quedó activo y escucha los clics. Sin sesión de por medio: es una
 * preferencia del dispositivo, no de la cuenta.
 */

const CLAVE = 'pdt_tema';
// Los valores coinciden con los selectores CSS `:root[data-theme="…"]`: 'light' y 'dark' ya
// existían (heredados del mecanismo de `prefers-color-scheme`), 'degasa' es nuevo.
const TEMAS = ['light', 'dark', 'degasa'];
const COLOR_BARRA = { light: '#F5F8F7', dark: '#0D1112', degasa: '#F7F9F1' };

export function temaActual() {
    const guardado = localStorage.getItem(CLAVE);
    return TEMAS.includes(guardado) ? guardado : null;
}

function aplicarTema(tema) {
    if (tema) {
        document.documentElement.dataset.theme = tema;
        localStorage.setItem(CLAVE, tema);
    } else {
        delete document.documentElement.dataset.theme;
        localStorage.removeItem(CLAVE);
    }

    const metaColor = document.getElementById('meta-tema-elegido');
    if (metaColor) metaColor.setAttribute('content', tema ? COLOR_BARRA[tema] : '');
}

/**
 * Devuelve el color que la barra de estado del móvil debería llevar, Considerando el tema
 * ELEGIDO (manual) si lo hay, y si no, el que el SO está pidiendo ahora mismo
 * (`prefers-color-scheme`). La distinción importa: el tema manual siempre gana, pero la
 * barra de estado del móvil cuando NO hay tema manual debe seguir al SO en vivo — anda
 * cambiando de claro a oscuro según la hora del día en iOS, y antes dejábamos el `theme-color`
 * congelado en el de arranque.
 */
function colorDeBarraActivo() {
    const elegido = temaActual();
    if (elegido) return COLOR_BARRA[elegido];
    const oscuro = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    return oscuro ? COLOR_BARRA.dark : COLOR_BARRA.light;
}

function sincronizarBarraMovil() {
    const metaColor = document.getElementById('meta-tema-elegido');
    if (!metaColor) return;
    // Si hay tema elegido a mano el `aplicarTema` ya lo escribió — este es para el caso
    // "el usuario nunca tocó el switch, el SO cambió solo": reescribimos el meta con el color
    // que corresponde ahora. No tiene sentido fiarlo del arranque y olvidarse.
    if (!temaActual()) metaColor.setAttribute('content', colorDeBarraActivo());
}

export function initTema(host) {
    if (!host) return;

    const pintar = () => {
        const activo = temaActual() || 'claro';
        host.querySelectorAll('button[data-tema]').forEach(b => {
            b.setAttribute('aria-pressed', String(b.dataset.tema === activo));
        });
    };

    host.querySelectorAll('button[data-tema]').forEach(b => {
        b.addEventListener('click', () => {
            aplicarTema(b.dataset.tema);
            pintar();
        });
    });

    // Cuando el SO cambia de claro a oscuro (o viceversa) en vivo, sincronizar la barra de
    // estado del móvil SI Y SOLO SI el usuario no tiene tema manual elegido: con switch
    // DEGASA activo queremos marca fija, no seguimiento del SO.
    if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const alCambiar = () => sincronizarBarraMovil();
        // addListener/removeListener son la API	web legacy compatible; addEventListener
        // también existe hoy en todos los navegadores objetivo.
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', alCambiar);
        else if (typeof mq.addListener === 'function') mq.addListener(alCambiar);
    }

    pintar();
    sincronizarBarraMovil();
}
