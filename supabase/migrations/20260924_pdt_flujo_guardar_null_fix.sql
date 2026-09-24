/*
 * Fix: no se podía poner un flujo en Inactivo (ni guardar Flujos en general) cuando el lote
 * incluía algún flujo SIN veredictos propios.
 *
 * `guardarFlujos` (apps-script/Codigo.gs) reenvía TODOS los flujos en cada guardado, y los que
 * no tienen veredictos propios viajan con `"resultados": null` EXPLÍCITO en el JSON (ver
 * `borradorFlujos.ts`). `pdt_flujo_guardar` (20260719f_pdt_flujos_administrables.sql) hacía
 * `p_flujo->'resultados'` — el operador `->` sobre una clave con valor JSON null devuelve el
 * jsonb ESCALAR `null`, no SQL NULL. El CHECK `pdt_flujos_resultados_forma`
 * (`resultados is null or (...)`) evalúa `is null` como FALSO para ese escalar, cae a la
 * segunda rama, y `jsonb_typeof('null'::jsonb) = 'array'` también es falso → el insert/update
 * viola el constraint. Como `guardarFlujos` para en el primer error, esto rompía cualquier
 * cambio (incluido activar/desactivar) en cuanto el lote tocaba un flujo sin veredictos propios.
 *
 * Fix: `nullif(p_flujo->'resultados', 'null'::jsonb)` convierte ese jsonb null en SQL NULL
 * antes de guardarlo, que es lo que el CHECK y el resto del código ya esperaban.
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
        nullif(p_flujo->'resultados', 'null'::jsonb)
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
