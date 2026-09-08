/*
 * `pdt_correo_de_sesion` resuelve la identidad para CASI todo RPC de la app (visitas del
 * equipo, guardar una visita, el canal de Realtime, el perfil de permisos...) y en cada
 * llamada hacía:
 *
 *     update pdt_sesiones set ultimo_uso = now() where sesion_hash = v_hash;
 *
 * Postgres toma un lock exclusivo de esa fila por cada UPDATE. Cuando el cliente dispara
 * varias llamadas casi juntas —reconectar Realtime, bajar el espejo del equipo, refrescar el
 * perfil, todo al volver a primer plano o recuperar señal— todas compiten por la MISMA fila de
 * `pdt_sesiones`, y se van encolando una detrás de otra a esperar el commit de la anterior.
 * Con suficientes en la cola, las últimas superan el `statement_timeout` (3s para `anon`, 8s
 * para `authenticated`) y el cliente ve un 500 "canceling statement due to statement timeout"
 * — confirmado en los logs: varios `process ... waiting for ExclusiveLock on tuple` sobre
 * `pdt_sesiones` en la misma ráfaga de menos de 2 segundos.
 *
 * El dato en sí (cuándo se usó la sesión por última vez) no necesita precisión de milisegundo:
 * basta con saber que se sigue usando. Escribirlo solo cuando ya pasó un rato vuelve inocua a
 * la ráfaga — la primera llamada actualiza, las que la siguen a los pocos segundos ya no
 * necesitan el lock.
 */

create or replace function pdt_correo_de_sesion(p_sesion_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_hash   text;
    v_correo text;
begin
    if coalesce(p_sesion_token, '') = '' then
        raise exception 'Sesión no reconocida' using errcode = '28000';
    end if;

    v_hash := encode(digest(p_sesion_token, 'sha256'), 'hex');

    select s.correo into v_correo from pdt_sesiones s where s.sesion_hash = v_hash;

    if v_correo is null then
        raise exception 'Sesión no reconocida' using errcode = '28000';
    end if;

    update pdt_sesiones set ultimo_uso = now()
    where sesion_hash = v_hash and ultimo_uso < now() - interval '1 minute';

    return v_correo;
end;
$$;

-- Mismo patrón: se usa solo al reconectar Calendar, mucho menos seguido, pero el arreglo es
-- igual de barato y evita el mismo problema si alguna vez coincide con otra llamada.
create or replace function pdt_google_credenciales_por_sesion(p_sesion_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    fila pdt_google_credenciales;
begin
    select g.* into fila
    from pdt_sesiones s
    join pdt_google_credenciales g on g.correo = s.correo
    where s.sesion_hash = p_sesion_hash;

    if not found then
        return jsonb_build_object('status', 'error', 'message', 'Sesión no reconocida');
    end if;

    update pdt_sesiones set ultimo_uso = now()
    where sesion_hash = p_sesion_hash and ultimo_uso < now() - interval '1 minute';
    update pdt_google_credenciales set ultimo_uso = now()
    where correo = fila.correo and ultimo_uso < now() - interval '1 minute';

    return jsonb_build_object(
        'status', 'ok', 'correo', fila.correo, 'refresh_token', fila.refresh_token
    );
end;
$$;
