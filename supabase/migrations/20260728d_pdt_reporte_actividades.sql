-- Plan de Trabajo — el reporte de Actividades (réplica del dashboard externo).
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Junta lo que ya existe —actividades, sus sectores, sus visitas— con las dos piezas nuevas:
-- el historial de jerarquía (atribuye cada fila al jefe que llevaba a ese educador ESE día, no
-- al de hoy) y los sectores asignados al gerente (qué línea de producto puede ver del equipo).
--
-- Devuelve granular (`filas`), no ya pivoteado por mes: el cliente arma la tabla mensual y el
-- ranking por cliente con lo que ya sabe hacer (`top`, agrupar) — pivotear meses en SQL sería
-- repetir esa lógica en dos lenguajes para el mismo resultado.
--
-- ── Alcance (quién ve qué fila) ──────────────────────────────────────────────────────────
--
--   - Un administrador real (`p_todas`, decidido por Apps Script, nunca por el cliente): todo.
--   - Cualquiera: SIEMPRE ve lo suyo, en cualquier sector — el sector restringe lo que se ve
--     del EQUIPO, no la propia captura.
--   - Lo del equipo: solo si el educador era su subordinado EN LA FECHA de esa actividad
--     (`pdt_jefe_de_en_fecha`) Y el sector de esa actividad está entre los suyos asignados
--     (`pdt_sectores_de_gerente`). Sin sectores asignados, no ve nada del equipo — el lado
--     seguro: "no configurado" no es "ve todo".

create or replace function pdt_reporte_actividades(
    p_correo    text,
    p_desde     date default null,
    p_hasta     date default null,
    p_sector    text default null,
    p_actividad text default null,
    p_educador  text default null,
    p_todas     boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
        where a.guardada_momento is not null   -- un borrador no es un registro
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
$$;

revoke execute on function pdt_reporte_actividades(text, date, date, text, text, text, boolean)
    from public, anon, authenticated;
grant execute on function pdt_reporte_actividades(text, date, date, text, text, text, boolean)
    to service_role;
