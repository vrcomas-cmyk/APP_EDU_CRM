/*
 * Excepciones de territorio POR CLIENTE, además de por zona.
 *
 * `pdt_zona_cobertura` (20260722) ya cubre "el educador 2 cubre TODA la zona del educador 1
 * mientras dure la rotación". Pero hay un caso más angosto: un educador necesita ver uno o dos
 * clientes SUELTOS que no son de su zona —un caso puntual, contado, no una zona entera—. Forzar
 * eso por `pdt_zona_cobertura` obligaría a prestarle la zona completa por un solo cliente.
 *
 * Mismo patrón que la cobertura de zona: vigencia opcional (desde/hasta), no reemplaza la
 * titularidad de nadie, solo AGREGA visibilidad sobre ese cliente puntual.
 */

-- ---------- esquema ----------

create table if not exists pdt_cliente_excepcion (
    id              uuid primary key default gen_random_uuid(),
    cliente         text not null,
    educador_correo text not null,     -- a quién se le presta la visibilidad de este cliente
    desde           timestamptz not null default now(),
    hasta           timestamptz,        -- null = indefinida
    motivo          text,
    creado_por      text not null,
    creado_en       timestamptz not null default now()
);

create index if not exists pdt_cliente_excepcion_cliente_idx on pdt_cliente_excepcion (cliente);
create index if not exists pdt_cliente_excepcion_correo_idx on pdt_cliente_excepcion (lower(educador_correo));

-- ---------- lectura: clientes sueltos que alguien puede ver hoy, fuera de su zona ----------

create or replace function pdt_clientes_extra_de(p_correo text)
returns table (cliente text)
language sql
stable
security definer
set search_path = public
as $$
    select cliente from pdt_cliente_excepcion
     where lower(trim(educador_correo)) = lower(trim(p_correo))
       and now() >= desde
       and (hasta is null or now() <= hasta)
$$;

comment on function pdt_clientes_extra_de is
    'Clientes puntuales (fuera de sus zonas) que p_correo puede ver hoy por excepción.';

-- ---------- pdt_perfil: se le agrega `clientes_extra` ----------

create or replace function pdt_perfil(p_correo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke execute on function pdt_perfil(text) from public;
grant execute on function pdt_perfil(text) to anon, authenticated, service_role;

-- ---------- escritura ----------

create or replace function pdt_cliente_excepcion_agregar(
    p_actor          text,
    p_cliente        text,
    p_educador_correo text,
    p_desde          timestamptz,
    p_hasta          timestamptz,
    p_motivo         text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

create or replace function pdt_cliente_excepcion_quitar(p_actor text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
begin
    delete from pdt_cliente_excepcion where id = p_id;
    return jsonb_build_object('id', p_id, 'quitado', true);
end $$;

-- ---------- pdt_territorios_listar: ahora también trae las excepciones de cliente ----------

create or replace function pdt_territorios_listar(p_actor text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
end $$;

-- ---------- pdt_visitas_en_alcance: ahora también por excepción de cliente ----------

create or replace function pdt_visitas_en_alcance(
    p_correo text,
    p_desde  date default null,
    p_hasta  date default null,
    p_limite int  default 2000
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
$$;

revoke execute on function pdt_visitas_en_alcance(text, date, date, int) from public, anon, authenticated;
grant execute on function pdt_visitas_en_alcance(text, date, date, int) to service_role;

-- ---------- permisos de ejecución de lo nuevo ----------

revoke execute on function pdt_clientes_extra_de(text) from public, anon, authenticated;
revoke execute on function pdt_cliente_excepcion_agregar(text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function pdt_cliente_excepcion_quitar(text, uuid) from public, anon, authenticated;
revoke execute on function pdt_territorios_listar(text) from public, anon, authenticated;

grant execute on function pdt_clientes_extra_de(text) to service_role;
grant execute on function pdt_cliente_excepcion_agregar(text, text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function pdt_cliente_excepcion_quitar(text, uuid) to service_role;
grant execute on function pdt_territorios_listar(text) to service_role;
