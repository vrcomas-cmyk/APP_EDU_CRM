-- Plan de Trabajo — Supabase como almacenamiento PRINCIPAL de visitas.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- ── Qué estaba mal ──────────────────────────────────────────────────────────────────
--
-- Hasta hoy, TODA escritura y lectura de visitas pasaba por Apps Script: la PWA sube por
-- `guardarVisitas` (que escribe primero en Sheets y DESPUÉS espeja a Supabase) y baja por
-- `leerVisitasEquipo` (que llama a `pdt_visitas_en_alcance`). Apps Script es un solo hilo,
-- con cuota diaria y latencia de segundos — el cuello de botella real de un ciclo que corre
-- cada 60s en cada dispositivo. Cuando el espejo fallaba, `sincronizarVisitas` (js/sync.js)
-- ni siquiera marcaba la visita como subida, así que quedaba atrapada en el dispositivo. Es
-- la causa directa de "hago check-in en el celular y no aparece en la compu".
--
-- ── Qué se resuelve aquí ────────────────────────────────────────────────────────────
--
-- Supabase pasa a ser el almacenamiento PRINCIPAL: la PWA llama estas funciones DIRECTO, con
-- la clave anónima, sin pasar por Apps Script. Eso solo es seguro porque desde
-- `20260821_pdt_sesiones_por_dispositivo.sql` existe `pdt_sesiones (sesion_hash → correo)`:
-- una función que recibe el TOKEN DE SESIÓN (no el correo) puede resolver la identidad
-- DENTRO de Postgres, con la misma garantía que antes daba Apps Script — el token es un
-- secreto que solo tiene su dueño, y `pdt_sesiones` sigue sin políticas (ilegible para
-- `anon` por lectura directa).
--
-- Se REUSA toda la lógica existente (`pdt_espejo_guardar`, `pdt_visitas_en_alcance`) — estas
-- funciones nuevas son solo una envoltura de identidad, no reimplementan nada del aplanado
-- ni del alcance jerárquico.
--
-- Apps Script sigue escribiendo Sheets como hoy (sin cambios en este archivo); una migración
-- y un cambio de Apps Script posteriores convertirán esa escritura en un export diario desde
-- una cola que se llena aquí (`pdt_export_cola`).

-- ---------- extensión necesaria para el hash del token ----------

create extension if not exists pgcrypto with schema extensions;

-- ---------- resolver identidad a partir de un token de sesión ----------

/*
 * Interna: NO se otorga a `anon`. La llaman, ya como `security definer`, las envolturas de
 * abajo. Lanza si el token no existe o no coincide — así una envoltura que se olvide de
 * comprobar el resultado no puede colarse con un correo vacío.
 *
 * El hash debe coincidir BYTE A BYTE con `huellaSesion()` en apps-script/Codigo.gs (SHA-256
 * hex en minúsculas, sin separador). Si algo aquí se desalinea, todo el mundo queda fuera —
 * pruébese con un token real antes de apoyar el cliente en esto.
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

    update pdt_sesiones set ultimo_uso = now() where sesion_hash = v_hash;

    return v_correo;
end;
$$;

-- ---------- escribir visitas directo desde la PWA ----------

/*
 * Reemplaza al viaje PWA → Apps Script → `pdt_espejo_guardar` para el camino caliente
 * (check-in/out, actividades). Delega TODO el aplanado en `pdt_espejo_guardar`, que ya existe
 * y ya está probado — aquí solo se resuelve identidad y se encola el export a Sheets.
 *
 * `p_visitas` es el mismo árbol que la PWA ya arma para Apps Script (ver `soloGuardadas()`
 * en js/sync.js): un arreglo de visitas con sus sectores/actividades/materiales anidados.
 */
create or replace function pdt_visitas_guardar_sesion(p_sesion_token text, p_visitas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
    v_resultado jsonb;
    v_visita jsonb;
begin
    v_resultado := pdt_espejo_guardar(v_correo, p_visitas);

    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;

    -- Encola cada visita para el export diario a Sheets. `on conflict` colapsa varias
    -- ediciones de la misma visita en la misma hora a una sola fila pendiente.
    for v_visita in select * from jsonb_array_elements(coalesce(p_visitas, '[]'::jsonb))
    loop
        insert into pdt_export_cola (id_visita, correo, nombre, payload, encolado)
        values (v_visita->>'id', v_correo, v_nombre, v_visita, now())
        on conflict (id_visita) do update set
            correo   = excluded.correo,
            nombre   = excluded.nombre,
            payload  = excluded.payload,
            encolado = now(),
            tomado   = null;  -- una edición nueva reabre una fila que ya se había tomado
    end loop;

    return v_resultado;
end;
$$;

-- ---------- leer visitas del equipo directo desde la PWA ----------

/*
 * Reemplaza al viaje PWA → Apps Script → `pdt_visitas_en_alcance` para la bajada del espejo.
 * `p_todas` se calcula aquí con `pdt_es_admin`, que cubre `pdt_admins` + capacidad
 * `administracion.configurar` — es un subconjunto de lo que hoy decide `esAdmin()` en Apps
 * Script (que además admite la hoja "Admins" heredada). Si algún admin real existe SOLO en
 * esa hoja y no en Supabase, verlo aquí como `p_todas = false` es la única divergencia
 * conocida; se resuelve dándolo de alta en `pdt_admins` o con un rol con esa capacidad.
 */
create or replace function pdt_visitas_equipo_sesion(
    p_sesion_token text,
    p_desde        date default null,
    p_hasta        date default null,
    p_limite       int  default 2000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    return pdt_visitas_en_alcance(v_correo, p_desde, p_hasta, p_limite, pdt_es_admin(v_correo));
end;
$$;

-- ---------- cola de exportación a Sheets (una vez al día) ----------

create table if not exists pdt_export_cola (
    id_visita text primary key,
    correo    text not null,
    nombre    text,
    payload   jsonb not null,
    encolado  timestamptz not null default now(),
    tomado    timestamptz               -- null = pendiente de exportar
);

create index if not exists pdt_export_cola_tomado_idx on pdt_export_cola (tomado);

alter table pdt_export_cola enable row level security;
-- Sin políticas a propósito, mismo criterio que el resto del espejo: solo el service_role
-- (Apps Script) puede drenarla.

/*
 * Toma hasta `p_limite` filas pendientes (o abandonadas hace más de 30 min, por si un
 * intento anterior murió a medias sin confirmar) y las marca como tomadas.
 */
create or replace function pdt_export_tomar(p_limite int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_filas jsonb;
begin
    with candidatas as (
        select id_visita
        from pdt_export_cola
        where tomado is null or tomado < now() - interval '30 minutes'
        order by encolado
        limit greatest(1, least(coalesce(p_limite, 200), 1000))
        for update skip locked
    ),
    marcadas as (
        update pdt_export_cola c
        set tomado = now()
        from candidatas
        where c.id_visita = candidatas.id_visita
        returning c.id_visita, c.correo, c.nombre, c.payload
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id_visita', id_visita, 'correo', correo, 'nombre', nombre, 'payload', payload
    )), '[]'::jsonb) into v_filas
    from marcadas;

    return v_filas;
end;
$$;

/** Borra de la cola las filas que Apps Script ya escribió en Sheets con éxito. */
create or replace function pdt_export_confirmar(p_ids text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
    delete from pdt_export_cola where id_visita = any(coalesce(p_ids, '{}'::text[]));
    select jsonb_build_object('status', 'ok', 'borradas', coalesce(array_length(p_ids, 1), 0));
$$;

-- ---------- permisos de ejecución ----------

-- Interna: nadie fuera de estas funciones debe poder resolver un token a un correo.
revoke execute on function pdt_correo_de_sesion(text) from public, anon, authenticated;

-- Superficie nueva para la PWA: la clave anónima puede llamarlas porque la identidad real se
-- valida DENTRO de la función, a partir del token de sesión.
revoke execute on function pdt_visitas_guardar_sesion(text, jsonb)              from public;
revoke execute on function pdt_visitas_equipo_sesion(text, date, date, int)     from public;

grant execute on function pdt_visitas_guardar_sesion(text, jsonb)              to anon, authenticated, service_role;
grant execute on function pdt_visitas_equipo_sesion(text, date, date, int)     to anon, authenticated, service_role;

-- La cola de export solo la toca Apps Script, con el service_role.
revoke execute on function pdt_export_tomar(int)       from public, anon, authenticated;
revoke execute on function pdt_export_confirmar(text[]) from public, anon, authenticated;

grant execute on function pdt_export_tomar(int)        to service_role;
grant execute on function pdt_export_confirmar(text[]) to service_role;
