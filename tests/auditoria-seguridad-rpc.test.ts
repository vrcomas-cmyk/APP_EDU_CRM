/**
 * Auditoría de seguridad — funciones `security definer` expuestas a PostgREST.
 *
 * En este proyecto NO hay RLS declarativa sobre las tablas de negocio (`pdt_visitas`,
 * `pdt_sectores`, `pdt_actividades`, `pdt_comentarios`, `pdt_eventos`, ...): tienen
 * `ENABLE ROW LEVEL SECURITY` sin ninguna `CREATE POLICY`, así que el acceso vía la clave
 * anónima solo pasa por funciones `security definer`. Eso es correcto SIEMPRE que cada función
 * sensible tenga su propio `REVOKE ... FROM PUBLIC, ANON, AUTHENTICATED` seguido de
 * `GRANT ... TO service_role` — Postgres concede `EXECUTE` a `PUBLIC` por defecto a toda
 * función nueva, y el propio equipo ya se topó una vez con este hueco exacto
 * (`supabase/migrations/20260826_pdt_realtime.sql`, comentario: "es justo el hueco que dejó
 * pasar la primera versión de esta migración").
 *
 * Esta prueba es estática — no toca una base de datos real — y verifica la MISMA invariante
 * que ese comentario describe, para las funciones que la escriben sin ese candado. Si falla,
 * es evidencia de una fuga real: cualquiera con la `anon key` pública (que viaja en el bundle
 * del cliente) puede invocar esa función por PostgREST sin sesión.
 */

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirMigraciones = join(raiz, 'supabase', 'migrations');

const archivosSQL = readdirSync(dirMigraciones)
    .filter(f => f.endsWith('.sql'))
    .map(f => ({ nombre: f, texto: readFileSync(join(dirMigraciones, f), 'utf8') }));

const todoElSQL = archivosSQL.map(a => a.texto).join('\n');

/** Dónde se declara `function nombre(` por primera vez, para el mensaje de error. */
function dondeSeCrea(nombre: string): string {
    for (const { nombre: archivo, texto } of archivosSQL) {
        const idx = texto.indexOf(`function ${nombre}(`);
        if (idx === -1) continue;
        const linea = texto.slice(0, idx).split('\n').length;
        return `${archivo}:${linea}`;
    }
    return '(no se encontró su CREATE FUNCTION)';
}

/**
 * Funciones `security definer` que ESCRIBEN o LEEN datos de negocio a nombre de un correo que
 * el cliente puede elegir libremente (p_correo / p_educador_correo / p_usuario_correo / p_todas
 * como parámetro), y que por lo tanto deben estar cerradas a `service_role`.
 */
const FUNCIONES_SENSIBLES = [
    'pdt_visitas_en_alcance',
    'pdt_eventos_guardar',
    'pdt_comentarios_guardar',
    'pdt_catalogos_guardar',
    'pdt_calendar_compromisos_guardar',
    'pdt_calendar_compromisos_en_alcance'
];

describe('funciones sensibles deben estar cerradas a service_role', () => {
    for (const nombre of FUNCIONES_SENSIBLES) {
        test(`${nombre} tiene REVOKE de anon/authenticated en alguna migración`, () => {
            const patronRevoke = new RegExp(
                `revoke execute on function ${nombre}\\([^)]*\\)\\s+from[^;]*\\b(public|anon|authenticated)\\b`,
                'i'
            );
            assert.ok(patronRevoke.test(todoElSQL),
                `${nombre}() se define en ${dondeSeCrea(nombre)} pero ninguna migración le quita `
                + 'EXECUTE a anon/authenticated/public. Postgres concede EXECUTE a PUBLIC por '
                + 'defecto a toda función nueva: sin este REVOKE, cualquiera con la clave anónima '
                + 'pública puede invocarla directamente por PostgREST, sin sesión ni pertenencia '
                + 'jerárquica — exactamente el hueco que ya se documentó y corrigió para otras '
                + 'funciones en 20260826_pdt_realtime.sql.');
        });
    }

    test('pdt_visitas_en_alcance de 5 parámetros (con p_todas) también debe estar cerrada', () => {
        // La firma de 4 parámetros SÍ tiene su revoke (ver 20260723b_pdt_excepciones_cliente.sql).
        // Postgres trata firmas con distinto número de parámetros como funciones DISTINTAS: el
        // revoke de la de 4 no protege a la de 5. `p_todas=true` la vuelve la más peligrosa de
        // las dos: le pide a Postgres devolver TODAS las visitas de la empresa sin filtrar por
        // alcance.
        const definicion5 = /function pdt_visitas_en_alcance\(\s*p_correo\s+text,\s*p_desde\s+date\s+default\s+null,\s*p_hasta\s+date\s+default\s+null,\s*p_limite\s+int\s+default\s+2000,\s*p_todas\s+boolean\s+default\s+false\s*\)/i;
        assert.ok(definicion5.test(todoElSQL),
            'se esperaba encontrar la firma de 5 parámetros de pdt_visitas_en_alcance (con p_todas) '
            + 'para poder verificar su candado — si ya no existe con este nombre, actualizar esta prueba.');

        const patronRevoke5 = /revoke execute on function pdt_visitas_en_alcance\(\s*text,\s*date,\s*date,\s*int,\s*boolean\s*\)/i;
        assert.ok(patronRevoke5.test(todoElSQL),
            `pdt_visitas_en_alcance(text, date, date, int, boolean) se crea en `
            + `${dondeSeCrea('pdt_visitas_en_alcance')} sin un REVOKE específico para esa firma de `
            + '5 argumentos. El REVOKE existente en 20260723b_pdt_excepciones_cliente.sql:327 solo '
            + 'cubre la firma de 4 argumentos (sin p_todas) — Postgres las trata como funciones '
            + 'distintas por su firma, así que la de 5 sigue ejecutable por anon/authenticated. '
            + 'Con p_correo arbitrario y p_todas=true, cualquiera con la clave anónima pública '
            + 'descarga TODAS las visitas de la empresa (notas, contactos, evidencias, materiales) '
            + 'sin sesión ni pertenencia jerárquica.');
    });

    test('pdt_perfil(text) debe terminar cerrada a anon/authenticated', () => {
        // Migraciones viejas (20260718b, 20260719c, 20260722, 20260723b) SÍ conceden
        // pdt_perfil(text) a anon — eso no se reescribe, es historia. Lo que importa es que
        // 20260904b_pdt_perfil_por_sesion.sql la revoque DESPUÉS: Postgres aplica el último
        // GRANT/REVOKE que corre, así que un revoke posterior sí cierra un grant anterior.
        const patronRevoke = /revoke execute on function pdt_perfil\(text\)\s+from[^;]*\b(public|anon|authenticated)\b/i;
        assert.ok(patronRevoke.test(todoElSQL),
            'pdt_perfil(text) se concedió a anon en varias migraciones (20260718b, 20260719c, '
            + '20260722, 20260723b) sin validar p_correo contra ningún sesion_token: cualquiera '
            + 'con la clave anónima pública podía pedir el rol, los permisos y el organigrama '
            + 'completo (alcance) de cualquier correo con solo adivinarlo. Se esperaba una '
            + 'migración posterior que la revoque de anon/authenticated (dejando el acceso '
            + 'directo del cliente a pdt_perfil_de_sesion/pdt_perfil_simulado, que sí resuelven '
            + 'identidad por sesion_token) — no se encontró.');
    });

    test('pdt_perfil_de_sesion y pdt_perfil_simulado existen y resuelven identidad por sesión', () => {
        assert.ok(/function pdt_perfil_de_sesion\(p_sesion_token text\)/i.test(todoElSQL),
            'falta pdt_perfil_de_sesion(p_sesion_token text): reemplazo de pdt_perfil para el '
            + 'perfil PROPIO, sin mandar el correo como parámetro libre.');
        assert.ok(/function pdt_perfil_simulado\(p_sesion_token text, p_correo_objetivo text\)/i.test(todoElSQL),
            'falta pdt_perfil_simulado(p_sesion_token text, p_correo_objetivo text): reemplazo '
            + 'para "ver como", que debe verificar que el ACTOR (resuelto por sesión) es admin '
            + 'antes de devolver el perfil de otro correo.');
        assert.ok(/pdt_es_admin\(v_correo_actor\)/i.test(todoElSQL),
            'pdt_perfil_simulado debe comprobar pdt_es_admin sobre el correo resuelto por sesión, '
            + 'no sobre un parámetro que el cliente pueda elegir.');
    });
});
