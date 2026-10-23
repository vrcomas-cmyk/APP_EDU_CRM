-- Estrategias: nunca se borran (se archivan), son de solo lectura una vez guardadas y solo
-- avanzan la etapa y el estatus, con cada cambio en la línea de tiempo.

alter table pdt_estrategias add column if not exists archivada boolean not null default false;
alter table pdt_estrategias add column if not exists archivada_en timestamptz;
alter table pdt_estrategias add column if not exists archivada_por text;
alter table pdt_estrategias add column if not exists productos_archivados jsonb not null default '[]'::jsonb;

-- La línea de tiempo registra también el estatus. Cada fila es una foto de (etapa, estatus).
alter table pdt_estrategia_etapas add column if not exists estatus text;
alter table pdt_estrategia_etapas alter column etapa drop not null;

/*
 * Upsert de estrategias.
 *  - Estrategia NUEVA: se inserta completa.
 *  - Estrategia EXISTENTE: solo se actualizan etapa, estatus, archivo y productos archivados.
 *    Todo lo demás es de solo lectura y se ignora aunque el cliente lo mande.
 * Se registra un tránsito cuando cambia la etapa o el estatus (nota opcional en `nota_avance`).
 */
create or replace function pdt_estrategias_guardar_sesion(p_sesion_token text, p_estrategias jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_correo   text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre   text;
    e          jsonb;
    v_existe   boolean;
    v_etapa_p  text;
    v_estatus_p text;
    v_etapa    text;
    v_estatus  text;
    v_archivada boolean;
    n          int := 0;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;

    for e in select * from jsonb_array_elements(coalesce(p_estrategias, '[]'::jsonb))
    loop
        continue when coalesce(e->>'id', '') = '' or coalesce(e->>'cliente', '') = '';

        select true, etapa, estatus into v_existe, v_etapa_p, v_estatus_p
        from pdt_estrategias where id = e->>'id';
        v_existe := coalesce(v_existe, false);

        v_etapa     := nullif(trim(e->>'etapa'), '');
        v_estatus   := coalesce(nullif(trim(e->>'estatus'), ''), 'Pendiente');
        v_archivada := coalesce((e->>'archivada')::boolean, false);

        if not v_existe then
            insert into pdt_estrategias (
                id, cliente, sector, grupo_articulo, tipo_estrategia, descripcion, etapa, estatus,
                proyecto, productos, observaciones, archivada, archivada_en, archivada_por,
                productos_archivados, actualizado, actualizado_por, actualizado_correo
            ) values (
                e->>'id', trim(e->>'cliente'), nullif(e->>'sector', ''),
                nullif(e->>'grupo_articulo', ''), nullif(e->>'tipo_estrategia', ''),
                nullif(e->>'descripcion', ''), v_etapa, v_estatus,
                nullif(e->>'proyecto', ''),
                case when jsonb_typeof(e->'productos') = 'array' then e->'productos' else null end,
                nullif(e->>'observaciones', ''),
                v_archivada, case when v_archivada then now() end,
                case when v_archivada then coalesce(v_nombre, v_correo) end,
                case when jsonb_typeof(e->'productos_archivados') = 'array'
                     then e->'productos_archivados' else '[]'::jsonb end,
                now(), coalesce(nullif(e->>'actualizado_por', ''), v_nombre, v_correo), v_correo
            );

            insert into pdt_estrategia_etapas (id_estrategia, etapa, estatus, actor_correo, actor_nombre, nota)
            values (e->>'id', v_etapa, v_estatus, v_correo, v_nombre, nullif(e->>'nota_avance', ''));
        else
            update pdt_estrategias set
                etapa    = v_etapa,
                estatus  = v_estatus,
                archivada = v_archivada,
                archivada_en  = case when v_archivada and not archivada then now()
                                     when v_archivada then archivada_en end,
                archivada_por = case when v_archivada and not archivada then coalesce(v_nombre, v_correo)
                                     when v_archivada then archivada_por end,
                productos_archivados = case when jsonb_typeof(e->'productos_archivados') = 'array'
                                            then e->'productos_archivados' else productos_archivados end,
                actualizado = now(),
                actualizado_por = coalesce(v_nombre, v_correo),
                actualizado_correo = v_correo
            where id = e->>'id';

            if v_etapa is distinct from v_etapa_p or v_estatus is distinct from v_estatus_p then
                insert into pdt_estrategia_etapas (id_estrategia, etapa, estatus, actor_correo, actor_nombre, nota)
                values (e->>'id', coalesce(v_etapa, v_etapa_p), v_estatus, v_correo, v_nombre,
                        nullif(e->>'nota_avance', ''));
            end if;
        end if;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'guardadas', n);
end;
$$;

-- Ya no se borra: se archiva.
create or replace function pdt_estrategia_eliminar(p_sesion_token text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    raise exception 'Las estrategias no se eliminan: archívala o ciérrala.';
end;
$$;

revoke execute on function pdt_estrategia_eliminar(text, text) from public, anon, authenticated;

-- Volátil, como la dejó 20260929_pdt_lecturas_sesion_volatiles.
create or replace function pdt_estrategias_leer_sesion(p_sesion_token text)
returns jsonb
language sql
volatile
security definer
set search_path = public
as $$
    with sesion as (select pdt_correo_de_sesion(p_sesion_token) as correo)
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'cliente', e.cliente, 'sector', e.sector,
        'grupo_articulo', e.grupo_articulo, 'tipo_estrategia', e.tipo_estrategia,
        'descripcion', e.descripcion, 'estatus', e.estatus,
        'etapa', e.etapa, 'proyecto', e.proyecto,
        'productos', coalesce(e.productos, '[]'::jsonb),
        'observaciones', e.observaciones,
        'archivada', e.archivada, 'archivada_en', e.archivada_en, 'archivada_por', e.archivada_por,
        'productos_archivados', coalesce(e.productos_archivados, '[]'::jsonb),
        'actualizado', e.actualizado, 'actualizado_por', e.actualizado_por,
        'actualizado_correo', e.actualizado_correo,
        'etapas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'etapa', h.etapa, 'estatus', h.estatus, 'momento', h.momento,
                'actor_correo', h.actor_correo, 'actor_nombre', h.actor_nombre, 'nota', h.nota
            ) order by h.momento, h.seq)
            from pdt_estrategia_etapas h where h.id_estrategia = e.id
        ), '[]'::jsonb)
    ) order by e.cliente, e.sector), '[]'::jsonb)
    from pdt_estrategias e, sesion
    where sesion.correo is not null;
$$;
