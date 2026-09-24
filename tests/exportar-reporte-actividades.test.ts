import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { libroExcelDeActividades } from '../src/modules/reporteActividades/services/exportarExcel';
import type { FilaReporteActividad } from '../src/core/tipos';

const fila: FilaReporteActividad = {
    id_visita: 'v-1', id_actividad: 'a-1', jefe_correo: 'gerencia@degasa.com', jefe: 'Gerencia',
    educador_correo: 'ana@degasa.com', educador: 'Ana', tipo: 'Capacitación', sector: 'GASAS',
    cliente: 'Hospital Uno', hospital: 'Hospital Uno', fecha: '2026-09-10', mes: '2026-09',
    hora_inicio: '09:00', hora_fin: '10:00', estado_visita: 'finalizada', area_visitada: 'Urgencias',
    contacto_nombre: 'Dra. Pérez', contacto_cargo: 'Jefa', contacto_servicio: 'Compras',
    evidencia_estado: 'subida', evidencia_url: 'https://drive.google.com/file/d/abc/view'
};

describe('exportación del reporte de actividades', () => {
    test('genera un libro que conserva toda la fila y enlaza la evidencia', async () => {
        const contenido = await libroExcelDeActividades([fila]).text();

        assert.match(contenido, /ID actividad/);
        assert.match(contenido, /Capacitación/);
        assert.match(contenido, /href="https:\/\/drive\.google\.com\/file\/d\/abc\/view"/);
        assert.match(contenido, /Link evidencia/);
    });

    test('escapa datos de captura para que no cambien la estructura del libro', async () => {
        const contenido = await libroExcelDeActividades([{ ...fila, cliente: '<script>alert(1)</script>' }]).text();

        assert.ok(!contenido.includes('<script>'));
        assert.match(contenido, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    });
});
