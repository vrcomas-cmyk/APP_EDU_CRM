-- Subida de los compromisos de Calendar DIRECTO desde la PWA con el token de sesión (mismo patrón
-- que pdt_calendar_compromisos_equipo_sesion). Antes pasaba por Apps Script, que esperaba el
-- candado global de escrituras y su arranque en frío (>12 s) y agotaba el tiempo de la PWA:
-- "El servidor no respondió a tiempo" varias veces por minuto.
--
-- El correo sale del token de sesión, nunca del cliente: un dispositivo solo puede reemplazar SUS
-- propios compromisos. Reutiliza pdt_calendar_compromisos_guardar para no duplicar la lógica.
--
-- VOLATILE a propósito: pdt_correo_de_sesion() hace UPDATE de `ultimo_uso`.
create or replace function pdt_calendar_compromisos_guardar_sesion(
    p_sesion_token text, p_compromisos jsonb,
    p_desde timestamptz default null, p_hasta timestamptz default null
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
    return pdt_calendar_compromisos_guardar(v_correo, p_compromisos, p_desde, p_hasta);
end;
$$;

revoke execute on function pdt_calendar_compromisos_guardar_sesion(text, jsonb, timestamptz, timestamptz) from public;
grant execute on function pdt_calendar_compromisos_guardar_sesion(text, jsonb, timestamptz, timestamptz)
    to anon, authenticated, service_role;
