CREATE OR REPLACE FUNCTION public.pdt_aceptar_invitacion(p_correo text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    update pdt_invitaciones
       set estado = 'aceptada', aceptada_en = coalesce(aceptada_en, now())
     where lower(correo) = lower(trim(p_correo))
       and estado = 'pendiente'
    returning true;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_alcance(p_correo text)
 RETURNS TABLE(correo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with recursive baja as (
        select lower(trim(p_correo)) as correo
        union
        select j.subordinado
        from pdt_jerarquia j
        join baja b on lower(j.jefe) = b.correo
    )
    select distinct baja.correo from baja
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_calendar_compromisos_en_alcance(p_correo text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_todas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_calendar_compromisos_guardar(p_correo text, p_compromisos jsonb, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_hasta timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_capacidades_admin()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', c.clave, 'modulo', c.modulo, 'accion', c.accion,
        'nombre', c.nombre, 'descripcion', c.descripcion, 'grupo', c.grupo, 'orden', c.orden
    ) order by c.orden, c.clave), '[]'::jsonb)
    from pdt_capacidades c
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_capacidades_de(p_correo text)
 RETURNS TABLE(clave text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with yo as (select lower(trim(p_correo)) as correo),
    roles as (
        select ur.rol from pdt_usuario_roles ur, yo where lower(trim(ur.correo)) = yo.correo
        union
        select u.rol from pdt_usuarios u, yo
         where lower(trim(u.correo)) = yo.correo and u.activo and u.rol is not null
        union
        select i.rol from pdt_invitaciones i, yo
         where lower(trim(i.correo)) = yo.correo
           and i.estado in ('pendiente', 'aceptada') and i.rol is not null
    )
    select distinct c.clave
    from roles r
    join pdt_roles rr on rr.clave = r.rol and rr.activo
    cross join lateral pdt_rol_capacidades(r.rol) c
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_catalogos_guardar(p_publicado_por text, p_catalogos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_clave text;
    n int := 0;
begin
    for v_clave in select jsonb_object_keys(coalesce(p_catalogos, '{}'::jsonb))
    loop
        insert into pdt_catalogos (clave, valor, publicado_por, actualizado)
        values (v_clave, p_catalogos->v_clave, p_publicado_por, now())
        on conflict (clave) do update
            set valor = excluded.valor,
                publicado_por = excluded.publicado_por,
                actualizado = excluded.actualizado;

        n := n + 1;
    end loop;

    return jsonb_build_object('secciones', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_cliente_excepcion_agregar(p_actor text, p_cliente text, p_educador_correo text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor   text := pdt_exige_admin(p_actor);
    v_cliente text := trim(coalesce(p_cliente, ''));
    v_correo  text := lower(trim(coalesce(p_educador_correo, '')));
    v_id      uuid;
begin
    if v_cliente = '' then
        raise exception 'Falta el cliente.';
    end if;
    if v_correo = '' or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'El correo "%" no parece válido.', coalesce(v_correo, '');
    end if;
    if p_hasta is not null and p_hasta < coalesce(p_desde, now()) then
        raise exception 'La excepción no puede terminar antes de empezar.';
    end if;

    insert into pdt_cliente_excepcion (cliente, educador_correo, desde, hasta, motivo, creado_por)
    values (v_cliente, v_correo, coalesce(p_desde, now()), p_hasta, nullif(trim(p_motivo), ''), v_actor)
    returning id into v_id;

    return jsonb_build_object('id', v_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_cliente_excepcion_quitar(p_actor text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor text := pdt_exige_admin(p_actor);
begin
    delete from pdt_cliente_excepcion where id = p_id;
    return jsonb_build_object('id', p_id, 'quitado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_clientes_extra_de(p_correo text)
 RETURNS TABLE(cliente text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select cliente from pdt_cliente_excepcion
     where lower(trim(educador_correo)) = lower(trim(p_correo))
       and now() >= desde
       and (hasta is null or now() <= hasta)
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_cobertura_agregar(p_actor text, p_zona text, p_educador_correo text, p_desde timestamp with time zone, p_hasta timestamp with time zone, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor  text := pdt_exige_admin(p_actor);
    v_zona   text := trim(coalesce(p_zona, ''));
    v_correo text := lower(trim(coalesce(p_educador_correo, '')));
    v_id     uuid;
begin
    if v_zona = '' then
        raise exception 'Falta la zona.';
    end if;
    if v_correo = '' or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'El correo "%" no parece válido.', coalesce(v_correo, '');
    end if;
    if p_hasta is not null and p_hasta < coalesce(p_desde, now()) then
        raise exception 'La cobertura no puede terminar antes de empezar.';
    end if;

    insert into pdt_zona_cobertura (zona, educador_correo, desde, hasta, motivo, creado_por)
    values (v_zona, v_correo, coalesce(p_desde, now()), p_hasta, nullif(trim(p_motivo), ''), v_actor)
    returning id into v_id;

    return jsonb_build_object('id', v_id);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_cobertura_quitar(p_actor text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor text := pdt_exige_admin(p_actor);
begin
    delete from pdt_zona_cobertura where id = p_id;
    return jsonb_build_object('id', p_id, 'quitado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_comentarios_guardar(p_usuario_correo text, p_usuario text, p_comentarios jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    c jsonb;
    n int := 0;
begin
    for c in select * from jsonb_array_elements(coalesce(p_comentarios, '[]'::jsonb))
    loop
        -- Un comentario sin texto no dice nada y ensuciaría el hilo.
        if coalesce(c->>'id', '') = '' or coalesce(trim(c->>'texto'), '') = '' then
            continue;
        end if;

        insert into pdt_comentarios (
            id, ambito, id_ambito, id_visita, cliente, hospital,
            texto, usuario, usuario_correo, momento
        ) values (
            c->>'id',
            coalesce(c->>'ambito', ''),
            coalesce(c->>'id_ambito', ''),
            nullif(c->>'id_visita', ''),
            nullif(c->>'cliente', ''),
            nullif(c->>'hospital', ''),
            c->>'texto',
            coalesce(nullif(p_usuario, ''), c->>'usuario'),
            p_usuario_correo,
            nullif(c->>'momento', '')::timestamptz
        )
        on conflict (id) do nothing;

        n := n + case when found then 1 else 0 end;
    end loop;

    return jsonb_build_object('insertados', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_correo_de_sesion(p_sesion_token text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

    update pdt_sesiones set ultimo_uso = now() where sesion_hash = v_hash;

    return v_correo;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_es_admin(p_correo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1 from pdt_admins where correo = lower(trim(p_correo))
    ) or pdt_puede(p_correo, 'administracion.configurar');
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_espejo_guardar(p_correo text, p_visitas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v      jsonb;
    s      jsonb;
    a      jsonb;
    m      jsonb;
    n_vis  int := 0;
    t_in   timestamptz;
    t_out  timestamptz;
begin
    for v in select * from jsonb_array_elements(coalesce(p_visitas, '[]'::jsonb))
    loop
        t_in  := nullif(v#>>'{check_in,momento}', '')::timestamptz;
        t_out := nullif(v#>>'{check_out,momento}', '')::timestamptz;

        insert into pdt_visitas (
            id, educador_correo, educador, cliente, hospital, dia, hora_inicio, hora_fin,
            estado, motivo_cancelacion, reagendas,
            check_in_momento, check_in_lat, check_in_lng, check_out_momento,
            permanencia_min, actualizado,
            zona, ejecutivo, notas, id_estrategia,
            tipo, motivo, es_prospecto,
            -- Vacío no borra: mismo criterio que ya usa `upsert()` en Apps Script para
            -- checkin_direccion/checkout_direccion — un dispositivo que aún no conoce el id no
            -- debe tirar el que ya escribió otro.
            calendar_event_id
        ) values (
            v->>'id',
            lower(coalesce(nullif(v->>'educador_correo', ''), p_correo)),
            v->>'educador', v->>'cliente', v->>'hospital',
            nullif(v->>'dia', '')::date, v->>'hora_inicio', v->>'hora_fin',
            v->>'estado', v->>'motivo_cancelacion',
            coalesce(jsonb_array_length(v->'reagendas'), 0),
            t_in,
            nullif(v#>>'{check_in,lat}', '')::double precision,
            nullif(v#>>'{check_in,lng}', '')::double precision,
            t_out,
            case when t_in is not null and t_out is not null and t_out >= t_in
                 then (extract(epoch from (t_out - t_in)) / 60)::int end,
            now(),
            v->>'zona', v->>'ejecutivo', v->>'notas', v->>'id_estrategia',
            coalesce(nullif(v->>'tipo', ''), 'cliente'), v->>'motivo',
            coalesce((v->>'es_prospecto')::boolean, false),
            nullif(v->>'calendar_event_id', '')
        )
        on conflict (id) do update set
            educador_correo = excluded.educador_correo,
            educador = excluded.educador,
            cliente = excluded.cliente,
            hospital = excluded.hospital,
            dia = excluded.dia,
            hora_inicio = excluded.hora_inicio,
            hora_fin = excluded.hora_fin,
            estado = excluded.estado,
            motivo_cancelacion = excluded.motivo_cancelacion,
            reagendas = excluded.reagendas,
            check_in_momento = excluded.check_in_momento,
            check_in_lat = excluded.check_in_lat,
            check_in_lng = excluded.check_in_lng,
            check_out_momento = excluded.check_out_momento,
            permanencia_min = excluded.permanencia_min,
            actualizado = now(),
            zona = excluded.zona,
            ejecutivo = excluded.ejecutivo,
            notas = excluded.notas,
            id_estrategia = excluded.id_estrategia,
            tipo = excluded.tipo,
            motivo = excluded.motivo,
            es_prospecto = excluded.es_prospecto,
            calendar_event_id = coalesce(excluded.calendar_event_id, pdt_visitas.calendar_event_id);

        delete from pdt_sectores where id_visita = v->>'id';

        for s in select * from jsonb_array_elements(coalesce(v->'sectores', '[]'::jsonb))
        loop
            insert into pdt_sectores (
                id, id_visita, nombre, objetivo, origen, solicitado_por,
                guardado_momento, guardado_usuario
            ) values (
                s->>'id', v->>'id', s->>'nombre', s->>'objetivo',
                (select string_agg(x, ', ') from jsonb_array_elements_text(
                    case when jsonb_typeof(s->'origen') = 'array'
                         then s->'origen' else '[]'::jsonb end) x),
                s->>'solicitado_por',
                nullif(s#>>'{guardado,momento}', '')::timestamptz,
                s#>>'{guardado,usuario}'
            );

            for a in select * from jsonb_array_elements(coalesce(s->'actividades', '[]'::jsonb))
            loop
                continue when a->'guardada' is null;

                insert into pdt_actividades (
                    id, id_sector, id_visita, tipo, area_visitada,
                    contacto_nombre, contacto_cargo, contacto_servicio, fecha_documento,
                    evidencia_estado, evidencia_url, evidencia_tipo,
                    guardada_momento, guardada_usuario
                ) values (
                    a->>'id', s->>'id', v->>'id', a->>'tipo', a->>'area_visitada',
                    a#>>'{contacto,nombre}', a#>>'{contacto,cargo}', a#>>'{contacto,servicio}',
                    nullif(a->>'fecha_documento', '')::date,
                    a#>>'{evidencia,estado}', a#>>'{evidencia,url}', a#>>'{evidencia,tipo}',
                    nullif(a#>>'{guardada,momento}', '')::timestamptz,
                    a#>>'{guardada,usuario}'
                );

                for m in select * from jsonb_array_elements(coalesce(a->'materiales', '[]'::jsonb))
                loop
                    insert into pdt_materiales (
                        id, id_actividad, id_visita, material, cantidad, unidad, origen
                    ) values (
                        m->>'id', a->>'id', v->>'id', m->>'material',
                        case when (m->>'cantidad') ~ '^[0-9]+(\.[0-9]+)?$'
                             then (m->>'cantidad')::numeric else null end,
                        m->>'unidad', m->>'origen'
                    );
                end loop;
            end loop;
        end loop;

        n_vis := n_vis + 1;
    end loop;

    return jsonb_build_object('ok', true, 'visitas', n_vis);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_eventos_guardar(p_educador_correo text, p_educador text, p_eventos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    e jsonb;
    n int := 0;
begin
    for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb))
    loop
        if coalesce(e->>'id', '') = '' then continue; end if;

        insert into pdt_eventos (
            id, tipo, momento, id_visita, cliente, hospital,
            educador, educador_correo, dispositivo, datos
        ) values (
            e->>'id',
            coalesce(e->>'tipo', ''),
            nullif(e->>'momento', '')::timestamptz,
            nullif(e->>'id_visita', ''),
            nullif(e->>'cliente', ''),
            nullif(e->>'hospital', ''),
            coalesce(nullif(p_educador, ''), e->>'educador'),
            p_educador_correo,
            nullif(e->>'dispositivo', ''),
            coalesce(e->'datos', '{}'::jsonb)
        )
        on conflict (id) do nothing;

        n := n + case when found then 1 else 0 end;
    end loop;

    return jsonb_build_object('insertados', n);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_exige_admin(p_actor text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor text := lower(trim(coalesce(p_actor, '')));
begin
    if v_actor = '' then
        raise exception 'Falta la identidad de quien hace el cambio.';
    end if;

    if pdt_puede(v_actor, 'administracion.configurar')
       or exists (select 1 from pdt_admins a where lower(trim(a.correo)) = v_actor)
    then
        return v_actor;
    end if;

    raise exception 'La cuenta % no puede administrar roles ni usuarios.', v_actor;
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_exige_que_quede_admin()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if exists (select 1 from pdt_admins) then return; end if;

    if exists (
        select 1
        from (
            select lower(trim(correo)) as correo from pdt_usuario_roles
            union
            select lower(trim(correo)) from pdt_usuarios where activo
        ) c
        where pdt_puede(c.correo, 'administracion.configurar')
    ) then
        return;
    end if;

    raise exception
        'Ese cambio dejaría la instalación sin ningún administrador, y nadie podría volver '
        'a entrar a esta pantalla para deshacerlo.';
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_export_confirmar(p_ids text[])
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    delete from pdt_export_cola where id_visita = any(coalesce(p_ids, '{}'::text[]));
    select jsonb_build_object('status', 'ok', 'borradas', coalesce(array_length(p_ids, 1), 0));
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_export_tomar(p_limite integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_filas jsonb;
begin
    with candidatas as (
        select id_visita
        from pdt_export_cola
        where tomado is null or tomado < now() - interval '30 minutes'
        order by encolado
        limit greatest(1, least(coalesce(p_limite, 200), 1000))
        for update skip locked
    ),
    marcadas as (
        update pdt_export_cola c
        set tomado = now()
        from candidatas
        where c.id_visita = candidatas.id_visita
        returning c.id_visita, c.correo, c.nombre, c.payload
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id_visita', id_visita, 'correo', correo, 'nombre', nombre, 'payload', payload
    )), '[]'::jsonb) into v_filas
    from marcadas;

    return v_filas;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_flujo_eliminar(p_actor text, p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_flujo_guardar(p_actor text, p_flujo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_flujos_activos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', clave, 'nombre', nombre, 'descripcion', descripcion,
        'ambito', ambito, 'permiso', permiso, 'orden', orden,
        -- Va tal cual, null incluido: el cliente distingue "sin configurar" —y usa los tres
        -- de siempre— de "configurado", y esa distinción se perdería mandando '[]'.
        'resultados', resultados
    ) order by orden, clave), '[]'::jsonb)
    from pdt_flujos_revision where activo
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_flujos_revision_admin()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', f.clave, 'nombre', f.nombre, 'descripcion', f.descripcion,
        'ambito', f.ambito, 'permiso', f.permiso, 'activo', f.activo, 'orden', f.orden,
        'resultados', f.resultados,
        'revisiones', (select count(*) from pdt_revisiones r where r.flujo = f.clave)
    ) order by f.orden, f.clave), '[]'::jsonb)
    from pdt_flujos_revision f
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_gerente_sector_guardar(p_actor text, p_gerente text, p_sectores jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_gerente_sector_listar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
        'gerente_correo', gs.gerente_correo,
        'sectores', (
            select coalesce(jsonb_agg(x.sector order by x.sector), '[]'::jsonb)
            from pdt_gerente_sector x where x.gerente_correo = gs.gerente_correo
        )
    ) order by gs.gerente_correo), '[]'::jsonb)
    from (select distinct gerente_correo from pdt_gerente_sector) gs
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_google_credenciales_guardar(p_correo text, p_refresh_token text, p_scopes text, p_sesion_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    insert into pdt_google_credenciales (correo, refresh_token, scopes, creado, ultimo_uso)
    values (lower(trim(p_correo)), p_refresh_token, coalesce(p_scopes, ''), now(), now())
    on conflict (correo) do update set
        -- Google solo entrega el refresh token en el consentimiento inicial; un canje posterior
        -- (p. ej. reautenticación tras revocar) puede no traer uno nuevo. No lo pisamos con
        -- vacío para no perder el que ya funcionaba.
        refresh_token = case when p_refresh_token is not null and p_refresh_token <> ''
                              then p_refresh_token else pdt_google_credenciales.refresh_token end,
        scopes = coalesce(p_scopes, pdt_google_credenciales.scopes),
        ultimo_uso = now();

    -- Cada inicio de sesión es una sesión nueva; la de OTRO dispositivo no se toca.
    if coalesce(p_sesion_hash, '') <> '' then
        insert into pdt_sesiones (sesion_hash, correo, creado, ultimo_uso)
        values (p_sesion_hash, lower(trim(p_correo)), now(), now())
        on conflict (sesion_hash) do update set
            correo = excluded.correo,
            ultimo_uso = now();
    end if;

    return jsonb_build_object('status', 'ok');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_google_credenciales_olvidar(p_correo text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    delete from pdt_google_credenciales where correo = lower(trim(p_correo));
    select jsonb_build_object('status', 'ok');
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_google_credenciales_por_sesion(p_sesion_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    fila pdt_google_credenciales;
begin
    select g.* into fila
    from pdt_sesiones s
    join pdt_google_credenciales g on g.correo = s.correo
    where s.sesion_hash = p_sesion_hash;

    if not found then
        return jsonb_build_object('status', 'error', 'message', 'Sesión no reconocida');
    end if;

    update pdt_sesiones set ultimo_uso = now() where sesion_hash = p_sesion_hash;
    update pdt_google_credenciales set ultimo_uso = now() where correo = fila.correo;

    return jsonb_build_object(
        'status', 'ok', 'correo', fila.correo, 'refresh_token', fila.refresh_token
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_historico_actividades_listar(p_correo text DEFAULT NULL::text)
 RETURNS SETOF pdt_historico_actividades
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select * from pdt_historico_actividades
    where p_correo is null or lower(trim(educador_correo)) = lower(trim(p_correo))
    order by fecha_documento desc nulls last, no_doc desc
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_historico_plan_trabajo_listar(p_correo text DEFAULT NULL::text)
 RETURNS SETOF pdt_historico_plan_trabajo
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select * from pdt_historico_plan_trabajo
    where p_correo is null or lower(trim(educador_correo)) = lower(trim(p_correo))
    order by fecha desc nulls last
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_jefe_de_en_fecha(p_subordinado text, p_fecha date)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select h.jefe
    from pdt_jerarquia_historica h
    where lower(trim(h.subordinado)) = lower(trim(p_subordinado))
      and h.desde::date <= p_fecha
      and (h.hasta is null or h.hasta::date >= p_fecha)
    order by h.desde desc
    limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_jerarquia_guardar(p_actor text, p_jefe text, p_subordinados jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    delete from pdt_jerarquia where lower(trim(jefe)) = v_jefe;

    insert into pdt_jerarquia (jefe, subordinado)
    select v_jefe, lower(trim(x))
    from jsonb_array_elements_text(coalesce(p_subordinados, '[]'::jsonb)) x
    where trim(x) <> '' and lower(trim(x)) <> v_jefe
    on conflict do nothing;

    get diagnostics v_n = row_count;

    return jsonb_build_object('jefe', v_jefe, 'subordinados', v_n);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_perfil(p_correo text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with yo as (select lower(trim(p_correo)) as correo),
    usuario as (
        select u.* from pdt_usuarios u, yo
         where lower(trim(u.correo)) = yo.correo and u.activo
    ),
    invitacion as (
        select i.* from pdt_invitaciones i, yo where lower(trim(i.correo)) = yo.correo
    ),
    admin_legado as (
        select exists (
            select 1 from pdt_admins a, yo where lower(trim(a.correo)) = yo.correo
        ) as si
    ),
    capacidades as (
        select coalesce(jsonb_agg(distinct c.clave), '[]'::jsonb) as lista
        from yo, lateral pdt_capacidades_de(yo.correo) c
    ),
    mis_roles as (
        select coalesce(jsonb_agg(distinct r.rol), '[]'::jsonb) as lista
        from (
            select ur.rol from pdt_usuario_roles ur, yo where lower(trim(ur.correo)) = yo.correo
            union
            select u.rol from usuario u where u.rol is not null
            union
            select i.rol from invitacion i
             where i.estado in ('pendiente','aceptada') and i.rol is not null
        ) r
        join pdt_roles rr on rr.clave = r.rol and rr.activo
    ),
    alcance as (
        select coalesce(jsonb_agg(a.correo), '[]'::jsonb) as lista
        from yo, lateral pdt_alcance(yo.correo) a
    ),
    zonas as (
        select coalesce(jsonb_agg(z.zona), '[]'::jsonb) as lista
        from yo, lateral pdt_zonas_de(yo.correo) z
    ),
    clientes_extra as (
        select coalesce(jsonb_agg(c.cliente), '[]'::jsonb) as lista
        from yo, lateral pdt_clientes_extra_de(yo.correo) c
    )
    select jsonb_build_object(
        'correo', yo.correo,
        'nombre', coalesce((select nombre from usuario), (select nombre from invitacion)),
        'rol', coalesce(
            (select rr.clave from pdt_usuario_roles ur
               join pdt_roles rr on rr.clave = ur.rol and rr.activo, yo
              where lower(trim(ur.correo)) = yo.correo
              order by rr.orden limit 1),
            (select rol from usuario),
            (select rol from invitacion),
            case when (select si from admin_legado) then 'administrador' end
        ),
        'roles', (select lista from mis_roles),
        'es_admin', (select si from admin_legado)
                    or (select lista from capacidades) ? 'administracion.configurar',
        'invitado', coalesce(
            (select estado in ('pendiente','aceptada') from invitacion),
            (select si from admin_legado)
        ),
        'invitacion_estado', coalesce(
            (select estado from invitacion),
            case when (select si from admin_legado) then 'aceptada' else 'sin_invitacion' end
        ),
        'permisos', (select lista from capacidades),
        'alcance', (select lista from alcance),
        'zonas', (select lista from zonas),
        'clientes_extra', (select lista from clientes_extra)
    )
    from yo
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_puede(p_correo text, p_capacidad text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1 from pdt_capacidades_de(p_correo) c where c.clave = p_capacidad
    );
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_reporte_actividades(p_correo text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_sector text DEFAULT NULL::text, p_actividad text DEFAULT NULL::text, p_educador text DEFAULT NULL::text, p_todas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with mis_sectores as (
        select sector from pdt_sectores_de_gerente(p_correo)
    ),
    base as (
        select
            a.tipo,
            s.nombre as sector,
            v.dia, v.cliente, v.educador_correo, v.educador,
            coalesce(a.fecha_documento, v.dia) as fecha_efectiva,
            pdt_jefe_de_en_fecha(v.educador_correo, coalesce(a.fecha_documento, v.dia)) as jefe_correo
        from pdt_actividades a
        join pdt_sectores s on s.id = a.id_sector
        join pdt_visitas v on v.id = a.id_visita
        where a.guardada_momento is not null
    ),
    visibles as (
        select b.*
        from base b
        where (
            p_todas
            or lower(trim(b.educador_correo)) = lower(trim(p_correo))
            or (
                b.jefe_correo = lower(trim(p_correo))
                and exists (select 1 from mis_sectores ms where ms.sector = b.sector)
            )
        )
        and (p_desde is null or b.fecha_efectiva >= p_desde)
        and (p_hasta is null or b.fecha_efectiva <= p_hasta)
        and (p_sector is null or b.sector = p_sector)
        and (p_actividad is null or b.tipo = p_actividad)
        and (p_educador is null or lower(trim(b.educador_correo)) = lower(trim(p_educador)))
    )
    select jsonb_build_object(
        'total', (select count(*) from visibles),
        'por_sector', (
            select coalesce(jsonb_agg(jsonb_build_object('sector', sector, 'n', n) order by n desc), '[]'::jsonb)
            from (select coalesce(sector, '(sin sector)') as sector, count(*) as n
                  from visibles group by sector) t
        ),
        'por_actividad', (
            select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'n', n) order by n desc), '[]'::jsonb)
            from (select coalesce(tipo, '(sin tipo)') as tipo, count(*) as n
                  from visibles group by tipo) t
        ),
        'filas', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'jefe_correo', v.jefe_correo,
                'jefe', ju.nombre,
                'educador_correo', v.educador_correo,
                'educador', v.educador,
                'tipo', v.tipo,
                'sector', v.sector,
                'cliente', v.cliente,
                'mes', to_char(v.fecha_efectiva, 'YYYY-MM')
            )), '[]'::jsonb)
            from visibles v
            left join pdt_usuarios ju on lower(trim(ju.correo)) = v.jefe_correo
        )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_revision_guardar(p_revisor_correo text, p_revisor text, p_revisiones jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    r jsonb;
    n int := 0;
begin
    for r in select * from jsonb_array_elements(coalesce(p_revisiones, '[]'::jsonb))
    loop
        insert into pdt_revisiones (
            id, flujo, ambito, id_ambito, id_visita, educador_correo,
            resultado, observaciones, revisor_correo, revisor, momento
        )
        select
            r->>'id', r->>'flujo', r->>'ambito', r->>'id_ambito', r->>'id_visita',
            coalesce(v.educador_correo, lower(p_revisor_correo)),
            r->>'resultado', nullif(r->>'observaciones', ''),
            lower(p_revisor_correo), p_revisor,
            coalesce(nullif(r->>'momento', '')::timestamptz, now())
        from (select 1) x
        left join pdt_visitas v on v.id = r->>'id_visita'
        on conflict (id) do nothing;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'revisiones', n);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_revisiones_en_alcance(p_correo text, p_limite integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with permitidos as (
        select correo from pdt_alcance(p_correo)
    ),
    visibles as (
        select r.*
        from pdt_revisiones r
        join permitidos p on p.correo = r.educador_correo
        order by r.momento desc, r.seq desc
        limit greatest(1, least(coalesce(p_limite, 5000), 20000))
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id,
        'flujo', v.flujo,
        'ambito', v.ambito,
        'id_ambito', v.id_ambito,
        'id_visita', v.id_visita,
        'educador_correo', v.educador_correo,
        'resultado', v.resultado,
        'observaciones', v.observaciones,
        'revisor_correo', v.revisor_correo,
        'revisor', v.revisor,
        'momento', v.momento,
        'seq', v.seq
    ) order by v.momento, v.seq), '[]'::jsonb)
    from visibles v
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_rol_capacidades(p_rol text)
 RETURNS TABLE(clave text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with recursive cadena as (
        select r.clave, r.hereda_de from pdt_roles r where r.clave = p_rol
        union
        select padre.clave, padre.hereda_de
        from pdt_roles padre join cadena c on c.hereda_de = padre.clave
    )
    select distinct p.modulo || '.' || p.accion
    from pdt_permisos p join cadena c on c.clave = p.rol
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_rol_eliminar(p_actor text, p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor     text := pdt_exige_admin(p_actor);
    v_clave     text := lower(trim(coalesce(p_clave, '')));
    v_sistema   boolean;
    v_usuarios  int;
    v_herederos int;
begin
    select sistema into v_sistema from pdt_roles where clave = v_clave;
    if v_sistema is null then
        raise exception 'El rol "%" no existe.', v_clave;
    end if;

    if v_sistema then
        raise exception 'El rol "%" es del sistema y no se puede borrar. Si ya no quieres que se use, quítaselo a quien lo tenga.', v_clave;
    end if;

    select count(*) into v_usuarios
      from (
        select lower(trim(correo)) as correo from pdt_usuario_roles where rol = v_clave
        union
        select lower(trim(correo)) from pdt_usuarios where rol = v_clave
      ) x;

    if v_usuarios > 0 then
        raise exception 'El rol "%" lo tienen % persona(s). Cámbiales el rol antes de borrarlo, o desactívalo para que deje de ofrecerse.', v_clave, v_usuarios;
    end if;

    select count(*) into v_herederos from pdt_roles where hereda_de = v_clave;
    if v_herederos > 0 then
        raise exception 'De "%" heredan % rol(es). Quítales la herencia antes de borrarlo.', v_clave, v_herederos;
    end if;

    delete from pdt_roles where clave = v_clave;

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('clave', v_clave, 'borrado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_rol_guardar(p_actor text, p_rol jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor     text := pdt_exige_admin(p_actor);
    v_clave     text := lower(trim(coalesce(p_rol->>'clave', '')));
    v_hereda    text := nullif(trim(coalesce(p_rol->>'hereda_de', '')), '');
    v_sistema   boolean;
    v_activo    boolean := coalesce((p_rol->>'activo')::boolean, true);
    v_caps      jsonb := p_rol->'capacidades';
    v_paso      text;
    v_saltos    int := 0;
    v_desconocidas text;
begin
    if v_clave = '' then
        raise exception 'El rol necesita una clave.';
    end if;

    if v_clave !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'La clave "%" solo puede llevar minúsculas, números y guion bajo, y debe empezar por letra.', v_clave;
    end if;

    select sistema into v_sistema from pdt_roles where clave = v_clave;

    if coalesce(v_sistema, false) and not v_activo then
        raise exception 'El rol "%" es del sistema y no se puede desactivar.', v_clave;
    end if;

    if v_hereda is not null then
        if not exists (select 1 from pdt_roles where clave = v_hereda) then
            raise exception 'El rol del que quiere heredar ("%") no existe.', v_hereda;
        end if;

        v_paso := v_hereda;
        while v_paso is not null and v_saltos < 50 loop
            if v_paso = v_clave then
                raise exception 'Esa herencia haría un ciclo: "%" ya hereda de "%".', v_hereda, v_clave;
            end if;
            select hereda_de into v_paso from pdt_roles where clave = v_paso;
            v_saltos := v_saltos + 1;
        end loop;
    end if;

    insert into pdt_roles (clave, nombre, descripcion, orden, activo, hereda_de)
    values (
        v_clave,
        coalesce(nullif(trim(p_rol->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_rol->>'descripcion'), ''),
        coalesce((p_rol->>'orden')::int, 0),
        v_activo,
        v_hereda
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            orden       = excluded.orden,
            activo      = excluded.activo,
            hereda_de   = excluded.hereda_de;

    if v_caps is not null and jsonb_typeof(v_caps) = 'array' then
        select string_agg(quote_literal(x), ', ') into v_desconocidas
        from jsonb_array_elements_text(v_caps) x
        where not exists (select 1 from pdt_capacidades c where c.clave = x);

        if v_desconocidas is not null then
            raise exception 'Estas capacidades no existen en el catálogo: %.', v_desconocidas;
        end if;

        delete from pdt_permisos where rol = v_clave;

        insert into pdt_permisos (rol, modulo, accion)
        select v_clave, c.modulo, c.accion
        from jsonb_array_elements_text(v_caps) x
        join pdt_capacidades c on c.clave = x
        on conflict do nothing;
    end if;

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_roles_admin()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', r.clave, 'nombre', r.nombre, 'descripcion', r.descripcion,
        'orden', r.orden, 'activo', r.activo, 'sistema', r.sistema, 'hereda_de', r.hereda_de,
        'capacidades', coalesce((
            select jsonb_agg(distinct p.modulo || '.' || p.accion)
            from pdt_permisos p where p.rol = r.clave
        ), '[]'::jsonb),
        'efectivas', coalesce((
            select jsonb_agg(distinct c.clave) from pdt_rol_capacidades(r.clave) c
        ), '[]'::jsonb),
        'usuarios', (select count(*) from pdt_usuario_roles ur where ur.rol = r.clave),
        'herederos', (select count(*) from pdt_roles h where h.hereda_de = r.clave)
    ) order by r.orden, r.clave), '[]'::jsonb)
    from pdt_roles r
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_sectores_de_gerente(p_correo text)
 RETURNS TABLE(sector text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select gs.sector from pdt_gerente_sector gs
    where lower(trim(gs.gerente_correo)) = lower(trim(p_correo))
    order by gs.sector
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_sesion_olvidar(p_sesion_hash text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    delete from pdt_sesiones where sesion_hash = p_sesion_hash;
    select jsonb_build_object('status', 'ok');
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_territorios_listar(p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor text := pdt_exige_admin(p_actor);
begin
    return jsonb_build_object(
        'titulares', coalesce((
            select jsonb_agg(jsonb_build_object(
                'zona', zona, 'educador_correo', educador_correo
            ) order by zona)
            from pdt_zona_educador
        ), '[]'::jsonb),
        'coberturas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', id, 'zona', zona, 'educador_correo', educador_correo,
                'desde', desde, 'hasta', hasta, 'motivo', motivo, 'creado_por', creado_por
            ) order by desde desc)
            from pdt_zona_cobertura
        ), '[]'::jsonb),
        'excepciones_cliente', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', id, 'cliente', cliente, 'educador_correo', educador_correo,
                'desde', desde, 'hasta', hasta, 'motivo', motivo, 'creado_por', creado_por
            ) order by desde desc)
            from pdt_cliente_excepcion
        ), '[]'::jsonb)
    );
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_usuario_guardar(p_actor text, p_usuario jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor   text := pdt_exige_admin(p_actor);
    v_correo  text := lower(trim(coalesce(p_usuario->>'correo', '')));
    v_activo  boolean := coalesce((p_usuario->>'activo')::boolean, true);
    v_roles   jsonb := p_usuario->'roles';
    v_malos   text;
begin
    if v_correo = '' or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'El correo "%" no parece válido.', coalesce(v_correo, '');
    end if;

    insert into pdt_usuarios (correo, nombre, activo)
    values (v_correo, nullif(trim(p_usuario->>'nombre'), ''), v_activo)
    on conflict (correo) do update
        set nombre = coalesce(excluded.nombre, pdt_usuarios.nombre),
            activo = excluded.activo;

    if v_roles is not null and jsonb_typeof(v_roles) = 'array' then
        select string_agg(quote_literal(x), ', ') into v_malos
        from jsonb_array_elements_text(v_roles) x
        where not exists (select 1 from pdt_roles r where r.clave = x);

        if v_malos is not null then
            raise exception 'Estos roles no existen: %.', v_malos;
        end if;

        delete from pdt_usuario_roles where lower(trim(correo)) = v_correo;

        insert into pdt_usuario_roles (correo, rol)
        select v_correo, x from jsonb_array_elements_text(v_roles) x
        on conflict do nothing;

        update pdt_usuarios set rol = null where lower(trim(correo)) = v_correo;
        update pdt_invitaciones set rol = null where lower(trim(correo)) = v_correo;
    end if;

    insert into pdt_invitaciones (correo, nombre, invitado_por, estado)
    values (
        v_correo, nullif(trim(p_usuario->>'nombre'), ''), v_actor,
        case when v_activo then 'pendiente' else 'revocada' end
    )
    on conflict (correo) do update
        set estado = case
                when not v_activo then 'revocada'
                when pdt_invitaciones.estado = 'revocada' then 'pendiente'
                else pdt_invitaciones.estado
            end;

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('correo', v_correo, 'guardado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_usuarios_admin()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with correos as (
        select lower(trim(correo)) as correo from pdt_usuarios
        union select lower(trim(correo)) from pdt_invitaciones
        union select lower(trim(correo)) from pdt_usuario_roles
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'correo', c.correo,
        'nombre', (select u.nombre from pdt_usuarios u where lower(trim(u.correo)) = c.correo),
        'activo', coalesce((select u.activo from pdt_usuarios u
                             where lower(trim(u.correo)) = c.correo), true),
        'roles', coalesce((select jsonb_agg(distinct ur.rol) from pdt_usuario_roles ur
                            where lower(trim(ur.correo)) = c.correo), '[]'::jsonb),
        'invitacion', (select i.estado from pdt_invitaciones i
                        where lower(trim(i.correo)) = c.correo),
        'jefes', coalesce((select jsonb_agg(distinct lower(trim(j.jefe))) from pdt_jerarquia j
                            where lower(trim(j.subordinado)) = c.correo), '[]'::jsonb),
        'subordinados', coalesce((select jsonb_agg(distinct lower(trim(j.subordinado)))
                                   from pdt_jerarquia j
                                  where lower(trim(j.jefe)) = c.correo), '[]'::jsonb)
    ) order by c.correo), '[]'::jsonb)
    from correos c
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_visitas_en_alcance(p_correo text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_limite integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with por_persona as (
        select correo from pdt_alcance(p_correo)
    ),
    mis_zonas as (
        select zona from pdt_zonas_de(p_correo)
    ),
    mis_clientes_extra as (
        select cliente from pdt_clientes_extra_de(p_correo)
    ),
    visibles as (
        select v.*
        from pdt_visitas v
        where (
            v.educador_correo in (select correo from por_persona)
            or (v.zona is not null and v.zona in (select zona from mis_zonas))
            or (v.cliente is not null and v.cliente in (select cliente from mis_clientes_extra))
        )
          and (p_desde is null or v.dia >= p_desde)
          and (p_hasta is null or v.dia <= p_hasta)
        order by v.dia desc nulls last
        limit greatest(1, least(coalesce(p_limite, 2000), 10000))
    )
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', v.id,
            'educador', v.educador,
            'educador_correo', v.educador_correo,
            'cliente', v.cliente,
            'hospital', v.hospital,
            'zona', v.zona,
            'ejecutivo', v.ejecutivo,
            'notas', v.notas,
            'id_estrategia', v.id_estrategia,
            'tipo', v.tipo,
            'motivo', v.motivo,
            'dia', to_char(v.dia, 'YYYY-MM-DD'),
            'hora_inicio', v.hora_inicio,
            'hora_fin', v.hora_fin,
            'estado', v.estado,
            'motivo_cancelacion', v.motivo_cancelacion,
            'sincronizado', true,
            'remota', true,
            'reagendas', (
                select coalesce(jsonb_agg(jsonb_build_object('id', g))
                                filter (where g is not null), '[]'::jsonb)
                from generate_series(1, v.reagendas) g
            ),
            'check_in', case when v.check_in_momento is null then null else jsonb_build_object(
                'momento', v.check_in_momento, 'lat', v.check_in_lat, 'lng', v.check_in_lng
            ) end,
            'check_out', case when v.check_out_momento is null then null else jsonb_build_object(
                'momento', v.check_out_momento
            ) end,
            'sectores', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', s.id,
                    'nombre', s.nombre,
                    'objetivo', s.objetivo,
                    'origen', case when coalesce(s.origen, '') = '' then '[]'::jsonb
                                   else to_jsonb(string_to_array(s.origen, ', ')) end,
                    'solicitado_por', s.solicitado_por,
                    'guardado', jsonb_build_object(
                        'momento', s.guardado_momento, 'usuario', s.guardado_usuario),
                    'actividades', coalesce((
                        select jsonb_agg(jsonb_build_object(
                            'id', a.id,
                            'tipo', a.tipo,
                            'area_visitada', a.area_visitada,
                            'fecha_documento', to_char(a.fecha_documento, 'YYYY-MM-DD'),
                            'contacto', jsonb_build_object(
                                'nombre', a.contacto_nombre,
                                'cargo', a.contacto_cargo,
                                'servicio', a.contacto_servicio),
                            'evidencia', jsonb_build_object(
                                'estado', a.evidencia_estado,
                                'url', a.evidencia_url,
                                'tipo', a.evidencia_tipo),
                            'guardada', jsonb_build_object(
                                'momento', a.guardada_momento, 'usuario', a.guardada_usuario),
                            'materiales', coalesce((
                                select jsonb_agg(jsonb_build_object(
                                    'id', m.id, 'material', m.material,
                                    'cantidad', m.cantidad, 'unidad', m.unidad,
                                    'origen', m.origen))
                                from pdt_materiales m where m.id_actividad = a.id
                            ), '[]'::jsonb)
                        ))
                        from pdt_actividades a where a.id_sector = s.id
                    ), '[]'::jsonb)
                ))
                from pdt_sectores s where s.id_visita = v.id
            ), '[]'::jsonb)
        )
    ), '[]'::jsonb)
    from visibles v;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_visitas_en_alcance(p_correo text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_limite integer DEFAULT 2000, p_todas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    with por_persona as (
        select correo from pdt_alcance(p_correo)
    ),
    mis_zonas as (
        select zona from pdt_zonas_de(p_correo)
    ),
    mis_clientes_extra as (
        select cliente from pdt_clientes_extra_de(p_correo)
    ),
    visibles as (
        select v.*
        from pdt_visitas v
        where (
            p_todas
            or v.educador_correo in (select correo from por_persona)
            or (v.zona is not null and v.zona in (select zona from mis_zonas))
            or (v.cliente is not null and v.cliente in (select cliente from mis_clientes_extra))
        )
          and (p_desde is null or v.dia >= p_desde)
          and (p_hasta is null or v.dia <= p_hasta)
        order by v.dia desc nulls last
        limit greatest(1, least(coalesce(p_limite, 2000), 10000))
    )
    select coalesce(jsonb_agg(
        jsonb_build_object(
            'id', v.id,
            'educador', v.educador,
            'educador_correo', v.educador_correo,
            'cliente', v.cliente,
            'hospital', v.hospital,
            'zona', v.zona,
            'ejecutivo', v.ejecutivo,
            'notas', v.notas,
            'id_estrategia', v.id_estrategia,
            'tipo', v.tipo,
            'motivo', v.motivo,
            'es_prospecto', v.es_prospecto,
            'calendar_event_id', v.calendar_event_id,
            'dia', to_char(v.dia, 'YYYY-MM-DD'),
            'hora_inicio', v.hora_inicio,
            'hora_fin', v.hora_fin,
            'estado', v.estado,
            'motivo_cancelacion', v.motivo_cancelacion,
            'sincronizado', true,
            'remota', true,
            'reagendas', (
                select coalesce(jsonb_agg(jsonb_build_object('id', g))
                                filter (where g is not null), '[]'::jsonb)
                from generate_series(1, v.reagendas) g
            ),
            'check_in', case when v.check_in_momento is null then null else jsonb_build_object(
                'momento', v.check_in_momento, 'lat', v.check_in_lat, 'lng', v.check_in_lng
            ) end,
            'check_out', case when v.check_out_momento is null then null else jsonb_build_object(
                'momento', v.check_out_momento
            ) end,
            'sectores', coalesce((
                select jsonb_agg(jsonb_build_object(
                    'id', s.id,
                    'nombre', s.nombre,
                    'objetivo', s.objetivo,
                    'origen', case when coalesce(s.origen, '') = '' then '[]'::jsonb
                                   else to_jsonb(string_to_array(s.origen, ', ')) end,
                    'solicitado_por', s.solicitado_por,
                    'guardado', jsonb_build_object(
                        'momento', s.guardado_momento, 'usuario', s.guardado_usuario),
                    'actividades', coalesce((
                        select jsonb_agg(jsonb_build_object(
                            'id', a.id,
                            'tipo', a.tipo,
                            'area_visitada', a.area_visitada,
                            'fecha_documento', to_char(a.fecha_documento, 'YYYY-MM-DD'),
                            'contacto', jsonb_build_object(
                                'nombre', a.contacto_nombre,
                                'cargo', a.contacto_cargo,
                                'servicio', a.contacto_servicio),
                            'evidencia', jsonb_build_object(
                                'estado', a.evidencia_estado,
                                'url', a.evidencia_url,
                                'tipo', a.evidencia_tipo),
                            'guardada', jsonb_build_object(
                                'momento', a.guardada_momento, 'usuario', a.guardada_usuario),
                            'materiales', coalesce((
                                select jsonb_agg(jsonb_build_object(
                                    'id', m.id, 'material', m.material,
                                    'cantidad', m.cantidad, 'unidad', m.unidad,
                                    'origen', m.origen))
                                from pdt_materiales m where m.id_actividad = a.id
                            ), '[]'::jsonb)
                        ))
                        from pdt_actividades a where a.id_sector = s.id
                    ), '[]'::jsonb)
                ))
                from pdt_sectores s where s.id_visita = v.id
            ), '[]'::jsonb)
        )
    ), '[]'::jsonb)
    from visibles v;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_visitas_equipo_sesion(p_sesion_token text, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_limite integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    return pdt_visitas_en_alcance(v_correo, p_desde, p_hasta, p_limite, pdt_es_admin(v_correo));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_visitas_guardar_sesion(p_sesion_token text, p_visitas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre text;
    v_resultado jsonb;
    v_visita jsonb;
begin
    v_resultado := pdt_espejo_guardar(v_correo, p_visitas);

    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;

    -- Encola cada visita para el export diario a Sheets. `on conflict` colapsa varias
    -- ediciones de la misma visita en la misma hora a una sola fila pendiente.
    for v_visita in select * from jsonb_array_elements(coalesce(p_visitas, '[]'::jsonb))
    loop
        insert into pdt_export_cola (id_visita, correo, nombre, payload, encolado)
        values (v_visita->>'id', v_correo, v_nombre, v_visita, now())
        on conflict (id_visita) do update set
            correo   = excluded.correo,
            nombre   = excluded.nombre,
            payload  = excluded.payload,
            encolado = now(),
            tomado   = null;  -- una edición nueva reabre una fila que ya se había tomado
    end loop;

    return v_resultado;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pdt_zona_asignar(p_actor text, p_zona text, p_educador_correo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor  text := pdt_exige_admin(p_actor);
    v_zona   text := trim(coalesce(p_zona, ''));
    v_correo text := lower(trim(coalesce(p_educador_correo, '')));
begin
    if v_zona = '' then
        raise exception 'Falta la zona.';
    end if;
    if v_correo = '' or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'El correo "%" no parece válido.', coalesce(v_correo, '');
    end if;

    insert into pdt_zona_educador (zona, educador_correo)
    values (v_zona, v_correo)
    on conflict (zona) do update set educador_correo = excluded.educador_correo;

    return jsonb_build_object('zona', v_zona, 'educador_correo', v_correo);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_zona_quitar(p_actor text, p_zona text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_zona  text := trim(coalesce(p_zona, ''));
begin
    delete from pdt_zona_educador where zona = v_zona;
    return jsonb_build_object('zona', v_zona, 'quitado', true);
end $function$
;

CREATE OR REPLACE FUNCTION public.pdt_zonas_de(p_correo text)
 RETURNS TABLE(zona text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select zona from pdt_zona_educador where lower(trim(educador_correo)) = lower(trim(p_correo))
    union
    select zona from pdt_zona_cobertura
     where lower(trim(educador_correo)) = lower(trim(p_correo))
       and now() >= desde
       and (hasta is null or now() <= hasta)
$function$
;