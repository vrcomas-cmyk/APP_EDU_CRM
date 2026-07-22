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

    pintar();
}
