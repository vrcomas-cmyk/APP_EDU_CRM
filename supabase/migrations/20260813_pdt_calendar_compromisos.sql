-- Plan de Trabajo — espejo de "lo demás" que cada quien tiene en su Google Calendar.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Hasta ahora un gerente veía las VISITAS de su equipo (ya venían por `pdt_visitas_en_alcance`)
-- pero nunca los demás compromisos que cada educador tiene en su Google Calendar personal —
-- porque ese calendario se lee con el token OAuth del propio educador, y no hay forma de que el
-- token del gerente lea el calendario de otra persona sin que esa persona lo comparta desde
-- Google (fuera del alcance de este repo).
--
-- La salida: en vez de leer el Calendar ajeno en vivo, cada dispositivo sube (mejor esfuerzo,
-- igual que ya hace con visitas/eventos/comentarios) lo que SU PROPIA lectura de
-- `listarCompromisos()` ya trajo. Un gerente entonces no lee Calendar de nadie más — lee este
-- espejo, recortado por la misma jerarquía (`pdt_alcance`) que ya usan las visitas.

create table if not exists pdt_calendar_compromisos (
    id              text primary key,           -- id del evento en Google Calendar
    educador_correo text not null,
    titulo          text not null default '',
    inicio          timestamptz not null,
    fin             timestamptz not null,
    todo_el_dia     boolean not null default false,
    ubicacion       text not null default '',
    descripcion     text not null default '',
    url             text not null default '',
    actualizado     timestamptz not null default now()
);

create index if not exists pdt_calendar_compromisos_correo_idx
    on pdt_calendar_compromisos (educador_correo, inicio);

alter table pdt_calendar_compromisos enable row level security;
-- Sin políticas a propósito, mismo criterio que `pdt_visitas`: el acceso real pasa por las
-- funciones `security definer` de abajo, nunca directo con la clave anónima.

-- ---------- guardar: cada dispositivo sube lo que SU token de Calendar ya leyó ----------

create or replace function pdt_calendar_compromisos_guardar(
    p_correo text, p_compromisos jsonb, p_desde timestamptz default null, p_hasta timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    c        jsonb;
    n        int := 0;
    ids      text[] := '{}';
    borrados int := 0;
begin
    for c in select * from jsonb_array_elements(coalesce(p_compromisos, '[]'::jsonb))
    loop
        insert into pdt_calendar_compromisos (
            id, educador_correo, titulo, inicio, fin, todo_el_dia, ubicacion, descripcion, url,
            actualizado
        ) values (
            c->>'id', lower(trim(p_correo)),
            coalesce(c->>'titulo', ''),
            (c->>'inicio')::timestamptz, (c->>'fin')::timestamptz,
            coalesce((c->>'todoElDia')::boolean, false),
            coalesce(c->>'ubicacion', ''), coalesce(c->>'descripcion', ''), coalesce(c->>'url', ''),
            now()
        )
        on conflict (id) do update set
            educador_correo = excluded.educador_correo,
            titulo = excluded.titulo, inicio = excluded.inicio, fin = excluded.fin,
            todo_el_dia = excluded.todo_el_dia, ubicacion = excluded.ubicacion,
            descripcion = excluded.descripcion, url = excluded.url, actualizado = excluded.actualizado;

        ids := array_append(ids, c->>'id');
        n := n + 1;
    end loop;

    -- Lo que ya no está en lo que este dispositivo acaba de leer (en el rango que trajo) se
    -- borra del espejo: si no, un compromiso cancelado en Calendar se queda fantasma para
    -- siempre en lo que ve el gerente. `p_desde`/`p_hasta` es el mismo rango que el cliente le
    -- pidió a `listarCompromisos()`; sin rango (null) no se borra nada, por si algún llamador
    -- manda una lista parcial sin querer decir "esto es todo lo que hay en tal ventana".
    if p_desde is not null and p_hasta is not null then
        with eliminados as (
            delete from pdt_calendar_compromisos
            where educador_correo = lower(trim(p_correo))
              and fin >= p_desde and inicio <= p_hasta
              and not (id = any(ids))
            returning 1
        )
        select count(*) into borrados from eliminados;
    end if;

    return jsonb_build_object('status', 'ok', 'guardados', n, 'borrados', borrados, 'ids', to_jsonb(ids));
end;
$$;

-- ---------- leer en alcance: lo que un gerente puede ver de su equipo ----------

create or replace function pdt_calendar_compromisos_en_alcance(
    p_correo text, p_desde timestamptz, p_hasta timestamptz, p_todas boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with por_persona as (
        select correo from pdt_alcance(p_correo)
    )
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', c.id,
            'educadorCorreo', c.educador_correo,
            'titulo', c.titulo,
            'inicio', c.inicio,
            'fin', c.fin,
            'todoElDia', c.todo_el_dia,
            'ubicacion', c.ubicacion,
            'descripcion', c.descripcion,
            'url', c.url
        )
    ), '[]'::jsonb)
    from pdt_calendar_compromisos c
    where (p_todas or c.educador_correo in (select correo from por_persona))
      and c.educador_correo <> lower(trim(p_correo))  -- lo propio ya lo trae el Calendar en vivo
      and c.fin >= p_desde and c.inicio <= p_hasta;
$$;
