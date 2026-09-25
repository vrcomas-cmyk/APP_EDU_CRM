-- Plan de Trabajo — Estrategias pasa de Google Sheets a Supabase.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- ── Qué estaba mal ──────────────────────────────────────────────────────────────────
--
-- Estrategias (Cliente × Sector × Grupo de Artículo) vivía SOLO en la hoja "Estrategias"
-- (`guardarEstrategias`/`leerEstrategias` en Codigo.gs), sin tabla en Supabase. Cada
-- sobrescritura de "etapa" perdía el valor anterior — no había forma de ver cómo se fue dando
-- el avance de una estrategia en el tiempo, ni de consolidar la vista por cliente sin recorrer
-- la hoja entera a mano.
--
-- ── Qué se resuelve aquí ────────────────────────────────────────────────────────────
--
-- 1. `pdt_estrategias`: la misma fila Cliente×Sector×Grupo de siempre, ahora en Postgres.
-- 2. `pdt_estrategia_etapas`: histórico APPEND-ONLY de cambios de etapa (mismo patrón que
--    `pdt_revisiones`/`pdt_revision_vigente` — nunca se edita ni se borra una fila, "la etapa
--    actual" es la más reciente). No es lineal a propósito: no se valida secuencia, solo se
--    registra cada tránsito con quién y cuándo, para poder verlo como línea de tiempo.
-- 3. `pdt_estrategia_tipos` / `pdt_etapas`: catálogos administrables (mismo patrón ficha+activo
--    que `pdt_flujos_revision`), sembrados con los valores por defecto.
--
-- Se llama DIRECTO desde la PWA con la clave anónima (como `pdt_visitas_guardar_sesion`): la
-- identidad se resuelve dentro de Postgres a partir del token de sesión, sin pasar por Apps
-- Script. Apps Script conserva `guardarEstrategias`/`leerEstrategias` como ruta de
-- compatibilidad para cachés viejos, igual que `guardarVisitas`.

-- ---------- pdt_estrategias ----------

create table if not exists pdt_estrategias (
    id                  text primary key,
    cliente             text not null,
    sector              text,
    grupo_articulo      text,
    tipo_estrategia     text,
    etapa               text,
    proyecto            text,
    productos           jsonb,
    observaciones       text,
    actualizado         timestamptz not null default now(),
    actualizado_por     text,
    actualizado_correo  text
);

create index if not exists pdt_estrategias_cliente_idx on pdt_estrategias (lower(cliente));

alter table pdt_estrategias enable row level security;
-- Sin políticas a propósito: es una referencia compartida (cualquier educador o gerente la
-- corrige), no un dato por dueño — se administra completa desde las RPC de abajo.

-- ---------- pdt_estrategia_etapas: histórico append-only ----------

create table if not exists pdt_estrategia_etapas (
    id             bigserial primary key,
    id_estrategia  text not null references pdt_estrategias(id) on delete cascade,
    etapa          text not null,
    momento        timestamptz not null default now(),
    seq            bigserial,
    actor_correo   text,
    actor_nombre   text,
    nota           text
);

create index if not exists pdt_estrategia_etapas_estrategia_idx
    on pdt_estrategia_etapas (id_estrategia, momento desc, seq desc);

alter table pdt_estrategia_etapas enable row level security;

/* "Etapa vigente" de cada estrategia: la fila más reciente, nunca un valor que se reescribe. */
create or replace view pdt_estrategia_etapa_vigente as
select distinct on (id_estrategia) *
from pdt_estrategia_etapas
order by id_estrategia, momento desc, seq desc;

-- ---------- escritura/lectura directas desde la PWA (sesión, no admin) ----------

/*
 * Upsert de estrategias + registro de tránsito de etapa cuando cambia.
 *
 * `p_estrategias` es un arreglo de objetos con la misma forma que ya arma la PWA:
 * { id, cliente, sector, grupo_articulo, tipo_estrategia, etapa, proyecto, productos,
 *   observaciones, actualizado_por }.
 *
 * No es "de quién es esta fila": cualquier sesión válida puede corregir cualquier estrategia,
 * igual que el Sheet de antes — el token de sesión aquí solo prueba que quien llama inició
 * sesión, no que sea dueño de nada.
 */
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
            id, cliente, sector, grupo_articulo, tipo_estrategia, etapa, proyecto,
            productos, observaciones, actualizado, actualizado_por, actualizado_correo
        ) values (
            e->>'id', trim(e->>'cliente'), nullif(e->>'sector', ''),
            nullif(e->>'grupo_articulo', ''), nullif(e->>'tipo_estrategia', ''), v_nueva,
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
            etapa              = excluded.etapa,
            proyecto           = excluded.proyecto,
            productos          = excluded.productos,
            observaciones      = excluded.observaciones,
            actualizado        = now(),
            actualizado_por    = excluded.actualizado_por,
            actualizado_correo = excluded.actualizado_correo;

        -- Se registra el tránsito SOLO si la etapa de verdad cambió — guardar la misma
        -- estrategia sin tocar la etapa no debe ensuciar la línea de tiempo con "no-cambios".
        if v_nueva is not null and v_nueva is distinct from v_previa then
            insert into pdt_estrategia_etapas (id_estrategia, etapa, actor_correo, actor_nombre)
            values (e->>'id', v_nueva, v_correo, v_nombre);
        end if;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'guardadas', n);
end;
$$;

/** Borra una estrategia (y su histórico de etapas, por cascada). */
create or replace function pdt_estrategia_eliminar(p_sesion_token text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    delete from pdt_estrategias where id = p_id;
    return jsonb_build_object('ok', true);
end;
$$;

/** Todas las estrategias, con su histórico de etapas anidado — es referencia compartida, no
 *  se recorta por alcance/zona (mismo criterio que ya tenía la hoja de Sheets). */
create or replace function pdt_estrategias_leer_sesion(p_sesion_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with sesion as (select pdt_correo_de_sesion(p_sesion_token) as correo)
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'cliente', e.cliente, 'sector', e.sector,
        'grupo_articulo', e.grupo_articulo, 'tipo_estrategia', e.tipo_estrategia,
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

-- ---------- catálogo administrable: tipos de estrategia ----------

create table if not exists pdt_estrategia_tipos (
    clave       text primary key,
    nombre      text not null,
    descripcion text,
    activo      boolean not null default true,
    orden       int not null default 0
);

alter table pdt_estrategia_tipos enable row level security;

insert into pdt_estrategia_tipos (clave, nombre, descripcion, orden) values
    ('recuperacion',  'Recuperación',  'Recuperar línea perdida en hospital (ya no compran)', 1),
    ('conversion',    'Conversión',    'Nueva línea para que compre el cliente.', 2),
    ('catalogacion',  'Catalogación',  'Aumentar el número de códigos que compra el cliente de una línea de productos', 3),
    ('ventas',        'Ventas',        'Requerimiento realizado por ventas', 4),
    ('bi',            'BI',            'Oportunidad de negocio identificada por BI', 5),
    ('desviacion',    'Desviación',    'Recuperar consumo que el cliente antes realizaba', 6),
    ('incremento',    'Incremento',    'Aumentar la cantidad de consumo del cliente de una línea', 7)
on conflict (clave) do nothing;

create or replace function pdt_estrategia_tipos_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', t.clave, 'nombre', t.nombre, 'descripcion', t.descripcion,
        'activo', t.activo, 'orden', t.orden,
        'usos', (select count(*) from pdt_estrategias e where e.tipo_estrategia = t.clave)
    ) order by t.orden, t.clave), '[]'::jsonb)
    from pdt_estrategia_tipos t
$$;

create or replace function pdt_estrategia_tipo_guardar(p_actor text, p_tipo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_clave text := lower(trim(coalesce(p_tipo->>'clave', '')));
begin
    if v_clave = '' then
        raise exception 'El tipo de estrategia necesita una clave.';
    end if;
    if v_clave !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'La clave "%" solo puede llevar minúsculas, números y guion bajo, y '
                        'debe empezar por letra.', v_clave;
    end if;

    insert into pdt_estrategia_tipos (clave, nombre, descripcion, activo, orden)
    values (
        v_clave,
        coalesce(nullif(trim(p_tipo->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_tipo->>'descripcion'), ''),
        coalesce((p_tipo->>'activo')::boolean, true),
        coalesce((p_tipo->>'orden')::int, 0)
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            activo      = excluded.activo,
            orden       = excluded.orden;

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $$;

create or replace function pdt_estrategia_tipo_eliminar(p_actor text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_clave text := lower(trim(coalesce(p_clave, '')));
    v_usos  int;
begin
    select count(*) into v_usos from pdt_estrategias where tipo_estrategia = v_clave;

    if v_usos > 0 then
        raise exception 'El tipo "%" ya lo usan % estrategia(s) guardadas; desactívalo en vez '
                        'de borrarlo para no dejarlas sin clasificar.', v_clave, v_usos;
    end if;

    delete from pdt_estrategia_tipos where clave = v_clave;

    return jsonb_build_object('clave', v_clave, 'borrado', true);
end $$;

-- ---------- catálogo administrable: etapas ----------

create table if not exists pdt_etapas (
    clave       text primary key,
    nombre      text not null,
    descripcion text,
    activo      boolean not null default true,
    orden       int not null default 0
);

alter table pdt_etapas enable row level security;

insert into pdt_etapas (clave, nombre, orden) values
    ('presentacion',      'Presentación', 1),
    ('capacitacion',      'Capacitación', 2),
    ('evaluacion',        'Evaluación', 3),
    ('solicitud_muestra', 'Solicitud Muestra', 4),
    ('equipamiento',      'Equipamiento', 5),
    ('aceptado',          'Aceptado', 6),
    ('negociacion',       'Negociación', 7),
    ('cotizacion',        'Cotización', 8),
    ('pedido',            'Pedido', 9),
    ('venta',             'Venta', 10),
    ('rechazado',         'Rechazado', 11),
    ('descartado',        'Descartado', 12)
on conflict (clave) do nothing;

insert into pdt_etapas (clave, nombre, descripcion, orden) values
    ('finalizado', 'Finalizado', 'Si se concretó o no', 13)
on conflict (clave) do nothing;

create or replace function pdt_etapas_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', t.clave, 'nombre', t.nombre, 'descripcion', t.descripcion,
        'activo', t.activo, 'orden', t.orden,
        'usos', (
            select count(*) from pdt_estrategia_etapas h where h.etapa = t.nombre
        )
    ) order by t.orden, t.clave), '[]'::jsonb)
    from pdt_etapas t
$$;

create or replace function pdt_etapa_guardar(p_actor text, p_etapa jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_clave text := lower(trim(coalesce(p_etapa->>'clave', '')));
begin
    if v_clave = '' then
        raise exception 'La etapa necesita una clave.';
    end if;
    if v_clave !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'La clave "%" solo puede llevar minúsculas, números y guion bajo, y '
                        'debe empezar por letra.', v_clave;
    end if;

    insert into pdt_etapas (clave, nombre, descripcion, activo, orden)
    values (
        v_clave,
        coalesce(nullif(trim(p_etapa->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_etapa->>'descripcion'), ''),
        coalesce((p_etapa->>'activo')::boolean, true),
        coalesce((p_etapa->>'orden')::int, 0)
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            activo      = excluded.activo,
            orden       = excluded.orden;

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $$;

/*
 * Borra una etapa del catálogo. El histórico de tránsitos (`pdt_estrategia_etapas`) guarda el
 * NOMBRE, no la clave del catálogo — así que borrar una etapa de aquí no rompe la línea de
 * tiempo ya escrita, solo deja de ofrecerla para elegir en adelante. Aun así se avisa si algún
 * tránsito la usó, por si se querría desactivar en vez de borrar.
 */
create or replace function pdt_etapa_eliminar(p_actor text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor  text := pdt_exige_admin(p_actor);
    v_clave  text := lower(trim(coalesce(p_clave, '')));
    v_nombre text;
    v_usos   int;
begin
    select nombre into v_nombre from pdt_etapas where clave = v_clave;
    if v_nombre is not null then
        select count(*) into v_usos from pdt_estrategia_etapas where etapa = v_nombre;
    end if;

    if coalesce(v_usos, 0) > 0 then
        raise exception 'La etapa "%" ya aparece en % tránsito(s) guardados; desactívala en '
                        'vez de borrarla para conservar la línea de tiempo.', v_nombre, v_usos;
    end if;

    delete from pdt_etapas where clave = v_clave;

    return jsonb_build_object('clave', v_clave, 'borrado', true);
end $$;

-- ---------- permisos de ejecución ----------

-- Superficie para la PWA (identidad por sesión, no admin — cualquiera puede escribir).
revoke execute on function pdt_estrategias_guardar_sesion(text, jsonb) from public;
revoke execute on function pdt_estrategias_leer_sesion(text)          from public;
revoke execute on function pdt_estrategia_eliminar(text, text)        from public;

grant execute on function pdt_estrategias_guardar_sesion(text, jsonb) to anon, authenticated, service_role;
grant execute on function pdt_estrategias_leer_sesion(text)          to anon, authenticated, service_role;
grant execute on function pdt_estrategia_eliminar(text, text)        to anon, authenticated, service_role;

-- Catálogos: solo Apps Script (service_role), como Flujos/Roles.
revoke execute on function pdt_estrategia_tipos_admin()              from public, anon, authenticated;
revoke execute on function pdt_estrategia_tipo_guardar(text, jsonb)   from public, anon, authenticated;
revoke execute on function pdt_estrategia_tipo_eliminar(text, text)   from public, anon, authenticated;
revoke execute on function pdt_etapas_admin()                        from public, anon, authenticated;
revoke execute on function pdt_etapa_guardar(text, jsonb)             from public, anon, authenticated;
revoke execute on function pdt_etapa_eliminar(text, text)             from public, anon, authenticated;

grant execute on function pdt_estrategia_tipos_admin()                to service_role;
grant execute on function pdt_estrategia_tipo_guardar(text, jsonb)    to service_role;
grant execute on function pdt_estrategia_tipo_eliminar(text, text)    to service_role;
grant execute on function pdt_etapas_admin()                          to service_role;
grant execute on function pdt_etapa_guardar(text, jsonb)              to service_role;
grant execute on function pdt_etapa_eliminar(text, text)              to service_role;
