/**
 * @vitest-environment happy-dom
 *
 * Smoke tests del riel de navegación.
 *
 * No re-prueban el dominio (permisos, conteos) — para eso hay suites dedicadas. Aquí se
 * valida lo que SÓLO se puede ver montando el componente:
 *   - que el activo lleva `aria-current="page"` y los demás NO (regresión de a11y)
 *   - que el `<Icono>` se monta para cada módulo visible (regresión del set lineal)
 *   - que la insignia "no cargado" pinta el badge pulsante en vez del número engañoso 0
 *   - que el sprite de iconos se inyecta una sola vez (no clonado)
 *
 * Mockeamos `modulosDisponibles` directamente: la navegación REAL depende de `puede()` y
 * `esAdministrador()` contra almacenamiento y sesión, que no es lo que se prueba aquí.
 * Lo que importa es el OUTPUT del componente bajo una lista controlada.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { cleanup, render } from '@testing-library/react';

// Tiene que ir ANTES de importar el componente. Vitest eleva los `vi.mock` por encima de
// los imports estáticos, así que el módulo que termina cargando `Navegacion` es el stubbed.
vi.mock('../src/app/navegacion/modulos', async (importOriginal) => {
    const real = await importOriginal<typeof import('../src/app/navegacion/modulos')>();
    return {
        ...real,
        modulosDisponibles: vi.fn()
    };
});

import { Navegacion } from '../src/app/navegacion/Navegacion';
import { modulosDisponibles, type Modulo } from '../src/app/navegacion/modulos';

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

const MODULOS_FIJOS: Modulo[] = [
    { clave: 'calendario', nombre: 'Calendario', corto: 'Agenda', icono: 'calendario', disponible: () => true, contexto: true },
    { clave: 'revision', nombre: 'Revisión', corto: 'Revisar', icono: 'revision', disponible: () => true,
      insignia: () => 3 },
    { clave: 'dashboard', nombre: 'Indicadores', corto: 'Datos', icono: 'dashboard', disponible: () => true }
];

const CAL = MODULOS_FIJOS[0]!;
const REV = MODULOS_FIJOS[1]!;

/** Override de `insignia` manteniendo el resto del módulo — y tipo `Modulo` intacto. */
const conInsignia = (m: Modulo, fn: () => number | undefined): Modulo =>
    ({ ...m, insignia: fn });

describe('el riel', () => {
    beforeEach(() => {
        vi.mocked(modulosDisponibles).mockReturnValue(MODULOS_FIJOS);
    });

    test('el módulo activo lleva aria-current="page" y los demás no', () => {
        render(<Navegacion activo="revision" onElegir={() => {}} />);

        const items = [...document.querySelectorAll('.nav-item')];
        const activo = items.find(b => b.querySelector('.nav-txt')!.textContent === 'Revisión')!;
        const inactivos = items.filter(b => !b.classList.contains('is-activo'));

        assert.equal(activo.getAttribute('aria-current'), 'page');
        for (const b of inactivos) {
            assert.equal(b.getAttribute('aria-current'), null);
        }
    });

    test('cada módulo visible tiene SU icono (un <use> referenciando al symbol)', () => {
        render(<Navegacion activo="calendario" onElegir={() => {}} />);

        const usos = document.querySelectorAll('.nav-ico use');
        const refs = [...usos].map(u => u.getAttribute('href')).sort();
        // Tres módulos → tres <use>. Y las referencias son a las claves correctas.
        assert.deepEqual(refs, ['#ico-calendario', '#ico-dashboard', '#ico-revision']);
    });

    test('el sprite de iconos se inyecta UNA sola vez (no se clona por nav-item)', () => {
        render(<Navegacion activo="calendario" onElegir={() => {}} />);
        const sprites = document.querySelectorAll('svg[aria-hidden="true"] symbol');
        assert.ok(sprites.length > 0, 'hay symbols');
        const ids = new Set([...sprites].map(s => s.id));
        // Si se duplicaran los sprites, habría dos `#ico-calendario`. Verificamos unicidad.
        assert.equal(ids.size, sprites.length);
    });

    test('con un solo módulo NO dibuja el riel (no seleccionaría nada)', () => {
        vi.mocked(modulosDisponibles).mockReturnValue([CAL]);
        const { container } = render(<Navegacion activo="calendario" onElegir={() => {}} />);
        assert.equal(container.querySelector('.nav-modulos'), null);
    });

    test('la insignia numérica lleva aria-label "N pendientes"', () => {
        render(<Navegacion activo="revision" onElegir={() => {}} />);
        const badge = document.querySelector('.nav-badge')!;
        assert.equal(badge.textContent, '3');
        assert.equal(badge.getAttribute('aria-label'), '3 pendientes');
    });

    test('la insignia "no sé todavía" pinta el badge pulsante SIN aria-label engañoso', () => {
        // Como hay un solo módulo el riel no se dibuja; añadimos otro testigo.
        vi.mocked(modulosDisponibles).mockReturnValue([
            CAL,  // calendario: sin insignia
            conInsignia(REV, () => undefined)  // revisión: cargando
        ]);
        render(<Navegacion activo="revision" onElegir={() => {}} />);

        const cargando = document.querySelector('.nav-badge.is-cargando');
        assert.ok(cargando, 'un badge en estado "cargando" se reconoce por la clase');
        // Sin aria-label: "no sé cuántos" no se anuncia como "3 pendientes" (lo que
        // mentiríamos si dejáramos un n=0 con el aria-label vacío).
        assert.equal(cargando!.getAttribute('aria-label'), null);
    });

    test('un módulo SIN insignia (sin función) NO dibuja badge', () => {
        // Calendario y Dashboard: ninguno declara `insignia`. Sólo Revisión (3) debería
        // dejar un badge.
        render(<Navegacion activo="calendario" onElegir={() => {}} />);

        assert.equal(document.querySelectorAll('.nav-badge').length, 1);
    });

    test('un módulo con insignia que devuelve 0 NO dibuja badge (cero real, no cargando)', () => {
        vi.mocked(modulosDisponibles).mockReturnValue([
            CAL,
            conInsignia(REV, () => 0)
        ]);
        render(<Navegacion activo="revision" onElegir={() => {}} />);
        assert.equal(document.querySelectorAll('.nav-badge').length, 0,
            'cero real no debe pintar — sólo cuando NO se sabe pintamos el pulsante');
    });
});
