-- «Qué se revisa» editable: los criterios de cada flujo de revisión pasan a ser DATOS.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Hasta hoy los criterios (Actividad, Evidencia, Puntualidad…) vivían en el código del cliente.
-- Ahora cada flujo puede traer los suyos, editables en Administración → Flujos:
--   · `criterios` = null  → se usan los predeterminados de la app (nadie los tocó);
--   · `criterios` = [...] → los configurados, incluso una lista vacía (flujo sin casillas).
-- Cada criterio: { clave, etiqueta }. La clave no cambia aunque se renombre la etiqueta, y lo
-- que el revisor marcó en una revisión ya guardada conserva su etiqueta de entonces.

alter table pdt_flujos_revision add column if not exists criterios jsonb;

comment on column pdt_flujos_revision.criterios is
    'Qué se revisa: [{clave, etiqueta}]. null = predeterminados de la app; [] = sin casillas.';

-- Forma: null, o una lista (puede ser VACÍA: «sin casillas») donde cada criterio es un objeto con
-- `clave` y `etiqueta` de texto no vacío. Se expresa con `jsonb_path_exists` y no con un
-- `not exists (select ...)`: Postgres no admite subconsultas dentro de un CHECK (mismo patrón que
-- `pdt_flujos_resultados_forma`). La ruta busca el primer criterio MAL formado; que no haya
-- ninguno es la condición.
alter table pdt_flujos_revision drop constraint if exists pdt_flujos_criterios_forma;
alter table pdt_flujos_revision add constraint pdt_flujos_criterios_forma check (
    criterios is null
    or (
        jsonb_typeof(criterios) = 'array'
        and not jsonb_path_exists(
            criterios,
            '$[*] ? (!exists(@.clave) || !exists(@.etiqueta)'
            ' || @.clave.type() != "string" || @.etiqueta.type() != "string"'
            ' || @.clave like_regex "^\\s*$" || @.etiqueta like_regex "^\\s*$")'
        )
    )
);

-- ---------- lectura (la app, para armar la revisión) ----------

create or replace function pdt_flujos_activos()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', clave, 'nombre', nombre, 'descripcion', descripcion,
        'ambito', ambito, 'permiso', permiso, 'orden', orden,
        'resultados', resultados,
        -- null incluido: "sin configurar" (usa los predeterminados) no es lo mismo que [].
        'criterios', criterios
    ) order by orden, clave), '[]'::jsonb)
    from pdt_flujos_revision where activo
$$;

-- ---------- lectura (Administración) ----------

create or replace function pdt_flujos_revision_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', f.clave, 'nombre', f.nombre, 'descripcion', f.descripcion,
        'ambito', f.ambito, 'permiso', f.permiso, 'activo', f.activo, 'orden', f.orden,
        'resultados', f.resultados,
        'criterios', f.criterios,
        'revisiones', (select count(*) from pdt_revisiones r where r.flujo = f.clave)
    ) order by f.orden, f.clave), '[]'::jsonb)
    from pdt_flujos_revision f
$$;

-- ---------- escritura ----------

create or replace function pdt_flujo_guardar(p_actor text, p_flujo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor   text := pdt_exige_admin(p_actor);
    v_clave   text := lower(trim(coalesce(p_flujo->>'clave', '')));
    v_ambito  text := trim(coalesce(p_flujo->>'ambito', ''));
    v_permiso text := trim(coalesce(p_flujo->>'permiso', ''));
    v_activo  boolean := coalesce((p_flujo->>'activo')::boolean, true);
    -- `null` JSON y ausente significan lo mismo: «los predeterminados».
    v_criterios jsonb := case when jsonb_typeof(p_flujo->'criterios') = 'array' then p_flujo->'criterios' end;
begin
    if v_clave = '' then
        raise exception 'El flujo necesita una clave.';
    end if;
    if v_clave !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'La clave "%" solo puede llevar minúsculas, números y guion bajo, y '
                        'debe empezar por letra.', v_clave;
    end if;

    if v_ambito not in ('visita', 'actividad') then
        raise exception 'El ámbito debe ser "visita" o "actividad" (llegó "%").', v_ambito;
    end if;

    if v_permiso = '' then
        raise exception 'El flujo necesita un permiso.';
    end if;
    if not exists (select 1 from pdt_capacidades c where c.clave = v_permiso) then
        raise exception 'El permiso "%" no existe en el catálogo de capacidades.', v_permiso;
    end if;

    insert into pdt_flujos_revision (clave, nombre, descripcion, ambito, permiso, activo, orden, resultados, criterios)
    values (
        v_clave,
        coalesce(nullif(trim(p_flujo->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_flujo->>'descripcion'), ''),
        v_ambito,
        v_permiso,
        v_activo,
        coalesce((p_flujo->>'orden')::int, 0),
        p_flujo->'resultados',
        v_criterios
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            ambito      = excluded.ambito,
            permiso     = excluded.permiso,
            activo      = excluded.activo,
            orden       = excluded.orden,
            resultados  = excluded.resultados,
            criterios   = excluded.criterios;

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $$;

revoke execute on function pdt_flujos_revision_admin()        from public, anon, authenticated;
revoke execute on function pdt_flujo_guardar(text, jsonb)     from public, anon, authenticated;
grant  execute on function pdt_flujos_revision_admin()        to service_role;
grant  execute on function pdt_flujo_guardar(text, jsonb)     to service_role;
