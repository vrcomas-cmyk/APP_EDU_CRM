-- Plan de Trabajo — refresh token de Google por CUENTA, no por dispositivo.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Hasta ahora el permiso de Calendar vivía solo en `localStorage` de cada navegador: cada
-- dispositivo tenía que pedirlo por su cuenta, y en varios (Safari/iOS sobre todo) la renovación
-- silenciosa fallaba seguido y el botón "Conectar Google Calendar" se quedaba pegado.
--
-- La salida: el intercambio OAuth se hace del lado del servidor (Apps Script, que ya verifica
-- identidad — ver `verificarIdentidad` en Codigo.gs) y el REFRESH TOKEN de Google se guarda aquí,
-- una vez por correo. El navegador nunca lo ve: solo carga un token de sesión propio, y cada vez
-- que necesita un access_token de Calendar se lo pide a Apps Script, que lo canjea por el refresh
-- token guardado. Con eso cualquier dispositivo que inicie sesión con la misma cuenta ya tiene el
-- permiso, sin volver a pedir nada.

create table if not exists pdt_google_credenciales (
    correo         text primary key,
    refresh_token  text not null,
    scopes         text not null default '',
    sesion_hash    text not null,      -- sha256 del token de sesión que carga el navegador; nunca el token en claro
    creado         timestamptz not null default now(),
    ultimo_uso     timestamptz not null default now()
);

create index if not exists pdt_google_credenciales_sesion_idx
    on pdt_google_credenciales (sesion_hash);

alter table pdt_google_credenciales enable row level security;
-- Sin políticas a propósito, mismo criterio que `pdt_calendar_compromisos`: el acceso real pasa
-- por las funciones `security definer` de abajo, invocadas solo desde Apps Script con la
-- service_role — nunca directo con la clave anónima.

-- ---------- guardar / renovar la credencial de una cuenta ----------

create or replace function pdt_google_credenciales_guardar(
    p_correo text, p_refresh_token text, p_scopes text, p_sesion_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into pdt_google_credenciales (correo, refresh_token, scopes, sesion_hash, creado, ultimo_uso)
    values (lower(trim(p_correo)), p_refresh_token, coalesce(p_scopes, ''), p_sesion_hash, now(), now())
    on conflict (correo) do update set
        -- Google solo entrega el refresh token en el consentimiento inicial; un canje posterior
        -- (p. ej. reautenticación tras revocar) puede no traer uno nuevo. No lo pisamos con
        -- vacío para no perder el que ya funcionaba.
        refresh_token = case when p_refresh_token is not null and p_refresh_token <> ''
                              then p_refresh_token else pdt_google_credenciales.refresh_token end,
        scopes = coalesce(p_scopes, pdt_google_credenciales.scopes),
        sesion_hash = p_sesion_hash,
        ultimo_uso = now();

    return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- resolver identidad a partir del token de sesión ----------

create or replace function pdt_google_credenciales_por_sesion(p_sesion_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    fila pdt_google_credenciales;
begin
    select * into fila from pdt_google_credenciales where sesion_hash = p_sesion_hash;
    if not found then
        return jsonb_build_object('status', 'error', 'message', 'Sesión no reconocida');
    end if;

    update pdt_google_credenciales set ultimo_uso = now() where correo = fila.correo;

    return jsonb_build_object(
        'status', 'ok', 'correo', fila.correo, 'refresh_token', fila.refresh_token
    );
end;
$$;

-- ---------- olvidar la credencial (logout explícito, o refresh token revocado) ----------

create or replace function pdt_google_credenciales_olvidar(p_correo text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    delete from pdt_google_credenciales where correo = lower(trim(p_correo));
    select jsonb_build_object('status', 'ok');
$$;
