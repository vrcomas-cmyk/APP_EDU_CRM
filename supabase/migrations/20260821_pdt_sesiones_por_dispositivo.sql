-- Plan de Trabajo — sesiones por DISPOSITIVO, no por cuenta.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- ── Qué estaba mal ──────────────────────────────────────────────────────────────────
--
-- El modelo de `20260820_pdt_google_credenciales.sql` guardaba UN solo `sesion_hash` por
-- correo (clave primaria = correo). Cada inicio de sesión en un dispositivo nuevo hacía
-- `on conflict (correo) do update set sesion_hash = p_sesion_hash`, reemplazando la sesión
-- del dispositivo anterior.
--
-- Consecuencia: se inicia sesión en el celular, y la sesión de la compu muere en el mismo
-- instante. Apps Script deja de reconocer su `sesion_token`
-- ("Tu sesión ya no es válida. Vuelve a iniciar sesión."), y TODO lo que esa compu intente
-- subir o bajar —check-ins, visitas, revisiones— queda rechazado. Es exactamente el
-- síntoma de "hago un check-in en un dispositivo y no aparece en el otro": el segundo
-- dispositivo ya le había quitado la sesión al primero al iniciar sesión.
--
-- ── Qué se separa ──────────────────────────────────────────────────────────────────
--
-- La intención declarada de aquella migración era "cualquier dispositivo que inicie sesión
-- con la misma cuenta ya tiene el permiso, sin volver a pedir nada". El REFRESH TOKEN sí
-- es por cuenta (una fila por correo en `pdt_google_credenciales`). La SESIÓN, no: cada
-- dispositivo necesita la suya, y todas deben poder coexistir.
--
--   pdt_google_credenciales   refresh token de Google, una fila por correo. Sin sesión.
--   pdt_sesiones              una fila por sesión/dispositivo, que apunta a la cuenta.
--
-- Cerrar sesión en un dispositivo borra SOLO su sesión (`pdt_sesion_olvidar`); revocar el
-- acceso de Google en general (`invalid_grant`) sigue borrando la credencial de la cuenta y,
-- por el cascade, todas sus sesiones.

create table if not exists pdt_sesiones (
    sesion_hash text primary key,
    correo      text not null references pdt_google_credenciales(correo) on delete cascade,
    creado      timestamptz not null default now(),
    ultimo_uso  timestamptz not null default now()
);

create index if not exists pdt_sesiones_correo_idx on pdt_sesiones (correo);

-- La sesión que ya existía se conserva: sin este paso, `drop column` la perdería y la
-- persona tendría que volver a iniciar sesión en el dispositivo que la tenía.
insert into pdt_sesiones (sesion_hash, correo, creado, ultimo_uso)
select sesion_hash, correo, creado, ultimo_uso
from pdt_google_credenciales
where sesion_hash is not null and sesion_hash <> '';

alter table pdt_google_credenciales drop column sesion_hash;

alter table pdt_sesiones enable row level security;
-- Sin políticas a propósito, mismo criterio que `pdt_google_credenciales`: el acceso real
-- pasa por las funciones `security definer` de abajo, invocadas solo desde Apps Script con
-- la service_role.

-- ---------- guardar / renovar credencial + abrir sesión de dispositivo ----------

create or replace function pdt_google_credenciales_guardar(
    p_correo text, p_refresh_token text, p_scopes text, p_sesion_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into pdt_google_credenciales (correo, refresh_token, scopes, creado, ultimo_uso)
    values (lower(trim(p_correo)), p_refresh_token, coalesce(p_scopes, ''), now(), now())
    on conflict (correo) do update set
        -- Google solo entrega el refresh token en el consentimiento inicial; un canje posterior
        -- (p. ej. reautenticación tras revocar) puede no traer uno nuevo. No lo pisamos con
        -- vacío para no perder el que ya funcionaba.
        refresh_token = case when p_refresh_token is not null and p_refresh_token <> ''
                              then p_refresh_token else pdt_google_credenciales.refresh_token end,
        scopes = coalesce(p_scopes, pdt_google_credenciales.scopes),
        ultimo_uso = now();

    -- Cada inicio de sesión es una sesión nueva; la de OTRO dispositivo no se toca.
    if coalesce(p_sesion_hash, '') <> '' then
        insert into pdt_sesiones (sesion_hash, correo, creado, ultimo_uso)
        values (p_sesion_hash, lower(trim(p_correo)), now(), now())
        on conflict (sesion_hash) do update set
            correo = excluded.correo,
            ultimo_uso = now();
    end if;

    return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- resolver identidad a partir de un token de sesión ----------

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

    update pdt_sesiones set ultimo_uso = now() where sesion_hash = p_sesion_hash;
    update pdt_google_credenciales set ultimo_uso = now() where correo = fila.correo;

    return jsonb_build_object(
        'status', 'ok', 'correo', fila.correo, 'refresh_token', fila.refresh_token
    );
end;
$$;

-- ---------- olvidar la credencial de la cuenta (refresh token revocado / invalid_grant) ----------

create or replace function pdt_google_credenciales_olvidar(p_correo text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    delete from pdt_google_credenciales where correo = lower(trim(p_correo));
    select jsonb_build_object('status', 'ok');
$$;

-- ---------- cerrar sesión de UN dispositivo ----------

create or replace function pdt_sesion_olvidar(p_sesion_hash text)
returns jsonb
language sql
security definer
set search_path = public
as $$
    delete from pdt_sesiones where sesion_hash = p_sesion_hash;
    select jsonb_build_object('status', 'ok');
$$;

-- ---------- permisos de ejecución ----------
--
-- `security definer` NO implica acceso restringido: Postgres da EXECUTE a PUBLIC por
-- defecto. Sin este bloque, estas funciones quedan llamables con la clave anónima —que
-- viaja en el bundle de la PWA y por lo tanto es pública—. Mismo criterio que el resto del
-- espejo: solo el service_role (que vive en las propiedades del proyecto de Apps Script)
-- debe poder tocar sesiones y credenciales.

revoke execute on function pdt_google_credenciales_guardar(text, text, text, text) from public, anon, authenticated;
revoke execute on function pdt_google_credenciales_por_sesion(text)                from public, anon, authenticated;
revoke execute on function pdt_google_credenciales_olvidar(text)                   from public, anon, authenticated;
revoke execute on function pdt_sesion_olvidar(text)                                from public, anon, authenticated;

grant execute on function pdt_google_credenciales_guardar(text, text, text, text) to service_role;
grant execute on function pdt_google_credenciales_por_sesion(text)                to service_role;
grant execute on function pdt_google_credenciales_olvidar(text)                   to service_role;
grant execute on function pdt_sesion_olvidar(text)                                to service_role;