-- Estrategias: "Finalizado" y "Cerrado" dejan de ser etapas/estatus y pasan a ser el DESENLACE
-- con que se archiva una estrategia (con comentario obligatorio). Se agrega el valor mensual
-- (opcional) y se evita el bloqueo de la fila de sesión que provocaba timeouts en las RPC.

alter table pdt_estrategias add column if not exists desenlace text
    check (desenlace is null or desenlace in ('finalizado', 'cerrado'));
alter table pdt_estrategias add column if not exists desenlace_comentario text;
alter table pdt_estrategias add column if not exists desenlace_en timestamptz;
alter table pdt_estrategias add column if not exists desenlace_por text;
alter table pdt_estrategias add column if not exists valor_mensual numeric(14,2);

-- ---------- catálogos: fuera Finalizado/Cerrado ----------
-- Ninguna estrategia vigente los usaba al momento de escribir esto; por si alguna los trae, se
-- convierten en archivadas con ese desenlace antes de quitarlos.

update pdt_estrategias set
    desenlace = lower(etapa), desenlace_en = coalesce(actualizado, now()),
    desenlace_por = actualizado_por, archivada = true,
    archivada_en = coalesce(archivada_en, now()), archivada_por = coalesce(archivada_por, actualizado_por)
where lower(etapa) in ('finalizado', 'cerrado') and desenlace is null;

delete from pdt_etapas where clave in ('finalizado', 'cerrado');
delete from pdt_estrategia_estatus where clave in ('finalizado', 'cerrado');

-- ---------- sesión: la marca de "último uso" ya no bloquea ----------
-- Cada RPC pasa por aquí; actualizar siempre la misma fila hacía que las descargas en paralelo
-- se esperaran entre sí hasta el statement_timeout del rol anónimo (3 s).

create or replace function pdt_correo_de_sesion(p_sesion_token text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_hash   text;
    v_correo text;
begin
    if coalesce(p_sesion_token, '') = '' then
        raise exception 'Sesión no reconocida' using errcode = '28000';
    end if;

    v_hash := encode(digest(p_sesion_token, 'sha256'), 'hex');

    select s.correo into v_correo from pdt_sesiones s where s.sesion_hash = v_hash;

    if v_correo is null then
        raise exception 'Sesión no reconocida' using errcode = '28000';
    end if;

    -- Solo si hace falta y sin esperar: si otra petición ya tiene la fila, ella la actualiza.
    if exists (select 1 from pdt_sesiones
               where sesion_hash = v_hash and ultimo_uso < now() - interval '5 minutes') then
        perform 1 from pdt_sesiones where sesion_hash = v_hash for update skip locked;
        if found then
            update pdt_sesiones set ultimo_uso = now() where sesion_hash = v_hash;
        end if;
    end if;

    return v_correo;
end;
$$;

-- Escribe en pdt_sesiones (vía pdt_correo_de_sesion): no puede ser `stable`.
alter function pdt_visitas_equipo_sesion(text, date, date, integer) volatile;

-- ---------- guardar ----------
-- Estrategia NUEVA: se inserta completa (valor mensual incluido).
-- Estrategia EXISTENTE: solo cambian etapa, estatus, archivo/desenlace, productos archivados y,
-- si quien guarda es administrador, el valor mensual. Cada cambio queda en la bitácora.

create or replace function pdt_estrategias_guardar_sesion(p_sesion_token text, p_estrategias jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_correo    text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre    text;
    v_admin     boolean;
    e           jsonb;
    v_existe    boolean;
    v_etapa_p   text;
    v_estatus_p text;
    v_valor_p   numeric;
    v_etapa     text;
    v_estatus   text;
    v_valor     numeric;
    v_archivada boolean;
    v_desenlace text;
    v_nota      text;
    n           int := 0;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;
    v_admin := pdt_es_admin(v_correo);

    for e in select * from jsonb_array_elements(coalesce(p_estrategias, '[]'::jsonb))
    loop
        continue when coalesce(e->>'id', '') = '' or coalesce(e->>'cliente', '') = '';

        select true, etapa, estatus, valor_mensual into v_existe, v_etapa_p, v_estatus_p, v_valor_p
        from pdt_estrategias where id = e->>'id';
        v_existe := coalesce(v_existe, false);

        v_etapa     := nullif(trim(e->>'etapa'), '');
        v_estatus   := coalesce(nullif(trim(e->>'estatus'), ''), 'Pendiente');
        v_archivada := coalesce((e->>'archivada')::boolean, false);
        v_desenlace := case when e->>'desenlace' in ('finalizado', 'cerrado') then e->>'desenlace' end;
        v_valor     := nullif(e->>'valor_mensual', '')::numeric;
        v_nota      := nullif(trim(coalesce(e->>'nota_evento', '')), '');

        if not v_existe then
            insert into pdt_estrategias (
                id, cliente, sector, grupo_articulo, tipo_estrategia, descripcion, etapa, estatus,
                proyecto, productos, observaciones, valor_mensual, archivada, archivada_en, archivada_por,
                desenlace, desenlace_comentario, desenlace_en, desenlace_por,
                productos_archivados, actualizado, actualizado_por, actualizado_correo
            ) values (
                e->>'id', trim(e->>'cliente'), nullif(e->>'sector', ''),
                nullif(e->>'grupo_articulo', ''), nullif(e->>'tipo_estrategia', ''),
                nullif(e->>'descripcion', ''), v_etapa, v_estatus,
                nullif(e->>'proyecto', ''),
                case when jsonb_typeof(e->'productos') = 'array' then e->'productos' else null end,
                nullif(e->>'observaciones', ''), v_valor,
                v_archivada, case when v_archivada then now() end,
                case when v_archivada then coalesce(v_nombre, v_correo) end,
                v_desenlace, nullif(e->>'desenlace_comentario', ''),
                case when v_desenlace is not null then now() end,
                case when v_desenlace is not null then coalesce(v_nombre, v_correo) end,
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
                desenlace = case when v_archivada then v_desenlace end,
                desenlace_comentario = case when v_archivada and v_desenlace is not null
                                            then nullif(e->>'desenlace_comentario', '') end,
                desenlace_en  = case when v_archivada and v_desenlace is not null
                                     then coalesce(desenlace_en, now()) end,
                desenlace_por = case when v_archivada and v_desenlace is not null
                                     then coalesce(desenlace_por, v_nombre, v_correo) end,
                valor_mensual = case when v_admin then v_valor else valor_mensual end,
                productos_archivados = case when jsonb_typeof(e->'productos_archivados') = 'array'
                                            then e->'productos_archivados' else productos_archivados end,
                actualizado = now(),
                actualizado_por = coalesce(v_nombre, v_correo),
                actualizado_correo = v_correo
            where id = e->>'id';

            if v_etapa is distinct from v_etapa_p or v_estatus is distinct from v_estatus_p
               or v_nota is not null then
                insert into pdt_estrategia_etapas (id_estrategia, etapa, estatus, actor_correo, actor_nombre, nota)
                values (e->>'id', coalesce(v_etapa, v_etapa_p), v_estatus, v_correo, v_nombre,
                        coalesce(v_nota, nullif(e->>'nota_avance', '')));
            end if;
        end if;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'guardadas', n);
end;
$$;

-- ---------- leer ----------
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
        'valor_mensual', e.valor_mensual,
        'archivada', e.archivada, 'archivada_en', e.archivada_en, 'archivada_por', e.archivada_por,
        'desenlace', e.desenlace, 'desenlace_comentario', e.desenlace_comentario,
        'desenlace_en', e.desenlace_en, 'desenlace_por', e.desenlace_por,
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
