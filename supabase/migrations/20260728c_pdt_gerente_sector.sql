-- Plan de Trabajo — qué Sector (línea de producto) puede ver cada Gerente.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- "Sector" aquí es el mismo catálogo de siempre —GASAS, SUTURAS, CARDINAL, etc.— el que ya
-- elige el educador al agregar un Sector a una visita (`pdt_sectores.nombre`) y el que ya
-- cuenta `ind.por_sector` en el cliente. Un gerente puede tener varios; sin ninguno asignado,
-- no ve nada por esta vía (alguien sin sectores asignados no es "ve todos", es "no tiene
-- filtro configurado todavía" — el lado seguro).
--
-- Solo estado actual, sin historial: a diferencia de la jerarquía, reasignar un sector no
-- necesita recordar quién lo tenía antes — decisión explícita, ver conversación del
-- 2026-07-28.

create table if not exists pdt_gerente_sector (
    gerente_correo text not null,
    sector         text not null,
    creado_en      timestamptz not null default now(),
    primary key (gerente_correo, sector)
);

alter table pdt_gerente_sector enable row level security;

comment on table pdt_gerente_sector is
    'Qué Sector (línea de producto) puede ver cada gerente en el reporte de actividades. '
    'Solo estado actual — reasignar no conserva quién lo tenía antes.';

-- ---------- lectura ----------

create or replace function pdt_sectores_de_gerente(p_correo text)
returns table (sector text)
language sql
stable
security definer
set search_path = public
as $$
    select gs.sector from pdt_gerente_sector gs
    where lower(trim(gs.gerente_correo)) = lower(trim(p_correo))
    order by gs.sector
$$;

/** Para la pantalla de administración: todos los gerentes con sus sectores, en una sola ida. */
create or replace function pdt_gerente_sector_listar()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'gerente_correo', gs.gerente_correo,
        'sectores', (
            select coalesce(jsonb_agg(x.sector order by x.sector), '[]'::jsonb)
            from pdt_gerente_sector x where x.gerente_correo = gs.gerente_correo
        )
    ) order by gs.gerente_correo), '[]'::jsonb)
    from (select distinct gerente_correo from pdt_gerente_sector) gs
$$;

-- ---------- escritura ----------
--
-- Reemplazo completo por gerente, igual que `pdt_jerarquia_guardar` con los subordinados de
-- un jefe: la pantalla manda la lista entera de sectores de ESE gerente, y guardar significa
-- "esta es la lista", incluido dejarla vacía.

create or replace function pdt_gerente_sector_guardar(p_actor text, p_gerente text, p_sectores jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor   text := pdt_exige_admin(p_actor);
    v_gerente text := lower(trim(coalesce(p_gerente, '')));
    v_n       int := 0;
begin
    if v_gerente = '' then
        raise exception 'Falta el correo del gerente.';
    end if;

    delete from pdt_gerente_sector where lower(trim(gerente_correo)) = v_gerente;

    insert into pdt_gerente_sector (gerente_correo, sector)
    select v_gerente, trim(x)
    from jsonb_array_elements_text(coalesce(p_sectores, '[]'::jsonb)) x
    where trim(x) <> ''
    on conflict do nothing;

    get diagnostics v_n = row_count;

    return jsonb_build_object('gerente_correo', v_gerente, 'sectores', v_n);
end $$;

revoke execute on function pdt_sectores_de_gerente(text)        from public, anon, authenticated;
revoke execute on function pdt_gerente_sector_listar()          from public, anon, authenticated;
revoke execute on function pdt_gerente_sector_guardar(text, text, jsonb) from public, anon, authenticated;

grant execute on function pdt_sectores_de_gerente(text)        to service_role;
grant execute on function pdt_gerente_sector_listar()           to service_role;
grant execute on function pdt_gerente_sector_guardar(text, text, jsonb) to service_role;
