/**
 * Catálogos y configuración de campos.
 *
 * La promesa de este módulo es que un cambio de reglas no toque código. Lo que se prueba aquí
 * es sobre todo la RESOLUCIÓN en tres capas (default → banderas heredadas → config por campo)
 * y que una hoja vieja siga comportándose igual que antes.
 */

import { test, describe, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { limpiarAlmacen } from './entorno.js';

import {
    MODOS, CAMPOS_ACTIVIDAD, IDS_CAMPOS,
    configuracionCampos, modoCampo, campoVisible, campoObligatorio, campoEditable,
    reglaDe, requiereEvidencia, camposExtra,
    modoEnFormulario, esVisibleEn, esRequeridoEn,
    tiposActividad, origenes, unidades, sectores, sectoresDelCatalogo, sectoresOcultos,
    materialesDe, buscarMateriales, hayMateriales, gruposArticulo, gruposDeSector,
    zonasDelCatalogo, clientesDelCatalogo, clientesEnMisZonas,
    GRUPOS_ARTICULO_POR_DEFECTO,
    TIPOS_POR_DEFECTO, ORIGENES_POR_DEFECTO
} from '../js/catalogos.js';
import { olvidarPerfil } from '../js/permisos.js';
import { ordenarEs, compararEs } from '../js/orden.js';

const ponerCatalogo = (datos) => localStorage.setItem('datosPWA', JSON.stringify(datos));

/** Fija el perfil con las zonas dadas, igual que llegarían de `pdt_perfil`. */
function conZonas(zonas) {
    localStorage.setItem('sesion', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana', id_token: 'x', expira: Date.now() + 3600e3
    }));
    localStorage.setItem('pdt_perfil_cache', JSON.stringify({
        correo: 'ana@x.com', nombre: 'Ana', rol: 'educador', es_admin: false,
        permisos: [], alcance: ['ana@x.com'], zonas,
        invitado: true, origen: 'prueba'
    }));
}

beforeEach(() => {
    limpiarAlmacen();
    olvidarPerfil();
});

describe('listas — los defaults existen para el primer día', () => {
    test('sin catálogo se usan los valores por defecto', () => {
        // Mismas opciones, en orden alfabético: lo que se ofrece en un menú sale ordenado.
        assert.deepEqual(tiposActividad(), ordenarEs(TIPOS_POR_DEFECTO, t => t.nombre));
        assert.deepEqual(origenes(), ordenarEs(ORIGENES_POR_DEFECTO));
    });

    test('en cuanto la hoja trae filas, mandan ellas', () => {
        ponerCatalogo({ origenes: ['Mercadotecnia'] });
        assert.deepEqual(origenes(), ['Mercadotecnia']);
    });

    test('una lista vacía en la hoja NO deja la app sin opciones', () => {
        ponerCatalogo({ origenes: [] });
        assert.deepEqual(origenes(), ordenarEs(ORIGENES_POR_DEFECTO),
            'una hoja recién creada dejaría el formulario inservible');
    });

    test('un valor con la forma equivocada tampoco tumba la app', () => {
        ponerCatalogo({ unidades: 'Pieza, Caja' });
        assert.ok(Array.isArray(unidades()) && unidades().length > 0);
    });
});

describe('sectores — se curan, no se escriben libres', () => {
    test('los ocultos se filtran de lo que ve el educador', () => {
        ponerCatalogo({ sectores: ['GASAS', 'GUANTES', 'SUTURAS'], sectores_ocultos: ['GUANTES'] });

        assert.deepEqual(sectores(), ['GASAS', 'SUTURAS']);
        assert.deepEqual(sectoresDelCatalogo(), ['GASAS', 'GUANTES', 'SUTURAS'],
            'Administración sí debe verlos todos para poder reactivarlos');
        assert.deepEqual(sectoresOcultos(), ['GUANTES']);
    });

    test('sin ocultos se devuelven todos', () => {
        ponerCatalogo({ sectores: ['GASAS', 'GUANTES'] });
        assert.deepEqual(sectores(), ['GASAS', 'GUANTES']);
    });
});

describe('configuracionCampos — resolución en tres capas', () => {
    test('capa 1: un tipo desconocido cae en los defaults, que piden evidencia', () => {
        const config = configuracionCampos('Tipo Inventado');
        assert.equal(config.evidencia, MODOS.OBLIGATORIO_DESPUES,
            'dar por buena una actividad de tipo desconocido escondería trabajo sin soporte');
    });

    test('capa 2: las banderas viejas se siguen respetando', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', evidencia: false, materiales: true }] });

        const config = configuracionCampos('Ronda');
        assert.equal(config.evidencia, MODOS.OCULTO);
        assert.equal(config.materiales, MODOS.OBLIGATORIO);
    });

    test('capa 3: la config por campo pisa a las banderas heredadas', () => {
        ponerCatalogo({ tipos_actividad: [{
            nombre: 'Ronda',
            evidencia: false,                          // la bandera vieja dice "oculto"
            campos: { evidencia: 'opcional' }          // pero Administración lo hizo opcional
        }] });

        assert.equal(modoCampo('Ronda', 'evidencia'), MODOS.OPCIONAL);
    });

    test('un modo escrito mal en la hoja cae al valor anterior, no rompe el formulario', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', campos: { area_visitada: 'oblihatorio' } }] });
        assert.equal(modoCampo('Ronda', 'area_visitada'), MODOS.OBLIGATORIO,
            'un dedazo en una celda no debe dejar el campo en un estado indefinido');
    });

    test('el modo se normaliza: mayúsculas y espacios sobran', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', campos: { area_visitada: '  OPCIONAL ' } }] });
        assert.equal(modoCampo('Ronda', 'area_visitada'), MODOS.OPCIONAL);
    });

    test('una celda vacía no pisa: significa "no configurado"', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', evidencia: true, campos: { evidencia: '' } }] });
        assert.equal(modoCampo('Ronda', 'evidencia'), MODOS.OBLIGATORIO_DESPUES);
    });

    test('la evidencia no admite un "obligatorio" que bloquee: se lee como "después"', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', campos: { evidencia: 'obligatorio' } }] });
        assert.equal(modoCampo('Ronda', 'evidencia'), MODOS.OBLIGATORIO_DESPUES,
            'la foto se sube tras sellar: exigirla al guardar no se podría cumplir');
    });

    test('un modo que el campo no admite cae a su default', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Ronda', campos: { area_visitada: 'obligatorio-despues' } }] });
        assert.equal(modoCampo('Ronda', 'area_visitada'), MODOS.OBLIGATORIO);
    });

    test('resultado_seguimiento "obligatorio" heredado no bloquea hasta que alguien guarda con esta versión', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'Seguimiento', campos: { resultado_seguimiento: 'obligatorio' } }] });
        assert.equal(modoCampo('Seguimiento', 'resultado_seguimiento'), MODOS.OBLIGATORIO_DESPUES);

        // Con `formularios` presente ya se guardó con la versión nueva: se lee literal.
        ponerCatalogo({
            tipos_actividad: [{ nombre: 'Seguimiento', campos: { resultado_seguimiento: 'obligatorio' } }],
            formularios: { sector: { objetivo: 'opcional' } }
        });
        assert.equal(modoCampo('Seguimiento', 'resultado_seguimiento'), MODOS.OBLIGATORIO);
    });

    test('los campos del material tienen defaults que reproducen el comportamiento de antes', () => {
        const c = configuracionCampos('Capacitación');
        assert.equal(c.material_cantidad, MODOS.OBLIGATORIO);
        assert.equal(c.material_unidad, MODOS.OBLIGATORIO);
        assert.equal(c.material_origen, MODOS.OPCIONAL);
    });

    test('los campos del material no se anuncian como "lo que pide el tipo"', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: { material_origen: 'obligatorio' } }] });
        assert.ok(!camposExtra('T').some(e => e.startsWith('Material')));
    });

    test('siempre devuelve todos los campos conocidos', () => {
        const config = configuracionCampos('Capacitación');
        assert.deepEqual(Object.keys(config).sort(), [...IDS_CAMPOS].sort());
    });
});

describe('formularios de visita, sector y estrategia', () => {
    test('sin configurar rigen los defaults de siempre', () => {
        assert.equal(modoEnFormulario('sector', 'objetivo'), MODOS.OBLIGATORIO);
        assert.equal(modoEnFormulario('visita', 'hospital'), MODOS.OBLIGATORIO);
        assert.equal(modoEnFormulario('visita', 'notas'), MODOS.OPCIONAL);
        assert.equal(modoEnFormulario('estrategia', 'etapa'), MODOS.OPCIONAL);
    });

    test('lo configurado manda', () => {
        ponerCatalogo({ formularios: { sector: { objetivo: 'opcional', solicitado_por: 'oculto' } } });
        assert.equal(modoEnFormulario('sector', 'objetivo'), MODOS.OPCIONAL);
        assert.equal(esVisibleEn('sector', 'solicitado_por'), false);
        assert.equal(esRequeridoEn('sector', 'origen'), true, 'lo no tocado conserva su default');
    });

    test('un campo fijo siempre es obligatorio, diga lo que diga la hoja', () => {
        ponerCatalogo({ formularios: { visita: { fecha: 'oculto', cliente: 'opcional' } } });
        assert.equal(modoEnFormulario('visita', 'fecha'), MODOS.OBLIGATORIO);
        assert.equal(modoEnFormulario('visita', 'cliente'), MODOS.OBLIGATORIO);
    });

    test('los sectores de la visita no se pueden ocultar', () => {
        ponerCatalogo({ formularios: { visita: { sectores: 'oculto' } } });
        assert.equal(modoEnFormulario('visita', 'sectores'), MODOS.OBLIGATORIO);
        ponerCatalogo({ formularios: { visita: { sectores: 'opcional' } } });
        assert.equal(esRequeridoEn('visita', 'sectores'), false);
    });

    test('un modo mal escrito cae al default', () => {
        ponerCatalogo({ formularios: { sector: { objetivo: 'oblihatorio' } } });
        assert.equal(modoEnFormulario('sector', 'objetivo'), MODOS.OBLIGATORIO);
    });
});

describe('lecturas derivadas del modo', () => {
    beforeEach(() => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: {
            area_visitada: 'obligatorio',
            contacto_nombre: 'opcional',
            contacto_cargo: 'solo-lectura',
            materiales: 'oculto'
        } }] });
    });

    test('visible es todo lo que no está oculto', () => {
        assert.equal(campoVisible('T', 'contacto_cargo'), true, 'solo-lectura se muestra si trae valor');
        assert.equal(campoVisible('T', 'materiales'), false);
    });

    test('editable es solo obligatorio u opcional', () => {
        assert.equal(campoEditable('T', 'area_visitada'), true);
        assert.equal(campoEditable('T', 'contacto_nombre'), true);
        assert.equal(campoEditable('T', 'contacto_cargo'), false, 'solo-lectura se ve pero no se captura');
        assert.equal(campoEditable('T', 'materiales'), false);
    });

    test('obligatorio es exactamente uno de los modos', () => {
        assert.equal(campoObligatorio('T', 'area_visitada'), true);
        assert.equal(campoObligatorio('T', 'contacto_nombre'), false);
    });
});

describe('requiereEvidencia — solo lo OBLIGATORIO es deuda', () => {
    test('opcional no genera deuda', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: { evidencia: 'opcional' } }] });

        assert.equal(requiereEvidencia({ tipo: 'T' }), false,
            'una evidencia opcional que no se sube no es algo que el educador deba');
        assert.equal(reglaDe('T').evidencia, true,
            'pero sí se MUESTRA el control: visible y obligatorio son cosas distintas');
    });

    test('una actividad sin tipo cae en el default: exige evidencia', () => {
        assert.equal(requiereEvidencia({}), true);
        assert.equal(requiereEvidencia(null), true, 'el lado seguro también ante un nulo');
    });
});

describe('camposExtra — anuncia lo que el tipo va a pedir', () => {
    test('solo lista los obligatorios, con su etiqueta legible', () => {
        ponerCatalogo({ tipos_actividad: [{ nombre: 'T', campos: {
            area_visitada: 'obligatorio', contacto_nombre: 'opcional', evidencia: 'obligatorio',
            contacto_cargo: 'oculto', contacto_servicio: 'oculto'
        } }] });

        const extra = camposExtra('T');
        assert.ok(extra.includes('Área visitada'));
        assert.ok(extra.includes('Evidencia'));
        assert.ok(!extra.includes('Contacto · Nombre'), 'lo opcional no se anuncia como requisito');
    });

    test('sin tipo no anuncia nada', () => {
        assert.deepEqual(camposExtra(''), []);
    });
});

describe('materiales', () => {
    beforeEach(() => {
        ponerCatalogo({ materiales: [
            { material: 'GASA SIMPLE 10X10 CM', sector: 'GASAS' },
            { material: 'GASA DOBLADA 5X5 CM', sector: 'GASAS' },
            { material: 'COMPRESA ABDOMINAL', sector: 'GASAS' },
            { material: 'GUANTE LATEX CH', sector: 'GUANTES' }
        ] });
    });

    test('solo se ofrecen los del sector que se está registrando', () => {
        assert.equal(materialesDe('GASAS').length, 3,
            'ofrecer guantes a quien trabaja gasas es ruido que hace equivocarse');
        assert.equal(materialesDe('GUANTES').length, 1);
        assert.equal(hayMateriales('SUTURAS'), false);
    });

    test('busca por palabras sueltas y en cualquier orden', () => {
        const r = buscarMateriales('GASAS', 'gasa 10x10');
        assert.equal(r.length, 1);
        assert.equal(r[0].material, 'GASA SIMPLE 10X10 CM',
            'la cadena literal "gasa 10x10" no aparece en el nombre; aun así debe encontrarse');
    });

    test('el orden de las palabras da igual', () => {
        assert.equal(buscarMateriales('GASAS', '10x10 gasa').length, 1);
    });

    test('sin consulta devuelve la lista completa del sector', () => {
        assert.equal(buscarMateriales('GASAS', '').length, 3);
        assert.equal(buscarMateriales('GASAS', '   ').length, 3);
    });

    test('respeta el límite', () => {
        assert.equal(buscarMateriales('GASAS', 'g', 1).length, 1);
    });

    test('sin coincidencias devuelve vacío, no la lista entera', () => {
        assert.deepEqual(buscarMateriales('GASAS', 'tornillo'), []);
    });

    test('sin catálogo no revienta', () => {
        limpiarAlmacen();
        assert.deepEqual(materialesDe('GASAS'), []);
    });
});

describe('gruposDeSector — Estrategias solo ofrece lo que ese sector trabaja', () => {
    beforeEach(() => {
        ponerCatalogo({ materiales: [
            { material: 'GASA SIMPLE', sector: 'GASAS', grupo_articulo: 'Gasas' },
            { material: 'GASA DOBLADA', sector: 'GASAS', grupo_articulo: 'Cuidado de Heridas' },
            { material: 'GUANTE LATEX', sector: 'GUANTES', grupo_articulo: 'Guantes' }
        ] });
    });

    test('solo los grupos que aparecen en materiales de ese sector', () => {
        assert.deepEqual(gruposDeSector('GASAS'), ['Cuidado de Heridas', 'Gasas']);
        assert.deepEqual(gruposDeSector('GUANTES'), ['Guantes']);
    });

    test('sin sector, el catálogo completo', () => {
        assert.deepEqual(gruposDeSector(''), gruposArticulo());
    });

    test('un sector sin materiales en el catálogo cae al catálogo completo', () => {
        assert.deepEqual(gruposDeSector('SUTURAS'), gruposArticulo());
    });

    test('sin la columna grupo_articulo en ningún material, cae al catálogo completo', () => {
        ponerCatalogo({ materiales: [{ material: 'GASA SIMPLE', sector: 'GASAS' }] });
        assert.deepEqual(gruposDeSector('GASAS'), ordenarEs(GRUPOS_ARTICULO_POR_DEFECTO));
    });
});

describe('zonasDelCatalogo — el universo asignable en Administración → Territorios', () => {
    test('las zonas únicas de clientes_zona, sin repetir', () => {
        ponerCatalogo({ clientes_zona: { 'Cliente A': '001', 'Cliente B': '002', 'Cliente C': '001' } });
        assert.deepEqual(zonasDelCatalogo(), ['001', '002']);
    });

    test('sin catálogo, ninguna', () => {
        assert.deepEqual(zonasDelCatalogo(), []);
    });
});

describe('clientesEnMisZonas — la restricción de territorio', () => {
    beforeEach(() => {
        ponerCatalogo({
            clientes: ['Cliente A', 'Cliente B', 'Cliente C'],
            clientes_zona: { 'Cliente A': '001', 'Cliente B': '002', 'Cliente C': '001' }
        });
    });

    test('sin ninguna zona asignada, cae al catálogo completo', () => {
        conZonas([]);
        assert.deepEqual(clientesEnMisZonas(), clientesDelCatalogo());
    });

    test('con una zona asignada, solo los clientes de esa zona', () => {
        conZonas(['001']);
        assert.deepEqual(clientesEnMisZonas(), ['Cliente A', 'Cliente C']);
    });

    test('con varias zonas (titular + cobertura), la unión de ambas', () => {
        conZonas(['001', '002']);
        assert.deepEqual(clientesEnMisZonas(), ['Cliente A', 'Cliente B', 'Cliente C']);
    });

    test('una zona sin ningún cliente no revienta: lista vacía, no el catálogo completo', () => {
        conZonas(['999']);
        assert.deepEqual(clientesEnMisZonas(), []);
    });
});

describe('CAMPOS_ACTIVIDAD es la única fuente de qué se configura', () => {
    test('cada campo declara id, etiqueta y un modo por defecto válido', () => {
        const validos = Object.values(MODOS);
        for (const c of CAMPOS_ACTIVIDAD) {
            assert.ok(c.id, 'todo campo necesita id');
            assert.ok(c.etiqueta, `${c.id} necesita etiqueta: se dibuja en Administración`);
            assert.ok(validos.includes(c.defecto), `${c.id} tiene un modo por defecto inválido`);
        }
    });

    test('no hay ids repetidos', () => {
        assert.equal(new Set(IDS_CAMPOS).size, IDS_CAMPOS.length);
    });
});


describe('orden alfabético y numérico en español', () => {
    test('compararEs: acentos y mayúsculas no cambian el orden, los números van como números', () => {
        assert.deepEqual(ordenarEs(['Zona', 'Área', 'abril', 'Obras']), ['abril', 'Área', 'Obras', 'Zona']);
        assert.deepEqual(ordenarEs(['10', '2', '1']), ['1', '2', '10']);
        assert.equal(compararEs(undefined, 'a') < 0, true, 'un valor vacío no rompe el orden');
    });

    test('las listas del catálogo salen ordenadas aunque la hoja las traiga al azar', () => {
        ponerCatalogo({
            origenes: ['Ventas', 'BI', 'Área X'],
            unidades: ['Pieza', 'Caja', 'Bulto'],
            sectores: ['SUTURAS', 'GASAS', 'GUANTES'],
            tipos_actividad: [{ nombre: 'Seguimiento' }, { nombre: 'Capacitación' }]
        });
        assert.deepEqual(origenes(), ['Área X', 'BI', 'Ventas']);
        assert.deepEqual(unidades(), ['Bulto', 'Caja', 'Pieza']);
        assert.deepEqual(sectores(), ['GASAS', 'GUANTES', 'SUTURAS']);
        assert.deepEqual(tiposActividad().map(t => t.nombre), ['Capacitación', 'Seguimiento']);
    });

    test('los materiales salen ordenados y, con varios sectores, sin repetir', () => {
        ponerCatalogo({ materiales: [
            { material: 'GUANTE M', sector: 'GUANTES' },
            { material: 'GASA 10X10', sector: 'GASAS' },
            { material: 'GASA 10X10', sector: 'QUIROFANO' },
            { material: 'GASA 5X5', sector: 'GASAS' }
        ] });
        assert.deepEqual(materialesDe('GASAS').map(m => m.material), ['GASA 5X5', 'GASA 10X10']);
        assert.deepEqual(
            materialesDe(['GASAS', 'QUIROFANO', 'GUANTES']).map(m => m.material),
            ['GASA 5X5', 'GASA 10X10', 'GUANTE M']
        );
        assert.equal(buscarMateriales(['GASAS', 'QUIROFANO'], 'gasa 10').length, 1);
    });
});
