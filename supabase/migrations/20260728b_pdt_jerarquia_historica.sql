-- Plan de Trabajo — jerarquía con historial: quién llevaba a quién EN CADA FECHA.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- `pdt_jerarquia` es un snapshot sin fecha: dice quién ve a quién HOY, y `pdt_alcance` lo usa
-- así a propósito para el control de acceso en vivo — si el Gerente 2 toma hoy a un educador,
-- HOY debe poder verlo y el Gerente 1 debe dejar de verlo, sin esperar nada. Eso no cambia.
--
-- Lo que faltaba es la otra pregunta, la de REPORTES: "¿quién llevaba a este educador el día
-- en que hizo ESTA visita?". Si el Gerente 1 llevó al educador hasta el 15 y el Gerente 2 lo
-- tomó el 16, lo hecho el día 10 tiene que seguir contando para el Gerente 1 aunque hoy ya no
-- lo vea, y lo hecho el día 20 cuenta para el Gerente 2. `pdt_jerarquia` no puede responder
-- eso: al reasignar, la fila vieja simplemente se borra.
--
-- Mismo patrón que ya usa `pdt_zona_cobertura` para zonas (desde/hasta, `hasta` null =
-- vigente), pero el uso es distinto: zonas resuelve visibilidad "ahora" (`now() between
-- desde/hasta`); esto resuelve atribución "a la fecha del evento" (`v.dia between desde/hasta`
-- en los indicadores, no `now()`).
--
-- Alcance actual: un solo nivel (jefe ↔ subordinado directo). Si más adelante hace falta
-- atribuir a través de cadenas de varios niveles, esto se extiende sin romper nada — sigue
-- siendo aditivo.

create table if not exists pdt_jerarquia_historica (
    id           uuid primary key default gen_random_uuid(),
    jefe         text not null,
    subordinado  text not null,
    desde        timestamptz not null default now(),
    -- null = vigente todavía. Se cierra (se le pone `hasta`) cuando el subordinado se le
    -- retira a este jefe — no se borra, para no perder de cuándo a cuándo fue cierto.
    hasta        timestamptz,
    creado_por   text,
    creado_en    timestamptz not null default now()
);

create index if not exists pdt_jerarquia_historica_sub_idx
    on pdt_jerarquia_historica (subordinado, desde, hasta);
create index if not exists pdt_jerarquia_historica_jefe_idx
    on pdt_jerarquia_historica (jefe, hasta);

alter table pdt_jerarquia_historica enable row level security;

comment on table pdt_jerarquia_historica is
    'Historial de quién llevaba a quién y desde/hasta cuándo. Para atribuir indicadores a la '
    'fecha del evento, no al organigrama de hoy. pdt_jerarquia sigue siendo la fuente para '
    'acceso en vivo (pdt_alcance); esta tabla es solo para reportes.';

-- ---------- lectura ----------

/**
 * Quién llevaba a `p_subordinado` en `p_fecha`. `null` si esa fecha no cae dentro de ninguna
 * vigencia registrada (p. ej. antes de que existiera el historial: ver la nota de siembra
 * abajo).
 */
create or replace function pdt_jefe_de_en_fecha(p_subordinado text, p_fecha date)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select h.jefe
    from pdt_jerarquia_historica h
    where lower(trim(h.subordinado)) = lower(trim(p_subordinado))
      and h.desde::date <= p_fecha
      and (h.hasta is null or h.hasta::date >= p_fecha)
    order by h.desde desc
    limit 1
$$;

-- ---------- escritura ----------
--
-- No reemplaza a `pdt_jerarquia_guardar`, lo ACOMPAÑA: cada vez que se guarda la lista de
-- subordinados de un jefe, además de actualizar el snapshot en vivo, se cierra la vigencia de
-- quien se le retira y se abre la de quien se le agrega. Es la misma llamada, no una pantalla
-- nueva — el admin no tiene que hacer nada distinto.

create or replace function pdt_jerarquia_guardar(p_actor text, p_jefe text, p_subordinados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_jefe  text := lower(trim(coalesce(p_jefe, '')));
    v_sub   text;
    v_n     int := 0;
begin
    if v_jefe = '' then
        raise exception 'Falta el correo del jefe.';
    end if;

    for v_sub in
        select distinct lower(trim(x)) from jsonb_array_elements_text(
            coalesce(p_subordinados, '[]'::jsonb)) x
        where trim(x) <> ''
    loop
        if v_sub = v_jefe then
            raise exception 'Nadie puede ser su propio jefe.';
        end if;

        if exists (select 1 from pdt_alcance(v_sub) a where lower(trim(a.correo)) = v_jefe) then
            raise exception '% ya está por encima de % en la jerarquía; ponerlo debajo haría un ciclo.', v_sub, v_jefe;
        end if;
    end loop;

    -- Historial: cierra a quien se le retira a ESTE jefe (los que ya no vienen en la lista
    -- nueva), y abre a quien se le agrega. Compara contra lo que HOY dice `pdt_jerarquia`
    -- —el snapshot en vivo, todavía sin tocar— así que esto se hace ANTES de reemplazarlo.
    update pdt_jerarquia_historica
       set hasta = now()
     where lower(trim(jefe)) = v_jefe
       and hasta is null
       and subordinado in (
           select lower(trim(jt.subordinado)) from pdt_jerarquia jt
           where lower(trim(jt.jefe)) = v_jefe
             and lower(trim(jt.subordinado)) not in (
                 select lower(trim(x)) from jsonb_array_elements_text(
                     coalesce(p_subordinados, '[]'::jsonb)) x
             )
       );

    insert into pdt_jerarquia_historica (jefe, subordinado, creado_por)
    select v_jefe, lower(trim(x)), v_actor
    from jsonb_array_elements_text(coalesce(p_subordinados, '[]'::jsonb)) x
    where trim(x) <> '' and lower(trim(x)) <> v_jefe
      and not exists (
          select 1 from pdt_jerarquia_historica h
          where lower(trim(h.jefe)) = v_jefe
            and h.subordinado = lower(trim(x))
            and h.hasta is null
      );

    -- El snapshot en vivo: igual que antes, reemplazo completo.
    delete from pdt_jerarquia where lower(trim(jefe)) = v_jefe;

    insert into pdt_jerarquia (jefe, subordinado)
    select v_jefe, lower(trim(x))
    from jsonb_array_elements_text(coalesce(p_subordinados, '[]'::jsonb)) x
    where trim(x) <> '' and lower(trim(x)) <> v_jefe
    on conflict do nothing;

    get diagnostics v_n = row_count;

    return jsonb_build_object('jefe', v_jefe, 'subordinados', v_n);
end $$;

-- Siembra: todo lo que HOY dice `pdt_jerarquia` se declara vigente "desde siempre" (desde el
-- creado_en de cada fila), para que `pdt_jefe_de_en_fecha` tenga de dónde partir en vez de
-- devolver null para todo lo capturado antes de esta migración.
insert into pdt_jerarquia_historica (jefe, subordinado, desde, creado_por)
select lower(trim(j.jefe)), lower(trim(j.subordinado)), j.creado_en, 'migración'
from pdt_jerarquia j
where not exists (
    select 1 from pdt_jerarquia_historica h
    where h.jefe = lower(trim(j.jefe)) and h.subordinado = lower(trim(j.subordinado))
      and h.hasta is null
);

revoke execute on function pdt_jefe_de_en_fecha(text, date) from public, anon, authenticated;
grant execute on function pdt_jefe_de_en_fecha(text, date) to service_role;
