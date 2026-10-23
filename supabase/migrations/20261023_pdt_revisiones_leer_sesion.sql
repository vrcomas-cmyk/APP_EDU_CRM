-- Lectura de flujos + revisiones directo desde la PWA, con el token de sesión.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Antes la PWA leía esto por Apps Script (`leerRevisiones`), que a su vez llamaba dos RPC de
-- Supabase. Eran ~3.5-4 s en CADA ciclo de sincronización (60 s) por el salto extra. Ahora va
-- directo, igual que `pdt_visitas_equipo_sesion` y `pdt_avisos_mios_sesion`.
--
-- Misma semántica que Apps Script: flujos activos + revisiones dentro del alcance jerárquico de
-- quien tiene la sesión (`pdt_alcance`, sin la ampliación de administrador que tienen las
-- visitas), tope de 5000. La identidad la resuelve Postgres con `pdt_correo_de_sesion`: el
-- cliente nunca manda su correo. Las funciones de abajo (`pdt_flujos_activos`,
-- `pdt_revisiones_en_alcance`) no se tocan y siguen siendo solo de `service_role`; esta corre
-- como `security definer` y es la única puerta de entrada pública.

create or replace function pdt_revisiones_leer_sesion(p_sesion_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    return jsonb_build_object(
        'flujos',      pdt_flujos_activos(),
        'revisiones',  pdt_revisiones_en_alcance(v_correo, 5000)
    );
end;
$function$;

revoke execute on function pdt_revisiones_leer_sesion(text) from public;
grant  execute on function pdt_revisiones_leer_sesion(text) to anon, authenticated, service_role;
