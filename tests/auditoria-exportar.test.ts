/**
 * REQUISITO DE NEGOCIO: "Exportar o consultar información si el permiso existe" (Analista) /
 * "Validar permisos de exportación" (Gerente).
 *
 * El permiso `visitas.exportar` SÍ existe y está asignado a Analista y Gerente
 * (`supabase/migrations/20260718_pdt_roles_permisos_jerarquia.sql`), pero no hay ningún botón,
 * función de exportación (CSV/Excel/PDF) ni siquiera un uso de `puede('visitas','exportar')`
 * en toda la interfaz. El permiso existe en la base; la funcionalidad, no.
 *
 * Prueba estática: falla mientras no exista ningún camino de exportación en `src/`.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function archivosBajo(dir: string, extensiones: string[]): string[] {
    const resultado: string[] = [];
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) resultado.push(...archivosBajo(ruta, extensiones));
        else if (extensiones.some(ext => entrada.name.endsWith(ext))) resultado.push(ruta);
    }
    return resultado;
}

const codigoFuenteUI = archivosBajo(join(raiz, 'src'), ['.tsx', '.ts'])
    .map(ruta => readFileSync(ruta, 'utf8'))
    .join('\n');

describe('exportación de datos', () => {
    test('el permiso visitas.exportar existe en la semilla de roles', () => {
        const seed = readFileSync(
            join(raiz, 'supabase', 'migrations', '20260718_pdt_roles_permisos_jerarquia.sql'), 'utf8');
        assert.ok(/'visitas',\s*'exportar'/.test(seed));
    });

    test('REQUISITO: debe existir alguna función de exportación (CSV/Excel/PDF) en la UI', () => {
        const hayExportacion = /\bcsv\b|\bxlsx\b|exportarVisitas|exportarA(CSV|Excel|PDF)|descargarReporte/i
            .test(codigoFuenteUI);

        assert.ok(hayExportacion,
            'El permiso visitas.exportar está definido y asignado a Analista y Gerente en la '
            + 'base de datos, pero no se encontró ninguna función de exportación (CSV/Excel/PDF) '
            + 'ni uso de puede(\'visitas\',\'exportar\') en src/**. Es deuda de UI: el permiso '
            + 'existe, la pantalla/botón que lo consume no.');
    });

    test('REQUISITO: gate visitas.exportar debe usarse en algún componente', () => {
        const seUsaElGate = /visitas['"],\s*['"]exportar/.test(codigoFuenteUI);
        assert.ok(seUsaElGate,
            'ningún componente consulta puede(\'visitas\',\'exportar\'): aunque se agregara un '
            + 'botón de exportar, hoy nada en el código restringiría su visibilidad por permiso.');
    });
});
