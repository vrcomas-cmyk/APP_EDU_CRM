-- Plan de Trabajo — un administrador real ve TODAS las visitas, no solo su jerarquía.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- El bug reportado: en "Ver como", el admin no veía los registros de la persona simulada
-- aunque sí los tuviera. La causa no era la simulación —esa parte solo cambia qué CORREO se
-- filtra del lado del cliente—; era que el espejo de "equipo" que trae el admin a su propia
-- sesión real (`leerVisitasEquipo` en Apps Script) nunca incluía a esa persona: `pdt_alcance`
-- es puramente jerárquico (`pdt_jerarquia`), y nadie la había puesto como subordinada del
-- admin ahí. Sin la visita en el espejo local, no hay nada que "Ver como" pueda mostrar,
-- venga o no de la simulación.
--
-- `p_todas` lo decide Apps Script, NO el cliente: verifica con `esAdmin(db, identidad.correo)`
-- contra la identidad YA VERIFICADA por Google —la misma comprobación que ya usan
-- `guardarUsuarios`/`guardarRoles`—, nunca contra el perfil simulado. Por eso un administrador
-- ve todo también cuando NO está simulando a nadie: es su alcance real, no un efecto de "ver
-- como". Y sigue siendo de solo LECTURA: qué se puede modificar lo sigue decidiendo el gate de
-- escritura de cada acción, sin relación con esto.

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
