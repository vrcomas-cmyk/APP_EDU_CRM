/**
 * @vitest-environment happy-dom
 *
 * El calendario, renderizado.
 *
 * Incluye los gestos de puntero, que es donde vivía el bug del borde inferior. happy-dom no
 * hace layout —todos los rectángulos miden cero— así que las posiciones se inyectan a mano
 * con un doble de `getBoundingClientRect`. Eso limita lo que se puede afirmar: estas pruebas
 * verifican la LÓGICA del gesto, no que el fantasma se dibuje en el píxel correcto.
 */

import { test, describe, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { Calendario } from '@modules/agenda/components/Calendario';
import { FilaAgenda } from '@modules/agenda/components/AgendaMovil';
import type { Visita } from '@core/tipos';

import { guardarVisitas } from '../js/storage.js';
import { olvidarPerfil } from '../js/permisos.js';

const nada = () => {};

function montar(props: Partial<React.ComponentProps<typeof Calendario>> = {}) {
    return render(
        <Calendario
            version={props.version ?? 1}
            onAbrirVisita={props.onAbrirVisita ?? nada}
            onCrearEn={props.onCrearEn ?? nada}
            onCambio={props.onCambio ?? nada}
            avisar={props.avisar ?? nada}
            controles={props.controles}
        />
    );
}

/** Hoy, para que las visitas caigan en el día que el calendario muestra al abrirse. */
function hoyISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const visita = (campos: Partial<Visita> = {}): Visita => ({
    id: `v-${Math.random().toString(36).slice(2)}`,
    educador: 'Ana López',
    educador_correo: 'ana@x.com',
    cliente: 'Cliente Uno',
    hospital: 'Hospital General',
    dia: hoyISO(),
    hora_inicio: '09:00',
    hora_fin: '11:00',
    estado: 'programada',
    reagendas: [],
    sectores: [],
    sincronizado: true,
    ...campos
});

/** happy-dom no hace layout: sin esto toda columna mide 0 y `yAHora` no puede calcular nada. */
function darleTamañoALasColumnas(top = 0, height = 1200) {
    for (const col of document.querySelectorAll('.col')) {
        col.getBoundingClientRect = () => ({
            top, height, left: 0, right: 200, bottom: top + height, width: 200, x: 0, y: top,
            toJSON: () => ({})
        }) as DOMRect;
    }
}

function arrastrar(desde: number, hasta: number) {
    const col = document.querySelector('.col')!;
    fireEvent.pointerDown(col, { button: 0, clientY: desde, clientX: 0 });
    fireEvent.pointerMove(document, { clientY: hasta, clientX: 0 });
    fireEvent.pointerUp(document, { clientY: hasta, clientX: 0 });
}

beforeEach(() => {
    localStorage.clear();
    // `perfilActual()` cachea el perfil en un singleton de módulo: sin esto, un test que fijó
    // `pdt_perfil_cache` (equipo a cargo) dejaría ese alcance filtrado para todos los que
    // corran después en el mismo archivo, aunque su propio `localStorage.clear()` no lo toque.
    olvidarPerfil();

    // El calendario ahora lee `consultarVisitas()` (propias + equipo por jerarquía), igual que
    // "Mi día": sin sesión, `alcance()` queda vacío y ninguna visita con correo pasa el filtro
    // de `visiblePara`. Se fija una sesión que coincide con `educador_correo` de las visitas
    // de prueba para que el perfil de respaldo (`permisos.js`) resuelva alcance = [ese correo].
    localStorage.setItem('sesion', JSON.stringify({ correo: 'ana@x.com', nombre: 'Ana López', id_token: 'x' }));

    // El reloj se fija a media mañana, y no es un capricho: la ventana de la rejilla se
    // estira para que quepa la línea de "ahora", así que a las 19:30 la rejilla llega hasta
    // las 20:00 y cambian los píxeles por hora. Sin fijar la hora, estas pruebas darían
    // resultados distintos según cuándo se corran — que es peor que fallar.
    //
    // Solo se falsea `Date`: falsear los temporizadores interferiría con la planificación
    // interna de React.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 15, 10, 0, 0));

    // El ancho de happy-dom por defecto es de escritorio; se fija para no depender de eso.
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('vista de día', () => {
    test('dibuja el eje de horas de la jornada', () => {
        guardarVisitas([]);
        montar();

        const horas = [...document.querySelectorAll('.axis .t')].map(t => t.textContent);
        assert.deepEqual(horas.slice(0, 3), ['07:00', '08:00', '09:00']);
        assert.equal(horas.length, 12, 'de 07:00 a 19:00');
    });

    test('la ventana se estira para que quepa una visita temprana', () => {
        guardarVisitas([visita({ hora_inicio: '06:00', hora_fin: '07:00' })]);
        montar();

        const primera = document.querySelector('.axis .t')!.textContent;
        assert.equal(primera, '06:00',
            'una visita fuera del lienzo no se vería: se daría por perdida');
    });

    test('pinta la visita con su cliente y hospital', () => {
        guardarVisitas([visita()]);
        montar();

        const tarjeta = document.querySelector('.ev')!;
        assert.match(tarjeta.textContent!, /Cliente Uno/);
        assert.match(tarjeta.textContent!, /Hospital General/);
    });

    test('la posiciona y la escala por su duración real', () => {
        guardarVisitas([visita({ hora_inicio: '09:00', hora_fin: '11:00' })]);
        montar();

        const estilo = document.querySelector<HTMLElement>('.ev')!.style;
        assert.equal(estilo.getPropertyValue('--s'), '2.000', '09:00 son dos horas tras las 07:00');
        assert.equal(estilo.getPropertyValue('--dur'), '2.000');
    });

    test('un BORRADOR no ocupa hueco en la agenda', () => {
        guardarVisitas([visita({ borrador: true })]);
        montar();

        assert.equal(document.querySelector('.ev'), null,
            'planear alrededor de algo que puede terminar descartado');
    });

    test('una visita corta se marca compacta', () => {
        guardarVisitas([visita({ hora_inicio: '09:00', hora_fin: '09:30' })]);
        montar();

        assert.ok(document.querySelector('.ev')!.classList.contains('compacta'),
            'forzar el texto completo lo cortaría a la mitad');
    });

    test('la que está en proceso late: es lo único que pasa AHORA', () => {
        guardarVisitas([visita({ estado: 'en-proceso', check_in: { momento: new Date().toISOString() } })]);
        montar();

        assert.ok(document.querySelector('.ev')!.classList.contains('es-viva'));
    });

    test('lo que no ha subido lo dice', () => {
        guardarVisitas([visita({ sincronizado: false })]);
        montar();

        assert.match(document.querySelector('.ev')!.textContent!, /En cola/,
            'si el teléfono se pierde, ese trabajo no está en ninguna otra parte');
    });
});

describe('qué se puede arrastrar', () => {
    test('una visita normal tiene manija de redimensión', () => {
        guardarVisitas([visita()]);
        montar();
        assert.ok(document.querySelector('.ev-resize'));
    });

    test('una CANCELADA no se arrastra: solo se abre', () => {
        guardarVisitas([visita({ estado: 'cancelada' })]);
        montar();

        assert.equal(document.querySelector('.ev-resize'), null,
            'ofrecer el gesto sería prometer algo que el guardado va a rechazar');
    });

    test('una ya finalizada tampoco', () => {
        guardarVisitas([visita({
            estado: 'finalizada',
            check_in: { momento: '2026-07-15T09:00:00.000Z' },
            check_out: { momento: '2026-07-15T11:00:00.000Z' }
        })]);
        montar();

        assert.equal(document.querySelector('.ev-resize'), null);
    });

    test('hacer clic en una cancelada la abre', () => {
        const v = visita({ estado: 'cancelada' });
        guardarVisitas([v]);

        let abierta: string | null = null;
        montar({ onAbrirVisita: (id) => { abierta = id; } });

        fireEvent.click(document.querySelector('.ev')!);
        assert.equal(abierta, v.id);
    });
});

describe('crear arrastrando', () => {
    beforeEach(() => guardarVisitas([]));

    test('un clic seco crea sin decidir la duración', () => {
        const creadas: Array<[string, string, string | null]> = [];
        montar({ onCrearEn: (d, i, f) => creadas.push([d, i, f]) });
        darleTamañoALasColumnas();

        const col = document.querySelector('.col')!;
        fireEvent.pointerDown(col, { button: 0, clientY: 200, clientX: 0 });
        fireEvent.pointerUp(document, { clientY: 200, clientX: 0 });

        assert.equal(creadas.length, 1);
        assert.equal(creadas[0]![2], null, 'la duración la decide el formulario');
    });

    test('arrastrar crea con la duración del gesto', () => {
        const creadas: Array<[string, string, string | null]> = [];
        montar({ onCrearEn: (d, i, f) => creadas.push([d, i, f]) });
        darleTamañoALasColumnas();

        // 1200px / 12h = 100px por hora. 200px → 09:00, 400px → 11:00.
        arrastrar(200, 400);

        assert.equal(creadas.length, 1);
        assert.equal(creadas[0]![1], '09:00');
        assert.equal(creadas[0]![2], '11:00');
    });

    test('arrastrar hacia ARRIBA funciona igual', () => {
        const creadas: Array<[string, string, string | null]> = [];
        montar({ onCrearEn: (d, i, f) => creadas.push([d, i, f]) });
        darleTamañoALasColumnas();

        arrastrar(400, 200);

        assert.equal(creadas[0]![1], '09:00');
        assert.equal(creadas[0]![2], '11:00');
    });

    test('REGRESIÓN: contra el borde inferior el rango no sale invertido', () => {
        // El calendario anterior devolvía aquí inicio 18:30 y fin 18:00. La visita nacía con
        // la hora de término antes que la de inicio, y el formulario la dejaba guardar.
        const creadas: Array<[string, string, string | null]> = [];
        montar({ onCrearEn: (d, i, f) => creadas.push([d, i, f]) });
        darleTamañoALasColumnas();

        arrastrar(1150, 1200);   // 18:30 → 19:00

        const [, inicio, fin] = creadas[0]!;
        assert.ok(fin! > inicio, `rango invertido: ${inicio}–${fin}`);
    });

    test('arrastrar sobre una tarjeta NO crea una visita nueva', () => {
        guardarVisitas([visita()]);
        const creadas: unknown[] = [];
        montar({ onCrearEn: () => creadas.push(1) });
        darleTamañoALasColumnas();

        const tarjeta = document.querySelector('.ev')!;
        fireEvent.pointerDown(tarjeta, { button: 0, clientY: 200, clientX: 0 });
        fireEvent.pointerUp(document, { clientY: 200, clientX: 0 });

        assert.deepEqual(creadas, [], 'ahí manda el gesto de la tarjeta');
    });

    test('el botón secundario no crea nada', () => {
        const creadas: unknown[] = [];
        montar({ onCrearEn: () => creadas.push(1) });
        darleTamañoALasColumnas();

        const col = document.querySelector('.col')!;
        fireEvent.pointerDown(col, { button: 2, clientY: 200, clientX: 0 });
        fireEvent.pointerUp(document, { clientY: 200, clientX: 0 });

        assert.deepEqual(creadas, []);
    });
});

describe('mover una visita', () => {
    test('soltarla donde estaba NO pide motivo', () => {
        guardarVisitas([visita()]);
        const preguntas: string[] = [];
        vi.stubGlobal('prompt', (p: string) => { preguntas.push(p); return 'motivo'; });

        montar();
        darleTamañoALasColumnas();

        const tarjeta = document.querySelector('.ev')!;
        fireEvent.pointerDown(tarjeta, { button: 0, clientY: 200, clientX: 0 });
        fireEvent.pointerUp(document, { clientY: 200, clientX: 0 });

        assert.deepEqual(preguntas, [], 'no moverla no es reagendar: no debe dejar rastro');
        vi.unstubAllGlobals();
    });

    test('un clic sin arrastre abre la visita', () => {
        const v = visita();
        guardarVisitas([v]);

        let abierta: string | null = null;
        montar({ onAbrirVisita: (id) => { abierta = id; } });
        darleTamañoALasColumnas();

        const tarjeta = document.querySelector('.ev')!;
        fireEvent.pointerDown(tarjeta, { button: 0, clientY: 200, clientX: 0 });
        fireEvent.pointerUp(document, { clientY: 201, clientX: 0 });

        assert.equal(abierta, v.id, 'un píxel de temblor no convierte un clic en arrastre');
    });
});

describe('vista de mes', () => {
    function montarEnMes() {
        const modos = document.createElement('div');
        modos.id = 'cal-modo';
        for (const m of ['dia', 'semana', 'mes']) {
            const b = document.createElement('button');
            b.dataset.modo = m;
            modos.appendChild(b);
        }
        document.body.appendChild(modos);

        const r = montar({
            controles: { datenav: null, titulo: null, anterior: null, siguiente: null, hoy: null, modos }
        });

        fireEvent.click(modos.querySelector('[data-modo="mes"]')!);
        return r;
    }

    test('tira el eje de horas', () => {
        guardarVisitas([visita()]);
        montarEnMes();

        assert.ok(document.querySelector('.mes'));
        assert.equal(document.querySelector('.axis'), null,
            'a esta escala la pregunta es "¿dónde hay hueco?", no "¿a qué hora?"');
    });

    test('muestra la visita como línea con su hora y cliente', () => {
        guardarVisitas([visita()]);
        montarEnMes();

        const linea = document.querySelector('.mes-ev')!;
        assert.match(linea.textContent!, /09:00/);
        assert.match(linea.textContent!, /Cliente Uno/);
    });

    test('con más de tres visitas resume el resto', () => {
        guardarVisitas([visita(), visita(), visita(), visita(), visita()]);
        montarEnMes();

        assert.match(document.querySelector('.mes-more')!.textContent!, /\+2 más/,
            'una celda que intenta mostrarlo todo no muestra nada');
    });

    test('una visita del equipo lleva la clase es-equipo y el nombre en el título', () => {
        // Sin esto, `visiblePara` (alcance = solo el propio correo) ni siquiera dejaría ver la
        // visita de Luis: el escenario a probar es justo el de un gerente con equipo a cargo.
        // `olvidarPerfil()` es necesario porque `perfilActual()` cachea el perfil en un
        // singleton de módulo la primera vez que se pide en el archivo — sin limpiarlo, fijar
        // la caché de localStorage aquí no tiene ningún efecto.
        olvidarPerfil();
        localStorage.setItem('pdt_perfil_cache', JSON.stringify({
            correo: 'ana@x.com', nombre: 'Ana López', rol: 'gerente', es_admin: false,
            permisos: ['visitas.consultar'], alcance: ['ana@x.com', 'luis@x.com'],
            invitado: true, origen: 'prueba'
        }));
        guardarVisitas([visita({ educador: 'Luis Mora', educador_correo: 'luis@x.com' })]);
        montarEnMes();

        const linea = document.querySelector('.mes-ev')!;
        assert.ok(linea.classList.contains('es-equipo'));
        assert.match(linea.getAttribute('title') || '', /Luis Mora/);
    });

    test('la visita propia no lleva la marca de equipo', () => {
        guardarVisitas([visita()]);
        montarEnMes();

        assert.ok(!document.querySelector('.mes-ev')!.classList.contains('es-equipo'));
    });
});

describe('móvil', () => {
    beforeEach(() => {
        Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    });

    test('no encoge la rejilla: cambia a agenda vertical', () => {
        guardarVisitas([visita()]);
        montar();

        assert.equal(document.querySelector('.grid'), null,
            'siete columnas con eje de horas son ilegibles en 390px');
        assert.ok(document.querySelector('.agenda-list'));
        assert.ok(document.querySelector('.wkstrip'));
    });

    test('la fila muestra horario, cliente y estado', () => {
        guardarVisitas([visita()]);
        montar();

        const fila = document.querySelector('.arow')!;
        assert.match(fila.textContent!, /09:00/);
        assert.match(fila.textContent!, /Cliente Uno/);
    });

    test('un día sin visitas lo dice, en vez de quedarse en blanco', () => {
        guardarVisitas([]);
        montar();

        assert.match(document.querySelector('.empty')!.textContent!, /Día libre/);
    });

    test('tocar una fila abre la visita', () => {
        const v = visita();
        guardarVisitas([v]);

        let abierta: string | null = null;
        montar({ onAbrirVisita: (id) => { abierta = id; } });

        fireEvent.click(document.querySelector('.arow')!);
        assert.equal(abierta, v.id);
    });

    test('la tira de semana resume la carga con puntos', () => {
        guardarVisitas([visita(), visita()]);
        montar();

        const puntos = document.querySelectorAll('.wkstrip .carga i');
        assert.equal(puntos.length, 2, 'la semana se lee sin abrirla');
    });
});

describe('visitas del equipo se distinguen de las propias', () => {
    // Se prueba la fila directamente: en el flujo completo, una visita ajena solo llega vía el
    // espejo de Supabase (alcance jerárquico), que aquí no existe. El criterio que importa
    // —correo distinto al de la sesión ⇒ marca de equipo con el nombre— vive en el componente.
    test('la visita de alguien a mi cargo lleva su nombre y la clase es-equipo', () => {
        render(<FilaAgenda
            visita={visita({ educador: 'Luis Mora', educador_correo: 'luis@x.com' })}
            onAbrir={nada}
        />);

        const fila = document.querySelector('.arow')!;
        assert.ok(fila.classList.contains('es-equipo'));
        assert.match(fila.querySelector('.arow-educador')!.textContent!, /Luis Mora/);
    });

    test('la visita propia NO lleva marca: etiquetar lo mío sería ruido', () => {
        render(<FilaAgenda visita={visita()} onAbrir={nada} />);

        const fila = document.querySelector('.arow')!;
        assert.ok(!fila.classList.contains('es-equipo'));
        assert.equal(fila.querySelector('.arow-educador'), null);
    });
});

describe('accesibilidad del color', () => {
    test('el estado nunca va solo en color: lleva punto y texto', () => {
        guardarVisitas([visita({ hora_inicio: '09:00', hora_fin: '11:00' })]);
        montar();

        const banderas = document.querySelector('.ev-flags')!;
        assert.ok(banderas.querySelector('.dot'), 'la forma distingue lo que el color no');
        assert.ok(banderas.querySelector('.pill')!.textContent);
    });

    test('sin check-in el punto va HUECO', () => {
        guardarVisitas([visita({ hora_inicio: '09:00', hora_fin: '11:00' })]);
        montar();

        assert.ok(document.querySelector('.ev-flags .dot')!.classList.contains('hollow'),
            'relleno = ya ocurrió algo; hueco = todavía no');
    });
});
