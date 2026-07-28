-- Plan de Trabajo — histórico pre-AppSheet, solo lectura.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Dos archivos Excel viejos ("Registro Actividades" y "Registro Plan de Trabajo") traen datos
-- reales de educadores de antes de que este sistema existiera. No tienen un ID que los ligue
-- entre sí (solo nombre+fecha, ambiguo), así que en vez de forzar una relación que los datos no
-- soportan, viven en dos tablas propias, desconectadas entre sí y de las tablas en vivo
-- (`pdt_visitas`/`pdt_actividades`). Son de solo lectura: RLS activo y sin políticas de
-- escritura para nadie salvo `service_role` — ver la carga en la migración de datos que sigue.

create table if not exists pdt_historico_actividades (
    id                  bigint generated always as identity primary key,
    no_doc              int,
    fecha_carga         timestamptz,
    fecha_documento     date,
    educador_nombre     text,
    educador_correo     text,
    tipo_actividad      text,
    cliente_no          text,
    cliente_razon_social text,
    hospital            text,
    sector              text,
    grupo_articulo      text,
    articulo_codigo     text,
    articulo            text,
    resultado           text,
    folio               text,
    contacto_responsable text,
    contacto_cargo      text,
    servicio            text,
    gerencia_marca      text,
    importado_en        timestamptz not null default now()
);

create index if not exists pdt_historico_actividades_correo_idx
    on pdt_historico_actividades (educador_correo, fecha_documento);

create table if not exists pdt_historico_plan_trabajo (
    id               bigint generated always as identity primary key,
    anio             int,
    mes              text,
    semana           int,
    dia_semana       text,
    fecha            date,
    educador_nombre  text,
    educador_correo  text,
    gerencia_marca   text,
    hora_inicio      text,
    hora_llegada     text,
    puntualidad      text,
    justificacion    text,
    zona             text,
    cliente_no       text,
    cliente          text,
    hospital         text,
    area_visitada    text,
    sector           text,
    objetivo         text,
    efectividad      text,
    origen_actividad text,
    solicitante      text,
    notas            text,
    comentarios      text,
    importado_en     timestamptz not null default now()
);

create index if not exists pdt_historico_plan_trabajo_correo_idx
    on pdt_historico_plan_trabajo (educador_correo, fecha);

alter table pdt_historico_actividades enable row level security;
alter table pdt_historico_plan_trabajo enable row level security;

comment on table pdt_historico_actividades is
    'Histórico de actividades pre-AppSheet (Excel "Registro Actividades_Educador Clínico"). '
    'Solo lectura vía pdt_historico_actividades_listar; sin relación con pdt_actividades.';
comment on table pdt_historico_plan_trabajo is
    'Histórico de plan de trabajo pre-AppSheet (Excel "Registro Plan de Trabajo - Educador '
    'Clínico"). Solo lectura vía pdt_historico_plan_trabajo_listar; sin relación con pdt_visitas.';

-- ---------- lectura ----------

create or replace function pdt_historico_actividades_listar(p_correo text default null)
returns setof pdt_historico_actividades
language sql
stable
security definer
set search_path = public
as $$
    select * from pdt_historico_actividades
    where p_correo is null or lower(trim(educador_correo)) = lower(trim(p_correo))
    order by fecha_documento desc nulls last, no_doc desc
$$;

create or replace function pdt_historico_plan_trabajo_listar(p_correo text default null)
returns setof pdt_historico_plan_trabajo
language sql
stable
security definer
set search_path = public
as $$
    select * from pdt_historico_plan_trabajo
    where p_correo is null or lower(trim(educador_correo)) = lower(trim(p_correo))
    order by fecha desc nulls last
$$;

revoke execute on function pdt_historico_actividades_listar(text) from public, anon;
grant execute on function pdt_historico_actividades_listar(text) to authenticated, service_role;
revoke execute on function pdt_historico_plan_trabajo_listar(text) from public, anon;
grant execute on function pdt_historico_plan_trabajo_listar(text) to authenticated, service_role;
