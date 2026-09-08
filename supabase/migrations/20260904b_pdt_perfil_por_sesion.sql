-- Cierra pdt_perfil(text) — pendiente dejado explícitamente en 20260904_pdt_cerrar_rpc_expuestas.sql.
--
-- Hasta ahora el cliente llamaba pdt_perfil(p_correo) DIRECTO con la clave anónima, mandando el
-- correo como texto libre: quien tuviera la anon key (pública, viaja en el bundle) podía pedir
-- el perfil —rol, permisos, alcance jerárquico completo— de cualquier correo de la organización
-- con solo adivinarlo. Confirmado real, no solo teórico, con `get_advisors` contra el proyecto
-- oficial.
--
-- El arreglo sigue el mismo patrón que ya usa el resto de la superficie "Supabase directo desde
-- la PWA" (pdt_visitas_guardar_sesion, pdt_visitas_equipo_sesion, pdt_canal_de_sesion): la
-- identidad no la manda el cliente, la resuelve Postgres a partir del `sesion_token` —un secreto
-- que solo su dueño tiene— contra `pdt_sesiones`, con `pdt_correo_de_sesion`.
--
-- Dos funciones nuevas porque hay dos usos legítimos y distintos de "pedir un perfil":
--   1. El propio, al iniciar sesión — el correo SIEMPRE es el de quien llama.
--   2. El de otra persona, en "ver como" — pero solo si quien llama es administrador. Sin esta
--      segunda función, cerrar la primera habría dejado "ver como" sin forma de funcionar
--      (necesita leer el perfil de OTRO correo), y la tentación habría sido dejar pdt_perfil
--      abierta "nada más para eso" — exactamente el hueco que se está cerrando.

-- ---------- 1. el perfil propio, resuelto por sesión ----------
create or replace function pdt_perfil_de_sesion(p_sesion_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_correo text;
begin
    -- pdt_correo_de_sesion ya lanza 'Sesión no reconocida' (errcode 28000) si el token no
    -- resuelve: no hay nada que agregar aquí, solo dejar que suba.
    v_correo := pdt_correo_de_sesion(p_sesion_token);
    return pdt_perfil(v_correo);
end;
$$;

revoke execute on function pdt_perfil_de_sesion(text) from public;
grant execute on function pdt_perfil_de_sesion(text) to anon, authenticated;

-- ---------- 2. el perfil de OTRO correo, solo para un administrador ----------
create or replace function pdt_perfil_simulado(p_sesion_token text, p_correo_objetivo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_correo_actor text;
begin
    -- Quién pregunta sale del sesion_token, nunca de un parámetro: eso es lo que hace que la
    -- comprobación de admin de abajo no se pueda falsificar mandando cualquier correo como
    -- "actor". Lo que SÍ es un parámetro libre es a quién se quiere ver — y eso está bien,
    -- porque ya se comprobó que quien pregunta puede.
    v_correo_actor := pdt_correo_de_sesion(p_sesion_token);

    if not pdt_es_admin(v_correo_actor) then
        raise exception 'Solo un administrador puede usar "ver como".' using errcode = '42501';
    end if;

    return pdt_perfil(lower(trim(p_correo_objetivo)));
end;
$$;

revoke execute on function pdt_perfil_simulado(text, text) from public;
grant execute on function pdt_perfil_simulado(text, text) to anon, authenticated;

-- ---------- 3. cerrar la vía vieja ----------
-- Ya verificado (grep exhaustivo sobre src/ y js/, después de aplicar el cambio de cliente de
-- esta misma migración) que nada vuelve a llamar pdt_perfil(text) directo con p_correo libre.
-- Apps Script tampoco la usa (grep sobre Codigo.gs, cero resultados). Queda para uso interno
-- (la llaman las dos funciones de arriba) y por si algún día hace falta desde el backend.
revoke execute on function pdt_perfil(text) from public, anon, authenticated;
grant execute on function pdt_perfil(text) to service_role;
