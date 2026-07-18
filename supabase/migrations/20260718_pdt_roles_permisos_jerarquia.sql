-- Plan de Trabajo — roles, permisos y jerarquía organizacional.
--
-- ⚠ Este proyecto de Supabase está COMPARTIDO con otras aplicaciones (CRM, MSC, portal,
--   tasks…). Todo lo de Plan de Trabajo va con prefijo `pdt_` y esta migración es puramente
--   ADITIVA: no toca, altera ni borra ningún objeto que no sea suyo.
--
-- Google Sheets, Drive y Apps Script siguen siendo la capa operativa y NO se sustituyen.
-- Esto solo agrega el control de acceso, que Sheets no puede dar: una hoja no sabe filtrar
-- por fila según quién pregunta.

-- ---------- roles ----------

create table if not exists pdt_roles (
    clave       text primary key,
    nombre      text not null,
    descripcion text,
    orden       int  not null default 0,
    creado_en   timestamptz not null default now()
);

comment on table pdt_roles is
    'Roles de Plan de Trabajo. Agregar uno nuevo NO requiere tocar la aplicación.';

-- ---------- permisos por módulo y acción ----------

create table if not exists pdt_permisos (
    rol    text not null references pdt_roles(clave) on delete cascade,
    modulo text not null,
    accion text not null,
    primary key (rol, modulo, accion)
);

comment on table pdt_permisos is
    'Un renglón por (rol, módulo, acción) permitido. La ausencia de renglón es la negación: '
    'no existe una lista de denegados que pudiera contradecir a la de permitidos.';

-- ---------- usuarios ----------

create table if not exists pdt_usuarios (
    correo    text primary key,
    nombre    text,
    rol       text references pdt_roles(clave),
    activo    boolean not null default true,
    creado_en timestamptz not null default now()
);

-- ---------- jerarquía ----------

-- Muchos a muchos a propósito: el spec pide que alguien pueda reportar a más de una persona.
-- Una columna `jefe` en pdt_usuarios no podría representarlo.
create table if not exists pdt_jerarquia (
    jefe        text not null,
    subordinado text not null,
    creado_en   timestamptz not null default now(),
    primary key (jefe, subordinado),
    -- Nadie es su propio jefe: dejarlo pasar haría que el cálculo de alcance se viera bien
    -- pero escondiera ciclos triviales.
    constraint pdt_jerarquia_no_self check (jefe <> subordinado)
);

create index if not exists pdt_jerarquia_jefe_idx on pdt_jerarquia (jefe);

-- ---------- alcance ----------

-- A quién puede VER un usuario: él mismo más todo lo que cuelgue de él, a cualquier
-- profundidad. Recursivo porque la jerarquía es un árbol (gerente → supervisor → educador)
-- y un JOIN de un nivel dejaría fuera a los nietos.
--
-- `cycle` corta los ciclos: la tabla permite A→B y B→A, y sin esto la consulta no terminaría.
create or replace function pdt_alcance(p_correo text)
returns table (correo text)
language sql
stable
security definer
set search_path = public
as $$
    with recursive baja as (
        select lower(trim(p_correo)) as correo
        union
        select j.subordinado
        from pdt_jerarquia j
        join baja b on lower(j.jefe) = b.correo
    )
    select distinct baja.correo from baja
$$;

comment on function pdt_alcance is
    'Correos que p_correo puede ver: él mismo y toda su descendencia jerárquica.';

-- ---------- perfil ----------

-- Todo lo que la PWA necesita saber de quien entra, en UNA llamada: su rol, sus permisos y
-- su alcance. Tres consultas separadas darían tres estados de carga distintos en pantalla.
create or replace function pdt_perfil(p_correo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with yo as (
        select lower(trim(p_correo)) as correo
    ),
    usuario as (
        select u.* from pdt_usuarios u, yo where lower(u.correo) = yo.correo and u.activo
    ),
    -- Un admin de la tabla vieja sigue siendo admin aunque nadie lo haya dado de alta en
    -- pdt_usuarios: quitarle el acceso al migrar sería romper algo que ya funcionaba.
    es_admin_legado as (
        select exists (
            select 1 from pdt_admins a, yo where lower(a.correo) = yo.correo
        ) as v
    ),
    rol_efectivo as (
        select coalesce(
            (select rol from usuario),
            case when (select v from es_admin_legado) then 'administrador' else null end
        ) as rol
    )
    select jsonb_build_object(
        'correo',   (select correo from yo),
        'nombre',   (select nombre from usuario),
        'rol',      (select rol from rol_efectivo),
        'es_admin', (select v from es_admin_legado)
                    or (select rol from rol_efectivo) = 'administrador',
        'permisos', coalesce((
            select jsonb_agg(distinct p.modulo || '.' || p.accion)
            from pdt_permisos p
            where p.rol = (select rol from rol_efectivo)
        ), '[]'::jsonb),
        'alcance',  coalesce((
            select jsonb_agg(a.correo) from pdt_alcance((select correo from yo)) a
        ), '[]'::jsonb)
    )
$$;

comment on function pdt_perfil is
    'Rol, permisos y alcance jerárquico de un correo, en una sola llamada.';

-- ---------- RLS ----------

-- Estas tablas se leen con la clave anónima desde la PWA, así que se abren SOLO a lectura.
-- Escribir es exclusivo del rol de servicio (Administración pasa por Apps Script, que sí
-- tiene identidad verificada). Sin esto, cualquiera con la anon key podría darse permisos.
alter table pdt_roles      enable row level security;
alter table pdt_permisos   enable row level security;
alter table pdt_usuarios   enable row level security;
alter table pdt_jerarquia  enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where tablename = 'pdt_roles' and policyname = 'pdt_roles_lectura') then
        create policy pdt_roles_lectura on pdt_roles for select using (true);
    end if;
    if not exists (select 1 from pg_policies where tablename = 'pdt_permisos' and policyname = 'pdt_permisos_lectura') then
        create policy pdt_permisos_lectura on pdt_permisos for select using (true);
    end if;
    -- Usuarios y jerarquía NO se exponen en bruto: revelarían el organigrama completo a
    -- cualquiera con la anon key. Se consultan únicamente a través de pdt_perfil, que es
    -- security definer y solo devuelve lo que corresponde al correo preguntado.
end $$;

-- ---------- semilla ----------

-- Los cuatro perfiles que el spec pide como mínimo. `on conflict do nothing` para que
-- reaplicar la migración no pise lo que Administración haya cambiado después.
insert into pdt_roles (clave, nombre, descripcion, orden) values
    ('administrador', 'Administrador', 'Configura la plataforma y ve toda la información.', 1),
    ('gerente',       'Gerente',       'Ve y revisa la información de su equipo.',          2),
    ('analista',      'Analista',      'Consulta y exporta información para análisis.',     3),
    ('educador',      'Educador Clínico', 'Captura y consulta únicamente lo suyo.',         4)
on conflict (clave) do nothing;

insert into pdt_permisos (rol, modulo, accion) values
    -- administrador
    ('administrador','visitas','crear'),      ('administrador','visitas','consultar'),
    ('administrador','visitas','revisar'),    ('administrador','visitas','calificar'),
    ('administrador','visitas','exportar'),
    ('administrador','actividades','crear'),  ('administrador','actividades','consultar'),
    ('administrador','actividades','revisar'),('administrador','actividades','calificar'),
    ('administrador','materiales','crear'),   ('administrador','materiales','consultar'),
    ('administrador','materiales','revisar'),
    ('administrador','evidencias','subir'),   ('administrador','evidencias','consultar'),
    ('administrador','evidencias','aprobar'), ('administrador','evidencias','rechazar'),
    ('administrador','evidencias','solicitar_correccion'),
    ('administrador','comentarios','crear'),  ('administrador','comentarios','leer'),
    ('administrador','comentarios','responder'),
    ('administrador','dashboards','personal'),('administrador','dashboards','equipo'),
    ('administrador','dashboards','general'),
    ('administrador','administracion','configurar'),

    -- gerente
    ('gerente','visitas','crear'),        ('gerente','visitas','consultar'),
    ('gerente','visitas','revisar'),      ('gerente','visitas','calificar'),
    ('gerente','visitas','exportar'),
    ('gerente','actividades','consultar'),('gerente','actividades','revisar'),
    ('gerente','actividades','calificar'),
    ('gerente','materiales','consultar'), ('gerente','materiales','revisar'),
    ('gerente','evidencias','consultar'), ('gerente','evidencias','aprobar'),
    ('gerente','evidencias','rechazar'),  ('gerente','evidencias','solicitar_correccion'),
    ('gerente','comentarios','crear'),    ('gerente','comentarios','leer'),
    ('gerente','comentarios','responder'),
    ('gerente','dashboards','personal'),  ('gerente','dashboards','equipo'),

    -- analista
    ('analista','visitas','consultar'),   ('analista','visitas','exportar'),
    ('analista','actividades','consultar'),
    ('analista','materiales','consultar'),
    ('analista','evidencias','consultar'),
    ('analista','comentarios','leer'),
    ('analista','dashboards','personal'), ('analista','dashboards','equipo'),
    ('analista','dashboards','general'),

    -- educador clínico
    ('educador','visitas','crear'),       ('educador','visitas','consultar'),
    ('educador','actividades','crear'),   ('educador','actividades','consultar'),
    ('educador','materiales','crear'),    ('educador','materiales','consultar'),
    ('educador','evidencias','subir'),    ('educador','evidencias','consultar'),
    ('educador','comentarios','crear'),   ('educador','comentarios','leer'),
    ('educador','comentarios','responder'),
    ('educador','dashboards','personal')
on conflict (rol, modulo, accion) do nothing;
