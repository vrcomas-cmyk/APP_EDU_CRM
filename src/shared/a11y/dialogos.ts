/**
 * Accesibilidad de las ventanas modales (`.modal`), en un solo sitio.
 *
 * La app tiene ~13 ventanas con el mismo marcado (`.modal > .modal-caja > .modal-head`), unas
 * montadas por React y otras por módulos vanilla. En vez de repetir en cada una el rol, la
 * trampa de foco y el regreso del foco, este módulo observa el documento y mejora cada
 * `.modal` cuando aparece:
 *
 *  - `role="dialog"` + `aria-modal="true"` (o `alertdialog` si ya lo traía), nombrado por su `<h3>`.
 *  - Foco inicial dentro de la ventana si nadie lo pidió (`autoFocus` o su propio `focus()` mandan).
 *  - Tab y Shift+Tab se quedan dentro de la ventana.
 *  - Al cerrarse, el foco vuelve al elemento que la abrió.
 *
 * NO maneja Escape: cada ventana ya lo escucha por su cuenta y cerrarla dos veces sería peor.
 */

const FOCALIZABLES = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])', 'summary', '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

let contador = 0;
let instalado = false;
/** Quién tenía el foco cuando se abrió cada ventana, para devolvérselo al cerrarla. */
const origen = new WeakMap<HTMLElement, HTMLElement | null>();

function visibles(caja: HTMLElement): HTMLElement[] {
    return Array.from(caja.querySelectorAll<HTMLElement>(FOCALIZABLES))
        .filter(el => !el.closest('[hidden]') && el.getClientRects().length > 0);
}

function nombrar(caja: HTMLElement): void {
    if (caja.hasAttribute('aria-label') || caja.hasAttribute('aria-labelledby')) return;
    const titulo = caja.querySelector<HTMLElement>('h3, h2');
    if (!titulo) return;
    if (!titulo.id) titulo.id = `dlg-titulo-${++contador}`;
    caja.setAttribute('aria-labelledby', titulo.id);
}

function mejorar(modal: HTMLElement): void {
    if (origen.has(modal)) return;

    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    origen.set(modal, previo);

    const caja = modal.querySelector<HTMLElement>(':scope > .modal-caja') ?? modal;
    if (!caja.hasAttribute('role')) caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    nombrar(caja);

    // Un frame después: deja que el propio componente enfoque su campo (autoFocus, focus()).
    requestAnimationFrame(() => {
        if (!modal.isConnected || caja.contains(document.activeElement)) return;
        const primero = visibles(caja).find(el => !el.matches('.icon-btn')) ?? visibles(caja)[0];
        (primero ?? caja).focus({ preventScroll: true });
    });

    modal.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        // Con ventanas anidadas el evento sube por todas: solo atiende la más interna.
        if (e.defaultPrevented) return;
        const items = visibles(caja);
        if (items.length === 0) { e.preventDefault(); return; }
        const primero = items[0]!;
        const ultimo = items[items.length - 1]!;
        const activo = document.activeElement;
        if (e.shiftKey && (activo === primero || !caja.contains(activo))) {
            e.preventDefault(); ultimo.focus();
        } else if (!e.shiftKey && (activo === ultimo || !caja.contains(activo))) {
            e.preventDefault(); primero.focus();
        }
    });
}

function devolverFoco(modal: HTMLElement): void {
    const previo = origen.get(modal);
    origen.delete(modal);
    if (previo && previo.isConnected) previo.focus({ preventScroll: true });
}

function recorrer(nodo: Node, accion: (m: HTMLElement) => void): void {
    if (!(nodo instanceof HTMLElement)) return;
    if (nodo.matches('.modal')) accion(nodo);
    nodo.querySelectorAll<HTMLElement>('.modal').forEach(accion);
}

/** Idempotente: llamarlo dos veces no instala dos observadores. */
export function activarAccesibilidadDeDialogos(): void {
    if (instalado || typeof document === 'undefined') return;
    instalado = true;

    document.querySelectorAll<HTMLElement>('.modal:not([hidden])').forEach(mejorar);

    // Respaldo de la trampa de Tab: el `keydown` de cada ventana solo se entera mientras el foco
    // está DENTRO de ella. Si el navegador lo saca (un elemento enfocable que la lista no
    // contempla, el clic en el fondo), este oyente global lo devuelve a la ventana de encima.
    document.addEventListener('focusin', (e) => {
        const destino = e.target;
        if (!(destino instanceof HTMLElement)) return;
        const abiertas = Array.from(document.querySelectorAll<HTMLElement>('.modal'))
            .filter(m => !m.hidden && m.getClientRects().length > 0);
        const arriba = abiertas[abiertas.length - 1];
        if (!arriba || arriba.contains(destino)) return;
        // Lo que vive por encima de las ventanas a propósito (avisos con acción, paleta de comandos).
        if (destino.closest('.toasts, .paleta-raiz, .paleta, [data-sobre-modal]')) return;
        const caja = arriba.querySelector<HTMLElement>(':scope > .modal-caja') ?? arriba;
        (visibles(caja)[0] ?? caja).focus({ preventScroll: true });
    });

    new MutationObserver((cambios) => {
        for (const c of cambios) {
            c.addedNodes.forEach(n => recorrer(n, mejorar));
            c.removedNodes.forEach(n => recorrer(n, devolverFoco));
        }
    }).observe(document.body, { childList: true, subtree: true });
}
