/*
 * Territorios por zona + el enlace Visita → Estrategia.
 *
 * ── El problema que esto resuelve ────────────────────────────────────────────────────────
 *
 * Hasta hoy, "quién ve qué visita" solo dependía de la jerarquía de PERSONAS (`pdt_jerarquia`
 * / `pdt_alcance`): un gerente ve las visitas de quien tiene a cargo, sin importar el cliente.
 * Pero un cliente pertenece a una ZONA (Clientes → "Gpo. vendedores"), y esa zona debería
 * pertenecerle a UN educador — no a quien resulte estar en su línea de mando ese día. El caso
 * que esto tiene que resolver es la rotación: cuando la zona 002 pasa del educador 1 al
 * educador 2, el educador 2 tiene que poder ver el histórico completo de esos clientes —sus
 * visitas y sus Estrategias— aunque él nunca las haya capturado y aunque nadie lo haya puesto
 * en la jerarquía de quien sí las capturó.
 *
 * ── El modelo ─────────────────────────────────────────────────────────────────────────────
 *
 *   pdt_zona_educador   Titularidad. Una zona, un titular — a diferencia de `pdt_jerarquia`
 *                       (muchos a muchos), aquí la pregunta "¿de quién son estos clientes por
 *                       default?" necesita una respuesta sin ambigüedad.
 *   pdt_zona_cobertura  Excepción temporal: alguien más cubre esa zona (vacaciones, rotación en
 *                       curso, ausencia) sin dejar de existir el titular. Con vigencia opcional.
 *   pdt_zonas_de(correo) Las zonas que ese correo puede operar HOY: las suyas + las que cubre
 *                       vigentes. Es el mismo patrón que `pdt_alcance`, pero por territorio en
 *                       vez de por persona.
 *
 * La visibilidad de una visita pasa a ser la UNIÓN de dos caminos, no solo uno: por jerarquía
 * de personas (ya existía) O por zona (nuevo). Ninguno reemplaza al otro.
 *
 * ── Por qué esto vive en Supabase y no en una hoja de Sheets ─────────────────────────────
 *
 * Igual que los roles y la jerarquía: necesita una pantalla para asignar/revocar sin editar una
 * hoja a mano, y las coberturas son temporales — piden fecha, no una celda de texto libre.
 */

-- ---------- esquema ----------

create table if not exists pdt_zona_educador (
    zona            text primary key,
    educador_correo text not null,
    creado_en       timestamptz not null default now()
);

create table if not exists pdt_zona_cobertura (
    id              uuid primary key default gen_random_uuid(),
    zona            text not null,
    educador_correo text not null,     -- quien CUBRE, no el titular
    desde           timestamptz not null default now(),
    hasta           timestamptz,        -- null = indefinida
    motivo          text,
    creado_por      text not null,
    creado_en       timestamptz not null default now()
);

create index if not exists pdt_zona_cobertura_zona_idx on pdt_zona_cobertura (zona);
create index if not exists pdt_zona_cobertura_correo_idx on pdt_zona_cobertura (lower(educador_correo));

-- El enlace Visita → Estrategia: qué visita se generó para avanzar cuál plan. Aditivo, no
-- rompe nada de lo que ya hay — una visita sin estrategia sigue siendo una visita normal.
alter table pdt_visitas add column if not exists id_estrategia text;

-- ---------- lectura: zonas que alguien puede operar ----------

create or replace function pdt_zonas_de(p_correo text)
returns table (zona text)
language sql
stable
security definer
set search_path = public
as $$
    select zona from pdt_zona_educador where lower(trim(educador_correo)) = lower(trim(p_correo))
    union
    select zona from pdt_zona_cobertura
     where lower(trim(educador_correo)) = lower(trim(p_correo))
       and now() >= desde
       and (hasta is null or now() <= hasta)
$$;

comment on function pdt_zonas_de is
    'Zonas que p_correo puede operar HOY: las suyas como titular, más las que cubre vigentes.';

-- ---------- pdt_perfil: se le agrega `zonas` ----------

/*
 * Se reemplaza entera (mismo motivo de siempre: sin ALTER FUNCTION parcial) solo para agregar
 * `zonas` al JSON. Vive aquí y no en una llamada aparte porque `pdt_perfil` ya es la ÚNICA
 * llamada que la PWA hace directo a Supabase con la clave anónima al arrancar (`pdt_alcance`
 * en cambio es `service_role` — revela la organización completa, y por eso solo se usa desde
 * dentro de otra función `security definer` como esta). Igual de sensibles serían las zonas
 * de OTRA persona, así que van por el mismo camino: nunca una llamada aparte con `p_correo`
 * libre, siempre lo que ya trae el perfil de quien pregunta por sí mismo.
 *
 * El resto del cuerpo es una copia literal de `20260719c_pdt_roles_administrables.sql`.
 */
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
        'zonas', (select lista from zonas)
    )
    from yo
$$;

revoke execute on function pdt_perfil(text) from public;
grant execute on function pdt_perfil(text) to anon, authenticated, service_role;

-- ---------- escritura: asignar y cubrir ----------

/*
 * Asigna (o reasigna) el titular de una zona. Upsert por zona: una zona nunca tiene dos
 * titulares a la vez, así que reasignar es sobrescribir, no agregar.
 */
create or replace function pdt_zona_asignar(p_actor text, p_zona text, p_educador_correo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
end $$;

/** Quita la titularidad de una zona (queda sin dueño hasta que alguien la reasigne). */
create or replace function pdt_zona_quitar(p_actor text, p_zona text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_zona  text := trim(coalesce(p_zona, ''));
begin
    delete from pdt_zona_educador where zona = v_zona;
    return jsonb_build_object('zona', v_zona, 'quitado', true);
end $$;

/*
 * Agrega una cobertura: `p_educador_correo` puede operar `p_zona` desde `p_desde` hasta
 * `p_hasta` (null = indefinida). No toca la titularidad — es una excepción, no un reemplazo.
 */
create or replace function pdt_cobertura_agregar(
    p_actor          text,
    p_zona           text,
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
end $$;

/** Quita una cobertura (revocarla antes de tiempo, o borrar una capturada por error). */
create or replace function pdt_cobertura_quitar(p_actor text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
begin
    delete from pdt_zona_cobertura where id = p_id;
    return jsonb_build_object('id', p_id, 'quitado', true);
end $$;

/** Todo lo que el panel de Administración necesita para pintarse: titulares + coberturas. */
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
        ), '[]'::jsonb)
    );
end $$;

-- ---------- pdt_visitas_en_alcance: ahora también por zona ----------

/*
 * Se reemplaza entera porque no hay ALTER FUNCTION parcial en Postgres. El cuerpo es el mismo
 * de `20260721_pdt_zona_gerente_notas.sql` más dos cambios:
 *   1. `permitidos` ahora es la UNIÓN de por-jerarquía (`pdt_alcance`, ya existía) y por-zona
 *      (`pdt_zonas_de` cruzado contra `pdt_visitas.zona`, nuevo) — cualquiera de los dos basta.
 *   2. Se agrega `id_estrategia` al JSON de salida.
 */
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
    visibles as (
        select v.*
        from pdt_visitas v
        where (
            v.educador_correo in (select correo from por_persona)
            or (v.zona is not null and v.zona in (select zona from mis_zonas))
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

-- ---------- pdt_espejo_guardar: ahora también guarda id_estrategia ----------

create or replace function pdt_espejo_guardar(p_correo text, p_visitas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
            zona, ejecutivo, notas, id_estrategia
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
            v->>'zona', v->>'ejecutivo', v->>'notas', v->>'id_estrategia'
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
            id_estrategia = excluded.id_estrategia;

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
$$;

revoke execute on function pdt_espejo_guardar(text, jsonb) from public, anon, authenticated;
grant execute on function pdt_espejo_guardar(text, jsonb) to service_role;

-- ---------- permisos de ejecución de lo nuevo ----------

revoke execute on function pdt_zonas_de(text)                                          from public, anon, authenticated;
revoke execute on function pdt_zona_asignar(text, text, text)                           from public, anon, authenticated;
revoke execute on function pdt_zona_quitar(text, text)                                  from public, anon, authenticated;
revoke execute on function pdt_cobertura_agregar(text, text, text, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function pdt_cobertura_quitar(text, uuid)                             from public, anon, authenticated;
revoke execute on function pdt_territorios_listar(text)                                 from public, anon, authenticated;

grant execute on function pdt_zonas_de(text)                                          to service_role;
grant execute on function pdt_zona_asignar(text, text, text)                          to service_role;
grant execute on function pdt_zona_quitar(text, text)                                 to service_role;
grant execute on function pdt_cobertura_agregar(text, text, text, timestamptz, timestamptz, text) to service_role;
grant execute on function pdt_cobertura_quitar(text, uuid)                            to service_role;
grant execute on function pdt_territorios_listar(text)                                to service_role;
