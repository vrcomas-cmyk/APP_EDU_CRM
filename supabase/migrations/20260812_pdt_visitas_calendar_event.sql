-- Plan de Trabajo — vínculo persistente con el evento espejo en Google Calendar.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- `calendar_event_id` solo vivía en el localStorage del dispositivo que creó el evento. Al
-- sincronizar en otro dispositivo, `adoptarVisitasPropias` en la PWA reemplaza la visita local
-- entera por la que baja del espejo — y como el espejo nunca lo guardaba, el id se perdía ahí
-- mismo. Resultado real: un segundo dispositivo no reconocía el evento ya creado y generaba uno
-- duplicado, y cancelar desde ese dispositivo no podía borrar el original por no tener el id.
-- Con esta columna el id viaja con la visita como cualquier otro campo, y sobrevive el viaje
-- ida y vuelta por el espejo.

alter table pdt_visitas add column if not exists calendar_event_id text;

-- ---------- pdt_espejo_guardar: recibe calendar_event_id del árbol que manda la PWA ----------

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
$$;

-- ---------- pdt_visitas_en_alcance: devuelve calendar_event_id para que la PWA lo reconozca ----------

create or replace function pdt_visitas_en_alcance(
    p_correo text,
    p_desde  date default null,
    p_hasta  date default null,
    p_limite int  default 2000,
    p_todas  boolean default false
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
$$;
