-- Plan de Trabajo — módulo Pendientes.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Qué quedó por resolver de una visita ("le prometí mandarle tal ficha técnica", "falta que
-- Compras confirme el pedido"): se ofrece al hacer check-out y se sigue viendo después como su
-- propia lista, sin tener que reabrir la visita que lo originó.
--
-- Mismo patrón "sesión directa" que `pdt_visitas_guardar_sesion`/`pdt_estrategias_guardar_sesion`
-- (20260825_pdt_supabase_primero.sql / 20260925b_pdt_estrategias_supabase.sql): la PWA llama
-- estas funciones DIRECTO con la clave anónima, y la identidad se resuelve DENTRO de Postgres a
-- partir del token de sesión — nunca se confía en un correo que mande el cliente. A diferencia
-- de Estrategias (una referencia PLANA que ve todo el equipo por igual), un Pendiente SÍ tiene
-- alcance por jerarquía — como las visitas — porque nace de una visita de alguien en concreto:
-- un gerente ve los de su equipo, no los de toda la instalación.

-- ---------- pdt_pendientes ----------

create table if not exists pdt_pendientes (
    id              text primary key,
    id_visita       text,
    cliente         text,
    hospital        text,
    descripcion     text not null,
    estado          text not null default 'abierto' check (estado in ('abierto', 'resuelto')),
    creado_por      text,
    creado_correo   text not null,
    creado_en       timestamptz not null default now(),
    resuelto_en     timestamptz,
    resuelto_por    text,
    resuelto_correo text
);

create index if not exists pdt_pendientes_creado_correo_idx on pdt_pendientes (creado_correo);
create index if not exists pdt_pendientes_estado_idx on pdt_pendientes (estado);

alter table pdt_pendientes enable row level security;
-- Sin políticas a propósito, mismo criterio que el resto del espejo: el acceso real pasa por
-- las funciones `security definer` de abajo, nunca directo con la clave anónima.

-- ---------- guardar: crear un pendiente, o marcarlo resuelto/reabrirlo ----------

/*
 * `p_pendientes` es un arreglo (mismo patrón por lotes que `pdt_estrategias_guardar_sesion`,
 * para que un dispositivo offline pueda crear un pendiente en el checkout y marcarlo resuelto
 * después SIN depender de la red en ninguno de los dos momentos — ambos quedan en cola local y
 * se suben con el mismo ciclo de sync que ya usan visitas/estrategias).
 *
 * `creado_correo`/`creado_por`/`creado_en` NUNCA se tocan en un conflicto: son el origen del
 * pendiente y no cambian porque alguien más (quien sea que lo resuelva) lo vuelva a guardar.
 * `resuelto_*` sí se recalculan en cada guardado a partir de `estado`, con la identidad de
 * QUIEN ESTÁ GUARDANDO AHORA (`v_correo`), nunca de lo que mande el cuerpo — igual que
 * `actualizado_correo` en Estrategias.
 */
create or replace function pdt_pendientes_guardar_sesion(p_sesion_token text, p_pendientes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
    p        jsonb;
    v_estado text;
    n        int := 0;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;

    for p in select * from jsonb_array_elements(coalesce(p_pendientes, '[]'::jsonb))
    loop
        continue when coalesce(p->>'id', '') = '' or coalesce(trim(p->>'descripcion'), '') = '';

        v_estado := case when p->>'estado' = 'resuelto' then 'resuelto' else 'abierto' end;

        insert into pdt_pendientes (
            id, id_visita, cliente, hospital, descripcion, estado,
            creado_por, creado_correo, creado_en,
            resuelto_en, resuelto_por, resuelto_correo
        ) values (
            p->>'id', nullif(p->>'id_visita', ''), nullif(p->>'cliente', ''), nullif(p->>'hospital', ''),
            trim(p->>'descripcion'), v_estado,
            coalesce(nullif(p->>'creado_por', ''), v_nombre, v_correo), v_correo, now(),
            case when v_estado = 'resuelto' then now() else null end,
            case when v_estado = 'resuelto' then coalesce(v_nombre, v_correo) else null end,
            case when v_estado = 'resuelto' then v_correo else null end
        )
        on conflict (id) do update set
            descripcion     = excluded.descripcion,
            estado          = v_estado,
            resuelto_en     = case when v_estado = 'resuelto'
                                    then coalesce(pdt_pendientes.resuelto_en, now()) else null end,
            resuelto_por    = case when v_estado = 'resuelto'
                                    then coalesce(pdt_pendientes.resuelto_por, v_nombre, v_correo) else null end,
            resuelto_correo = case when v_estado = 'resuelto'
                                    then coalesce(pdt_pendientes.resuelto_correo, v_correo) else null end;

        n := n + 1;
    end loop;

    return jsonb_build_object('status', 'ok', 'guardados', n);
end;
$$;

-- ---------- leer en alcance: los de mi equipo (como las visitas) ----------

create or replace function pdt_pendientes_equipo_sesion(
    p_sesion_token text, p_estado text default null, p_limite int default 500
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_todas  boolean := pdt_es_admin(v_correo);
begin
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', pe.id, 'id_visita', pe.id_visita, 'cliente', pe.cliente, 'hospital', pe.hospital,
            'descripcion', pe.descripcion, 'estado', pe.estado,
            'creado_por', pe.creado_por, 'creado_correo', pe.creado_correo, 'creado_en', pe.creado_en,
            'resuelto_en', pe.resuelto_en, 'resuelto_por', pe.resuelto_por, 'resuelto_correo', pe.resuelto_correo
        ) order by pe.creado_en desc)
        from pdt_pendientes pe
        where (v_todas or pe.creado_correo in (select correo from pdt_alcance(v_correo)))
          and (p_estado is null or pe.estado = p_estado)
        limit greatest(1, least(coalesce(p_limite, 500), 2000))
    ), '[]'::jsonb);
end;
$$;

-- ---------- permisos de ejecución ----------

revoke execute on function pdt_pendientes_guardar_sesion(text, jsonb)      from public;
revoke execute on function pdt_pendientes_equipo_sesion(text, text, int)   from public;

grant execute on function pdt_pendientes_guardar_sesion(text, jsonb)      to anon, authenticated, service_role;
grant execute on function pdt_pendientes_equipo_sesion(text, text, int)   to anon, authenticated, service_role;

-- ---------- capacidad del módulo (quién lo ve en el riel) ----------
--
-- Misma distribución que `estrategias.ver` (20260727c_pdt_capacidades_modulos.sql): quien hace
-- visitas de campo (administrador, gerente, educador). Analista no captura visitas ni hace
-- checkout, así que no tiene nada que crear aquí — igual que hoy no tiene `estrategias.ver`.

insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('pendientes.ver', 'pendientes', 'ver', 'Ver Pendientes',
     'Entrar a lo que quedó por resolver de una visita, y marcarlo resuelto.',
     'Pendientes', 810)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

insert into pdt_permisos (rol, modulo, accion) values
    ('administrador', 'pendientes', 'ver'),
    ('gerente', 'pendientes', 'ver'),
    ('educador', 'pendientes', 'ver')
on conflict (rol, modulo, accion) do nothing;
