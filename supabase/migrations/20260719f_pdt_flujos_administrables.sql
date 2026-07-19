/*
 * Flujos de revisión administrables — el mismo hueco que tenía RBAC, cerrado con el mismo
 * patrón: crear/editar/desactivar un flujo (y sus veredictos) hoy exige una migración SQL; esto
 * lo lleva a una RPC de escritura + un panel en Administración.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────────────
 *
 * `js/revisiones.js` (candidatosDe, estaPendiente, revisar) no se toca: las condiciones de
 * ELEGIBILIDAD de cada flujo dependen de la forma del árbol de la visita, no de una preferencia
 * administrable, y siguen en código a propósito. Lo que se vuelve administrable es el CATÁLOGO
 * de flujos y sus veredictos — exactamente lo que ya era dato en `pdt_flujos_revision`.
 *
 * ── Por qué las mismas guardas que RBAC ──────────────────────────────────────────────
 *
 * La PWA solo tiene la clave anónima. Todo esto es `security definer`, revocado a
 * `anon`/`authenticated`, y solo Apps Script —con la clave de servicio— puede llamarlo, con la
 * identidad ya verificada por Google. Administrar flujos de revisión concede indirectamente
 * quién puede calificar visitas y actividades; es tan sensible como administrar roles, así que
 * reutiliza `pdt_exige_admin` sin cambiarlo.
 */

-- ---------- limpieza: el ámbito 'evidencia' es un valor fantasma ----------
--
-- El CHECK permitía 'visita'|'actividad'|'evidencia', pero ningún código entiende 'evidencia'
-- como ámbito: `candidatosDe` en js/revisiones.js solo distingue `flujo.ambito === 'visita'` de
-- cualquier otra cosa, que trata como actividad. 'evidencia' es el nombre de un FLUJO
-- (ambito='actividad'), no un ambito real. Se confirmó antes de escribir esto que ninguna fila
-- lo usa.

alter table pdt_flujos_revision drop constraint if exists pdt_flujos_revision_ambito_check;
alter table pdt_flujos_revision add constraint pdt_flujos_revision_ambito_check
    check (ambito in ('visita', 'actividad'));

-- ---------- lectura para administración ----------

/*
 * Todos los flujos (activos e inactivos, a diferencia de `pdt_flujos_activos`), con cuántas
 * revisiones tiene cada uno — es lo que decide si la pantalla deja borrarlo o solo desactivarlo.
 */
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
        'revisiones', (select count(*) from pdt_revisiones r where r.flujo = f.clave)
    ) order by f.orden, f.clave), '[]'::jsonb)
    from pdt_flujos_revision f
$$;

-- ---------- escritura ----------

/*
 * Crea o actualiza un flujo. Carga esperada:
 *   { clave, nombre, descripcion, ambito, permiso, activo, orden, resultados }
 *
 * `resultados` viaja tal cual: el CHECK de forma que ya existe en la tabla
 * (`pdt_flujos_resultados_forma`, de `20260719_pdt_resultados_por_flujo.sql`) rechaza uno mal
 * formado —sin `valor` o `etiqueta`— con un error que Apps Script propaga tal cual.
 */
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

    insert into pdt_flujos_revision (clave, nombre, descripcion, ambito, permiso, activo, orden, resultados)
    values (
        v_clave,
        coalesce(nullif(trim(p_flujo->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_flujo->>'descripcion'), ''),
        v_ambito,
        v_permiso,
        v_activo,
        coalesce((p_flujo->>'orden')::int, 0),
        p_flujo->'resultados'
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            ambito      = excluded.ambito,
            permiso     = excluded.permiso,
            activo      = excluded.activo,
            orden       = excluded.orden,
            resultados  = excluded.resultados;

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $$;

/*
 * Borra un flujo. Solo si nadie lo ha usado todavía: con revisiones ya guardadas, borrarlo
 * dejaría ese histórico apuntando a un flujo que ya no existe (la FK lo impediría de todos
 * modos, pero este mensaje explica qué hacer en vez de devolver un error de integridad crudo).
 */
create or replace function pdt_flujo_eliminar(p_actor text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_clave text := lower(trim(coalesce(p_clave, '')));
    v_usos  int;
begin
    select count(*) into v_usos from pdt_revisiones where flujo = v_clave;

    if v_usos > 0 then
        raise exception 'El flujo "%" ya tiene % revisión(es) guardadas; desactívalo en vez de '
                        'borrarlo para conservar el histórico.', v_clave, v_usos;
    end if;

    delete from pdt_flujos_revision where clave = v_clave;

    return jsonb_build_object('clave', v_clave, 'borrado', true);
end $$;

-- ---------- permisos de ejecución ----------

revoke execute on function pdt_flujos_revision_admin()        from public, anon, authenticated;
revoke execute on function pdt_flujo_guardar(text, jsonb)     from public, anon, authenticated;
revoke execute on function pdt_flujo_eliminar(text, text)     from public, anon, authenticated;

grant execute on function pdt_flujos_revision_admin()          to service_role;
grant execute on function pdt_flujo_guardar(text, jsonb)       to service_role;
grant execute on function pdt_flujo_eliminar(text, text)       to service_role;
