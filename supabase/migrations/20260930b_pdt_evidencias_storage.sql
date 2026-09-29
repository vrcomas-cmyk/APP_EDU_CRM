-- Evidencias (fotos/PDF) en Supabase Storage, con copia a Drive como respaldo.
--
-- Antes: PWA → Apps Script (base64 en un POST, tras el candado global de Apps Script) → Drive.
-- Tres subidas "en paralelo" se atendían en fila y pasaban de los 20 s; al cortar el cliente el
-- servidor terminaba igual y el reintento dejaba un archivo duplicado en Drive.
--
-- Ahora: PWA → URL firmada de Storage (binario directo, sin base64, sin candado) → RPC que lo
-- registra. La ruta es fija por actividad (`<id_actividad><ext>`), así que un reintento
-- SOBRESCRIBE en vez de duplicar. Apps Script copia a Drive desde la cola de exportación.

-- ---------- bucket privado ----------

insert into storage.buckets (id, name, public, file_size_limit)
values ('evidencias', 'evidencias', false, 15728640)   -- 15 MB; la app ya limita a 10 MB
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;
-- Sin políticas sobre storage.objects a propósito: nadie con la clave anónima lee ni escribe el
-- bucket. Todo pasa por URLs firmadas que emite la Edge Function `evidencia-url` tras validar
-- la sesión.

-- ---------- registro de lo subido ----------
-- Tabla aparte de pdt_actividades: `pdt_espejo_guardar` borra y reinserta las actividades en cada
-- guardado de la visita, así que cualquier columna nueva ahí se perdería.

create table if not exists pdt_evidencias (
    id          text primary key,             -- = id de la actividad
    ruta        text not null,                -- ruta en el bucket `evidencias`
    nombre      text,
    tipo        text,
    tamano      bigint,
    subido_por  text,
    subido_en   timestamptz not null default now(),
    drive_url   text                          -- lo llena Apps Script al copiarla a Drive
);

alter table pdt_evidencias enable row level security;

drop trigger if exists trg_export_entidad on pdt_evidencias;
-- Solo cuando cambia el archivo: anotar `drive_url` no debe volver a encolar la copia.
create trigger trg_export_entidad after insert or update of ruta, subido_en on pdt_evidencias
    for each row execute function pdt_encolar_export('evidencias');

-- `tomar` genérico: la tabla de cada entidad es `pdt_<entidad>` (los nombres salen de la
-- propia cola, que solo llenan los triggers de arriba).
create or replace function pdt_export_entidades_tomar(p_limite int default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    r         record;
    resultado jsonb := '[]'::jsonb;
    v_fila    jsonb;
    v_tabla   regclass;
begin
    for r in
        update pdt_export_entidades q
           set tomado = now()
         where (q.entidad, q.id) in (
                select entidad, id from pdt_export_entidades
                 where tomado is null or tomado < now() - interval '30 minutes'
                 order by encolado
                 limit greatest(1, least(coalesce(p_limite, 200), 1000))
                 for update skip locked)
        returning q.entidad, q.id
    loop
        v_tabla := to_regclass('public.pdt_' || r.entidad);
        continue when v_tabla is null;

        execute format('select to_jsonb(t) from %s t where t.id = $1', v_tabla) into v_fila using r.id;
        resultado := resultado || jsonb_build_array(
            jsonb_build_object('entidad', r.entidad, 'id', r.id, 'fila', v_fila));
    end loop;
    return resultado;
end;
$$;

-- ---------- RPCs (VOLATILE: pdt_correo_de_sesion hace UPDATE) ----------

-- ¿Puede esta sesión subir? Solo pide sesión válida: la ruta la fija el id de la actividad.
create or replace function pdt_evidencia_autorizar_sesion(p_sesion_token text, p_id_actividad text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    if coalesce(p_id_actividad, '') = '' then
        return jsonb_build_object('ok', false);
    end if;
    return jsonb_build_object('ok', true, 'correo', v_correo);
end;
$$;

create or replace function pdt_evidencia_registrar_sesion(
    p_sesion_token text, p_id_actividad text, p_ruta text, p_nombre text, p_tipo text, p_tamano bigint
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
    if coalesce(p_id_actividad, '') = '' or coalesce(p_ruta, '') = '' then
        return jsonb_build_object('ok', false);
    end if;

    insert into pdt_evidencias (id, ruta, nombre, tipo, tamano, subido_por, subido_en, drive_url)
    values (p_id_actividad, p_ruta, p_nombre, p_tipo, p_tamano, v_correo, now(), null)
    on conflict (id) do update set
        ruta = excluded.ruta, nombre = excluded.nombre, tipo = excluded.tipo,
        tamano = excluded.tamano, subido_por = excluded.subido_por, subido_en = now(),
        drive_url = null;   -- archivo nuevo: la copia de Drive ya no corresponde

    return jsonb_build_object('ok', true);
end;
$$;

-- La ruta para VER, o null si esta sesión no puede: el dueño de la visita, alguien a cuyo cargo
-- está el dueño, o un administrador.
create or replace function pdt_evidencia_puede_ver_sesion(p_sesion_token text, p_id_actividad text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_dueno  text;
    v_ruta   text;
begin
    select e.ruta into v_ruta from pdt_evidencias e where e.id = p_id_actividad;
    if v_ruta is null then return null; end if;

    select lower(trim(v.educador_correo)) into v_dueno
      from pdt_actividades a join pdt_visitas v on v.id = a.id_visita
     where a.id = p_id_actividad;

    -- Sin actividad todavía en el espejo: solo quien la subió (o un admin) la ve.
    if v_dueno is null then
        if exists (select 1 from pdt_evidencias e where e.id = p_id_actividad and lower(e.subido_por) = lower(v_correo))
           or pdt_es_admin(v_correo) then
            return v_ruta;
        end if;
        return null;
    end if;

    if v_dueno = lower(v_correo)
       or pdt_es_admin(v_correo)
       or exists (select 1 from pdt_alcance(v_correo) al where lower(al.correo) = v_dueno) then
        return v_ruta;
    end if;
    return null;
end;
$$;

-- Apps Script anota el enlace de Drive cuando termina de copiar.
create or replace function pdt_evidencia_drive_url(p_id text, p_url text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
    update pdt_evidencias set drive_url = p_url where id = p_id;
$$;

revoke execute on function pdt_evidencia_autorizar_sesion(text, text)                          from public;
revoke execute on function pdt_evidencia_registrar_sesion(text, text, text, text, text, bigint) from public;
revoke execute on function pdt_evidencia_puede_ver_sesion(text, text)                          from public;
revoke execute on function pdt_evidencia_drive_url(text, text)                                 from public, anon, authenticated;

grant execute on function pdt_evidencia_autorizar_sesion(text, text)                          to anon, authenticated, service_role;
grant execute on function pdt_evidencia_registrar_sesion(text, text, text, text, text, bigint) to anon, authenticated, service_role;
grant execute on function pdt_evidencia_puede_ver_sesion(text, text)                          to anon, authenticated, service_role;
grant execute on function pdt_evidencia_drive_url(text, text)                                 to service_role;

-- La función de trigger no debe poder llamarse como RPC.
revoke execute on function pdt_encolar_export() from public, anon, authenticated;
