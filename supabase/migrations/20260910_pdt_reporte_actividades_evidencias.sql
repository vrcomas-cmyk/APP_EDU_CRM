-- El reporte descargable necesita una fila por actividad con el vínculo de su evidencia.
-- No abre tablas ni permisos nuevos: conserva exactamente el mismo filtro de alcance que el
-- reporte en pantalla y solo expone campos que ya puede consultar quien recibe esa fila.

create or replace function pdt_reporte_actividades(
    p_correo text, p_desde date default null, p_hasta date default null,
    p_sector text default null, p_actividad text default null, p_educador text default null,
    p_todas boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with mis_sectores as (
        select sector from pdt_sectores_de_gerente(p_correo)
    ), base as (
        select a.id as id_actividad, v.id as id_visita, a.tipo, s.nombre as sector,
               v.dia, v.cliente, v.hospital, v.hora_inicio, v.hora_fin, v.estado as estado_visita,
               v.educador_correo, v.educador, a.area_visitada, a.contacto_nombre,
               a.contacto_cargo, a.contacto_servicio, a.evidencia_estado, a.evidencia_url,
               coalesce(a.fecha_documento, v.dia) as fecha_efectiva,
               pdt_jefe_de_en_fecha(v.educador_correo, coalesce(a.fecha_documento, v.dia)) as jefe_correo
        from pdt_actividades a
        join pdt_sectores s on s.id = a.id_sector
        join pdt_visitas v on v.id = a.id_visita
        where a.guardada_momento is not null
    ), visibles as (
        select b.* from base b
        where (p_todas or lower(trim(b.educador_correo)) = lower(trim(p_correo)) or
              (b.jefe_correo = lower(trim(p_correo)) and exists (select 1 from mis_sectores ms where ms.sector = b.sector)))
          and (p_desde is null or b.fecha_efectiva >= p_desde)
          and (p_hasta is null or b.fecha_efectiva <= p_hasta)
          and (p_sector is null or b.sector = p_sector)
          and (p_actividad is null or b.tipo = p_actividad)
          and (p_educador is null or lower(trim(b.educador_correo)) = lower(trim(p_educador)))
    )
    select jsonb_build_object(
        'total', (select count(*) from visibles),
        'por_sector', (select coalesce(jsonb_agg(jsonb_build_object('sector', sector, 'n', n) order by n desc), '[]'::jsonb)
                       from (select coalesce(sector, '(sin sector)') sector, count(*) n from visibles group by sector) t),
        'por_actividad', (select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'n', n) order by n desc), '[]'::jsonb)
                          from (select coalesce(tipo, '(sin tipo)') tipo, count(*) n from visibles group by tipo) t),
        'filas', (select coalesce(jsonb_agg(jsonb_build_object(
            'id_visita', x.id_visita, 'id_actividad', x.id_actividad,
            'jefe_correo', x.jefe_correo, 'jefe', ju.nombre,
            'educador_correo', x.educador_correo, 'educador', x.educador,
            'tipo', x.tipo, 'sector', x.sector, 'cliente', x.cliente, 'hospital', x.hospital,
            'fecha', to_char(x.fecha_efectiva, 'YYYY-MM-DD'), 'mes', to_char(x.fecha_efectiva, 'YYYY-MM'),
            'hora_inicio', x.hora_inicio, 'hora_fin', x.hora_fin, 'estado_visita', x.estado_visita,
            'area_visitada', x.area_visitada, 'contacto_nombre', x.contacto_nombre,
            'contacto_cargo', x.contacto_cargo, 'contacto_servicio', x.contacto_servicio,
            'evidencia_estado', x.evidencia_estado, 'evidencia_url', x.evidencia_url
        )), '[]'::jsonb) from visibles x
        left join pdt_usuarios ju on lower(trim(ju.correo)) = x.jefe_correo)
    )
$$;

revoke execute on function pdt_reporte_actividades(text, date, date, text, text, text, boolean)
    from public, anon, authenticated;
grant execute on function pdt_reporte_actividades(text, date, date, text, text, text, boolean)
    to service_role;
