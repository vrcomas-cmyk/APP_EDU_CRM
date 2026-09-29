-- Supabase primero, Sheets como respaldo — para TODO, no solo las visitas.
--
-- Hoy solo las visitas se copian a Sheets desde Supabase (pdt_export_cola). Aquí se generaliza:
--  1. Cola `pdt_export_entidades (entidad, id)`, llenada por triggers en cada tabla.
--  2. RPCs de sesión para eventos, comentarios y revisiones: la PWA escribe DIRECTO a Supabase
--     (antes pasaba por Apps Script, que iba primero a Sheets y era lento).
--  3. `pdt_export_entidades_tomar/confirmar`: las drena Apps Script (exportarEntidadesASheets),
--     mismo patrón de tomar/confirmar en dos pasos que `pdt_export_tomar`.

-- ---------- cola ----------

create table if not exists pdt_export_entidades (
    entidad  text not null,
    id       text not null,
    encolado timestamptz not null default now(),
    tomado   timestamptz,
    primary key (entidad, id)
);

alter table pdt_export_entidades enable row level security;
-- Sin políticas: solo service_role (Apps Script) y las funciones security definer la tocan.

-- Encolar (o reencolar: si la fila cambia mientras se exporta, vuelve a quedar pendiente).
create or replace function pdt_encolar_export()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id text := case when tg_op = 'DELETE' then old.id else new.id end;
begin
    insert into pdt_export_entidades (entidad, id, encolado, tomado)
    values (tg_argv[0], v_id, now(), null)
    on conflict (entidad, id) do update set encolado = now(), tomado = null;
    return null;
end;
$$;

do $$
declare
    par record;
begin
    for par in
        select * from (values
            ('estrategias', 'pdt_estrategias'),
            ('pendientes',  'pdt_pendientes'),
            ('eventos',     'pdt_eventos'),
            ('comentarios', 'pdt_comentarios'),
            ('revisiones',  'pdt_revisiones')
        ) as t(entidad, tabla)
    loop
        execute format('drop trigger if exists trg_export_entidad on %I', par.tabla);
        execute format(
            'create trigger trg_export_entidad after insert or update or delete on %I '
            'for each row execute function pdt_encolar_export(%L)', par.tabla, par.entidad);
    end loop;
end $$;

-- ---------- drenar: tomar / confirmar ----------

-- Devuelve [{entidad, id, fila}] — `fila` es null si el registro ya no existe (se borró).
-- Un reclamo sin confirmar vuelve a estar disponible a los 30 min, como `pdt_export_tomar`.
create or replace function pdt_export_entidades_tomar(p_limite int default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    r        record;
    resultado jsonb := '[]'::jsonb;
    v_fila   jsonb;
    v_tabla  text;
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
        v_tabla := case r.entidad
            when 'estrategias' then 'pdt_estrategias'
            when 'pendientes'  then 'pdt_pendientes'
            when 'eventos'     then 'pdt_eventos'
            when 'comentarios' then 'pdt_comentarios'
            when 'revisiones'  then 'pdt_revisiones'
        end;
        continue when v_tabla is null;

        execute format('select to_jsonb(t) from %I t where t.id = $1', v_tabla) into v_fila using r.id;
        resultado := resultado || jsonb_build_array(
            jsonb_build_object('entidad', r.entidad, 'id', r.id, 'fila', v_fila));
    end loop;
    return resultado;
end;
$$;

-- Borra de la cola solo lo que NO se volvió a modificar desde que se tomó (`tomado` no nulo).
create or replace function pdt_export_entidades_confirmar(p_claves jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
    n int;
begin
    delete from pdt_export_entidades q
     using jsonb_to_recordset(coalesce(p_claves, '[]'::jsonb)) as c(entidad text, id text)
     where q.entidad = c.entidad and q.id = c.id and q.tomado is not null;
    get diagnostics n = row_count;
    return n;
end;
$$;

revoke execute on function pdt_export_entidades_tomar(int)      from public, anon, authenticated;
revoke execute on function pdt_export_entidades_confirmar(jsonb) from public, anon, authenticated;
grant  execute on function pdt_export_entidades_tomar(int)      to service_role;
grant  execute on function pdt_export_entidades_confirmar(jsonb) to service_role;

-- Lo que ya existe se encola una vez, para que Sheets quede completo desde el primer export.
insert into pdt_export_entidades (entidad, id)
select 'estrategias', id from pdt_estrategias
union all select 'pendientes',  id from pdt_pendientes
union all select 'eventos',     id from pdt_eventos
union all select 'comentarios', id from pdt_comentarios
union all select 'revisiones',  id from pdt_revisiones
on conflict do nothing;

-- ---------- escritura directa desde la PWA (token de sesión) ----------
-- VOLATILE: pdt_correo_de_sesion() hace UPDATE de `ultimo_uso`.

create or replace function pdt_eventos_guardar_sesion(p_sesion_token text, p_eventos jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;
    return pdt_eventos_guardar(v_correo, coalesce(v_nombre, ''), p_eventos);
end;
$$;

create or replace function pdt_comentarios_guardar_sesion(p_sesion_token text, p_comentarios jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;
    return pdt_comentarios_guardar(v_correo, coalesce(v_nombre, ''), p_comentarios);
end;
$$;

create or replace function pdt_revisiones_guardar_sesion(p_sesion_token text, p_revisiones jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;
    return pdt_revision_guardar(v_correo, coalesce(v_nombre, ''), p_revisiones);
end;
$$;

revoke execute on function pdt_eventos_guardar_sesion(text, jsonb)     from public;
revoke execute on function pdt_comentarios_guardar_sesion(text, jsonb) from public;
revoke execute on function pdt_revisiones_guardar_sesion(text, jsonb)  from public;
grant  execute on function pdt_eventos_guardar_sesion(text, jsonb)     to anon, authenticated, service_role;
grant  execute on function pdt_comentarios_guardar_sesion(text, jsonb) to anon, authenticated, service_role;
grant  execute on function pdt_revisiones_guardar_sesion(text, jsonb)  to anon, authenticated, service_role;
