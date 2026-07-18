/**
 * Entorno de navegador mínimo para poder probar los módulos en Node.
 *
 * Se carga con `--import`, no con un `import` dentro de cada prueba, y la razón importa: en
 * ESM los `import` se elevan y se ejecutan ANTES que cualquier línea del archivo. Si el stub
 * se pusiera en la primera línea de la prueba, los módulos ya se habrían cargado sin él.
 *
 * Es un stub deliberadamente pobre. No pretende imitar un navegador: existe para que los
 * módulos de DOMINIO —los que de verdad se prueban aquí— puedan importarse sin reventar.
 * Lo que necesite un navegador de verdad no se prueba en este archivo, se prueba abriéndolo.
 */

// ---------- localStorage ----------

class AlmacenLocal {
    #datos = new Map();

    getItem(clave) {
        return this.#datos.has(String(clave)) ? this.#datos.get(String(clave)) : null;
    }
    setItem(clave, valor) { this.#datos.set(String(clave), String(valor)); }
    removeItem(clave) { this.#datos.delete(String(clave)); }
    clear() { this.#datos.clear(); }
    key(i) { return [...this.#datos.keys()][i] ?? null; }
    get length() { return this.#datos.size; }
}

globalThis.localStorage = new AlmacenLocal();

/** Deja el almacén como recién instalado. Cada prueba arranca de cero. */
export function limpiarAlmacen() {
    globalThis.localStorage.clear();
}

// ---------- DOM ----------

/**
 * Un elemento de mentira. Solo soporta lo que los módulos tocan al cargarse: crear nodos,
 * colgarles hijos y leer/escribir propiedades. No calcula estilos ni dispara eventos.
 */
function nodoFalso(etiqueta = 'div') {
    const nodo = {
        tagName: String(etiqueta).toUpperCase(),
        children: [],
        childNodes: [],
        style: {},
        dataset: {},
        classList: {
            _clases: new Set(),
            add(...c) { c.forEach(x => this._clases.add(x)); },
            remove(...c) { c.forEach(x => this._clases.delete(x)); },
            toggle(c, on) { on ? this._clases.add(c) : this._clases.delete(c); },
            contains(c) { return this._clases.has(c); }
        },
        textContent: '',
        innerHTML: '',
        value: '',
        appendChild(hijo) { this.children.push(hijo); this.childNodes.push(hijo); return hijo; },
        append(...hijos) { hijos.forEach(h => this.appendChild(h)); },
        removeChild(hijo) { this.children = this.children.filter(c => c !== hijo); return hijo; },
        remove() {},
        setAttribute() {},
        getAttribute() { return null; },
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
        closest() { return null; },
        focus() {},
        click() {},
        contains() { return false; },
        insertAdjacentHTML() {},
        get firstChild() { return this.children[0] ?? null; }
    };
    return nodo;
}

globalThis.document = {
    body: nodoFalso('body'),
    documentElement: nodoFalso('html'),
    createElement: (t) => nodoFalso(t),
    createDocumentFragment: () => nodoFalso('fragment'),
    createTextNode: (t) => ({ textContent: t }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
};

globalThis.window = globalThis;

// Node ya define `navigator`, y solo con getter: no se puede reasignar. Se le agrega `onLine`
// encima, que es lo único que la app le pide.
if (!('onLine' in globalThis.navigator)) {
    Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
}

// `fetch` real dispararía peticiones a Apps Script y Supabase desde la suite. Se apaga:
// una prueba que toca la red no es una prueba, es una dependencia de que alguien pague el
// dominio. Lo que necesite red se prueba con dobles explícitos.
globalThis.fetch = async () => {
    throw new Error('fetch está deshabilitado en las pruebas; usa un doble explícito.');
};
