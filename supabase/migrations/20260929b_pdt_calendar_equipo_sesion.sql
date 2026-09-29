-- Compromisos de Calendar del equipo, leídos DIRECTO desde la PWA con el token de sesión (mismo
-- patrón que pdt_pendientes_equipo_sesion / pdt_visitas_equipo_sesion). Antes pasaban por Apps
-- Script, que tarda >12 s en arrancar y hacía que la lectura agotara el tiempo (o devolviera 404
-- de script.googleusercontent.com) en cada carga de la agenda.
--
-- VOLATILE a propósito: pdt_correo_de_sesion() hace UPDATE de `ultimo_uso`.
create or replace function pdt_calendar_compromisos_equipo_sesion(
    p_sesion_token text, p_desde timestamptz, p_hasta timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    return pdt_calendar_compromisos_en_alcance(v_correo, p_desde, p_hasta, pdt_es_admin(v_correo));
end;
$$;

revoke execute on function pdt_calendar_compromisos_equipo_sesion(text, timestamptz, timestamptz) from public;
grant execute on function pdt_calendar_compromisos_equipo_sesion(text, timestamptz, timestamptz)
    to anon, authenticated, service_role;
