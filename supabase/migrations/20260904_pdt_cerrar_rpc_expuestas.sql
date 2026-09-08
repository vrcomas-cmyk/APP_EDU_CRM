-- Cierra funciones `security definer` que quedaron sin REVOKE/GRANT propio y por eso siguen
-- ejecutables por `anon`/`authenticated` vía PostgREST, con la clave anónima pública.
--
-- Confirmado con `get_advisors` (mcp Supabase, tipo `security`) contra el proyecto oficial
-- `fiplfsuhsqibzrpvjvbx` el 2026-09-04: las 8 funciones de abajo aparecen como "can be executed
-- by the anon/authenticated role as a SECURITY DEFINER function via /rest/v1/rpc/...".
--
-- Verificado ANTES de escribir esto que ninguna de las 8 se llama desde `src/` ni `js/` (grep
-- exhaustivo, cero resultados): las únicas llamadas están en `apps-script/Codigo.gs`, que usa
-- `SUPABASE_SERVICE_KEY` (`service_role`), nunca la clave anónima. Cerrarlas a `service_role`
-- no cambia ningún comportamiento de la app hoy — solo le quita el acceso a quien no debería
-- haberlo tenido nunca.
--
-- Postgres concede EXECUTE a PUBLIC por defecto a toda función nueva. El revoke tiene que
-- incluir `public` explícitamente, no solo `anon, authenticated` — ese hueco exacto ya se
-- documentó una vez en 20260826_pdt_realtime.sql:129-133 ("es justo el hueco que dejó pasar la
-- primera versión de esta migración").
--
-- `pdt_perfil(text)` NO está en esta lista a propósito: se llama DIRECTO desde el navegador con
-- la clave anónima (`js/permisos.js:115`, login normal; `js/simulacion.js:63`, "ver como" de un
-- administrador sobre OTRO correo). Revocarla aquí rompería el login de todo el mundo. Cerrarla
-- bien requiere cambiar también el código del cliente para que mande `sesion_token` en vez de
-- (o adamás de) `p_correo`, y decidir cómo debe autorizarse "ver como" sin abrir el mismo hueco
-- por otra puerta. Se deja fuera de este archivo para no mezclar un cambio de solo-SQL,
-- reversible y sin riesgo, con uno que toca el flujo de autenticación — ver la nota al final.

-- ---------- pdt_visitas_en_alcance(text, date, date, int, boolean) — con p_todas ----------
-- La firma de 4 parámetros (sin p_todas) ya está cerrada desde 20260723b_pdt_excepciones_cliente.sql.
-- Esta es una firma DISTINTA para Postgres (mismo nombre, más un parámetro) y nunca tuvo su
-- propio revoke: con p_todas=true y la clave anónima, cualquiera podía pedir TODAS las visitas
-- de la empresa sin sesión ni pertenencia jerárquica.
revoke execute on function pdt_visitas_en_alcance(text, date, date, int, boolean)
    from public, anon, authenticated;
grant execute on function pdt_visitas_en_alcance(text, date, date, int, boolean)
    to service_role;

-- ---------- espejo de escritura (Sheets → Supabase) ----------
revoke execute on function pdt_eventos_guardar(text, text, jsonb)
    from public, anon, authenticated;
grant execute on function pdt_eventos_guardar(text, text, jsonb)
    to service_role;

revoke execute on function pdt_comentarios_guardar(text, text, jsonb)
    from public, anon, authenticated;
grant execute on function pdt_comentarios_guardar(text, text, jsonb)
    to service_role;

revoke execute on function pdt_catalogos_guardar(text, jsonb)
    from public, anon, authenticated;
grant execute on function pdt_catalogos_guardar(text, jsonb)
    to service_role;

-- ---------- compromisos de Calendar del equipo ----------
revoke execute on function pdt_calendar_compromisos_guardar(text, jsonb, timestamptz, timestamptz)
    from public, anon, authenticated;
grant execute on function pdt_calendar_compromisos_guardar(text, jsonb, timestamptz, timestamptz)
    to service_role;

revoke execute on function pdt_calendar_compromisos_en_alcance(text, timestamptz, timestamptz, boolean)
    from public, anon, authenticated;
grant execute on function pdt_calendar_compromisos_en_alcance(text, timestamptz, timestamptz, boolean)
    to service_role;

-- ---------- histórico de educadores ----------
-- Estas dos SÍ tenían revoke de anon desde que nacieron (20260728f_pdt_historico_educadores.sql),
-- pero quedaron concedidas a `authenticated` con `p_correo` como parámetro libre, sin verificar
-- contra la sesión de quien llama: cualquier usuario logueado podía pedir el histórico de
-- CUALQUIER otro correo, no solo el suyo. Como tampoco se usan desde `src/`/`js/` hoy (solo
-- desde Apps Script, con service_role), cerrarlas del todo no quita nada real.
revoke execute on function pdt_historico_actividades_listar(text)
    from public, anon, authenticated;
grant execute on function pdt_historico_actividades_listar(text)
    to service_role;

revoke execute on function pdt_historico_plan_trabajo_listar(text)
    from public, anon, authenticated;
grant execute on function pdt_historico_plan_trabajo_listar(text)
    to service_role;

-- ============================================================================================
-- PENDIENTE, fuera de alcance de esta migración: pdt_perfil(text).
--
-- Hoy: `security definer`, concedida a anon+authenticated, acepta p_correo como texto libre sin
-- verificar sesión. Se llama en dos sitios reales del cliente:
--   - js/permisos.js:115   → login normal, con el propio correo de quien inició sesión.
--   - js/simulacion.js:63  → "ver como" de un ADMIN, con el correo de OTRA persona.
--
-- Arreglo correcto (requiere tocar SQL y cliente juntos, no solo SQL):
--   1. Nueva función `pdt_perfil_de_sesion(p_sesion_token text)` que resuelve el correo con el
--      mismo patrón que `pdt_correo_de_sesion` (hash contra pdt_sesiones) y devuelve el perfil
--      de ESE correo — reemplaza la llamada de permisos.js:115. Cerrada a anon+authenticated
--      igual que las demás de "sesión" (pdt_visitas_guardar_sesion, etc.), porque el secreto
--      que autoriza es el sesion_token, no el nombre de la función.
--   2. Para "ver como": una función aparte, `pdt_perfil_simulado(p_sesion_token text,
--      p_correo_objetivo text)`, que primero resuelve el correo del sesion_token, comprueba con
--      `pdt_es_admin` que ESE correo (el que de verdad inició sesión) es administrador, y solo
--      entonces devuelve el perfil de p_correo_objetivo. Así "ver como" sigue funcionando sin
--      que cualquiera con la anon key pueda pedir el perfil de cualquiera.
--   3. Retirar el grant a anon/authenticated de pdt_perfil(text) una vez que el cliente ya no
--      la llame.
-- ============================================================================================
