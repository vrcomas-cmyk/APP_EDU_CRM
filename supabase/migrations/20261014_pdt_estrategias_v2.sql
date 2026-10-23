-- Estrategias v2: descripción y estatus por estrategia, catálogo de estatus, descripciones de
-- tipos y etapa "Cerrado". Las etapas ya existentes (Aceptado, Venta, Rechazado…) se conservan.

alter table pdt_estrategias add column if not exists descripcion text;
alter table pdt_estrategias add column if not exists estatus text default 'Pendiente';

-- ---------- tipos: descripciones de apoyo ----------

update pdt_estrategia_tipos set descripcion = case clave
    when 'conversion'   then 'Inclusión de una línea de productos que el cliente actualmente no compra.'
    when 'catalogacion' then 'Aumentar el número de productos que el cliente compra de una línea.'
    when 'recuperacion' then 'Recuperar venta de productos que antes compraba el cliente.'
    when 'desviacion'   then 'Recuperar volumen de consumo de un producto o línea de productos que ya compra el cliente.'
    when 'incremento'   then 'Aumentar el volumen de consumo de un producto o línea de productos que ya compra el cliente.'
    when 'ventas'       then 'Requerimiento directo realizado por el área de ventas.'
    when 'bi'           then 'Oportunidad de negocio identificada por el área de Business Intelligence (BI).'
    else descripcion end
where clave in ('conversion','catalogacion','recuperacion','desviacion','incremento','ventas','bi');

-- ---------- etapas: Cerrado y descripciones de cierre ----------

update pdt_etapas set descripcion = 'Se concretó satisfactoriamente.' where clave = 'finalizado';

insert into pdt_etapas (clave, nombre, descripcion, orden) values
    ('cerrado', 'Cerrado', 'No se concretó negocio.', 14)
on conflict (clave) do nothing;

-- ---------- catálogo de estatus ----------

create table if not exists pdt_estrategia_estatus (
    clave       text primary key,
    nombre      text not null,
    descripcion text,
    activo      boolean not null default true,
    orden       int not null default 0
);

alter table pdt_estrategia_estatus enable row level security;

insert into pdt_estrategia_estatus (clave, nombre, orden) values
    ('pendiente',   'Pendiente',   1),
    ('en_curso',    'En curso',    2),
    ('en_revision', 'En revisión', 3),
    ('finalizado',  'Finalizado',  4),
    ('cerrado',     'Cerrado',     5)
on conflict (clave) do nothing;

create or replace function pdt_estrategia_estatus_lista()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', t.clave, 'nombre', t.nombre, 'descripcion', t.descripcion,
        'activo', t.activo, 'orden', t.orden
    ) order by t.orden, t.clave), '[]'::jsonb)
    from pdt_estrategia_estatus t
$$;

revoke execute on function pdt_estrategia_estatus_lista() from public, anon, authenticated;
grant  execute on function pdt_estrategia_estatus_lista() to service_role;

-- ---------- guardar / leer con los campos nuevos ----------

create or replace function pdt_estrategias_guardar_sesion(p_sesion_token text, p_estrategias jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_correo  text := pdt_correo_de_sesion(p_sesion_token);
    v_nombre  text;
    e         jsonb;
    v_previa  text;
    v_nueva   text;
    n         int := 0;
begin
    select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;

    for e in select * from jsonb_array_elements(coalesce(p_estrategias, '[]'::jsonb))
    loop
        continue when coalesce(e->>'id', '') = '' or coalesce(e->>'cliente', '') = '';

        select etapa into v_previa from pdt_estrategias where id = e->>'id';
        v_nueva := nullif(trim(e->>'etapa'), '');

        insert into pdt_estrategias (
            id, cliente, sector, grupo_articulo, tipo_estrategia, descripcion, etapa, estatus,
            proyecto, productos, observaciones, actualizado, actualizado_por, actualizado_correo
        ) values (
            e->>'id', trim(e->>'cliente'), nullif(e->>'sector', ''),
            nullif(e->>'grupo_articulo', ''), nullif(e->>'tipo_estrategia', ''),
            nullif(e->>'descripcion', ''), v_nueva,
            coalesce(nullif(trim(e->>'estatus'), ''), 'Pendiente'),
            nullif(e->>'proyecto', ''),
            case when jsonb_typeof(e->'productos') = 'array' then e->'productos' else null end,
            nullif(e->>'observaciones', ''),
            now(), coalesce(nullif(e->>'actualizado_por', ''), v_nombre, v_correo), v_correo
        )
        on conflict (id) do update set
            cliente            = excluded.cliente,
            sector             = excluded.sector,
            grupo_articulo     = excluded.grupo_articulo,
            tipo_estrategia    = excluded.tipo_estrategia,
            descripcion        = excluded.descripcion,
            etapa              = excluded.etapa,
            estatus            = excluded.estatus,
            proyecto           = excluded.proyecto,
            productos          = excluded.productos,
            observaciones      = excluded.observaciones,
            actualizado        = now(),
            actualizado_por    = excluded.actualizado_por,
            actualizado_correo = excluded.actualizado_correo;

        if v_nueva is not null and v_nueva is distinct from v_previa then
            insert into pdt_estrategia_etapas (id_estrategia, etapa, actor_correo, actor_nombre)
            values (e->>'id', v_nueva, v_correo, v_nombre);
        end if;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'guardadas', n);
end;
$$;

-- Volátil (sin `stable`), como la dejó 20260929_pdt_lecturas_sesion_volatiles.
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
        'actualizado', e.actualizado, 'actualizado_por', e.actualizado_por,
        'actualizado_correo', e.actualizado_correo,
        'etapas', coalesce((
            select jsonb_agg(jsonb_build_object(
                'etapa', h.etapa, 'momento', h.momento,
                'actor_correo', h.actor_correo, 'actor_nombre', h.actor_nombre, 'nota', h.nota
            ) order by h.momento, h.seq)
            from pdt_estrategia_etapas h where h.id_estrategia = e.id
        ), '[]'::jsonb)
    ) order by e.cliente, e.sector), '[]'::jsonb)
    from pdt_estrategias e, sesion
    where sesion.correo is not null;
$$;
