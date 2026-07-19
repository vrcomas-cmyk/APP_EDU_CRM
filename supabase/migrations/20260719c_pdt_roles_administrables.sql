/*
 * Roles administrables desde la aplicación.
 *
 * ── Qué había ────────────────────────────────────────────────────────────────────────
 *
 * Los permisos YA vivían en la base: `pdt_permisos(rol, modulo, accion)`, y el código ya
 * preguntaba `puede('evidencias','aprobar')` en vez de comparar nombres de rol. Eso no se
 * toca. Lo que faltaba era todo lo demás:
 *
 *   · No había forma de crear un rol sin abrir Supabase con la clave de servicio.
 *   · `pdt_roles` no tenía `activo`: desactivar un rol era borrarlo, y borrarlo arrastraba
 *     sus permisos por CASCADE dejando a sus usuarios sin nada.
 *   · No había herencia: «Gerente de solo lectura» obligaba a recapturar 19 permisos a mano
 *     y a mantenerlos sincronizados para siempre.
 *   · `pdt_usuarios.rol` es UNA columna de texto, así que nadie podía ser Educador y
 *     Revisor a la vez.
 *   · Las capacidades no tenían nombre legible. Una pantalla de permisos que muestre
 *     `evidencias.solicitar_correccion` obliga a adivinar qué concede.
 *
 * ── Lo que NO cambia ─────────────────────────────────────────────────────────────────
 *
 * La clave de una capacidad sigue siendo `modulo.accion`. Renombrarlas a `approve_evidence`
 * habría roto las 64 filas de permisos, el campo `permiso` de cada flujo de revisión y cada
 * llamada del código. El nombre legible se guarda aparte, en `pdt_capacidades`, y es lo que
 * se pinta; la clave es lo que se compara.
 */

-- ---------- catálogo de capacidades ----------

/*
 * Qué se puede conceder, con nombre y descripción.
 *
 * Sin esto, la única forma de saber qué capacidades existen es mirar qué se ha concedido
 * alguna vez —lo que hace imposible ofrecer una que nadie tenga todavía— y la pantalla
 * tendría que mostrar la clave cruda.
 */
create table if not exists pdt_capacidades (
    clave       text primary key,
    modulo      text not null,
    accion      text not null,
    nombre      text not null,
    descripcion text,
    /** Para agrupar la pantalla. Sin grupos, 25 casillas seguidas no se leen. */
    grupo       text not null default 'General',
    orden       int  not null default 0,
    unique (modulo, accion)
);

comment on table pdt_capacidades is
    'Qué permisos existen y cómo se llaman en pantalla. La clave `modulo.accion` es lo que '
    'compara el código; `nombre` es lo que lee una persona.';

alter table pdt_capacidades enable row level security;

-- ---------- roles: desactivar y heredar ----------

alter table pdt_roles add column if not exists activo boolean not null default true;

/*
 * De quién hereda sus capacidades.
 *
 * Un rol tiene las suyas MÁS las de aquel del que hereda, recursivamente. Es lo que permite
 * «Gerente de solo lectura» sin recapturar 19 permisos ni mantenerlos sincronizados a mano.
 *
 * `on delete set null` y no cascade: borrar el padre no debe borrar al hijo. Se queda sin
 * herencia y con lo suyo, que es recuperable; desaparecer no lo es.
 */
alter table pdt_roles add column if not exists hereda_de text
    references pdt_roles(clave) on delete set null;

/*
 * Un rol del sistema no se puede borrar ni desactivar.
 *
 * `administrador` es el único, y el motivo es concreto: es el que concede
 * `administracion.configurar`, que es lo que deja entrar a esta misma pantalla. Sin él, un
 * despiste deja la instalación sin nadie que pueda arreglarla.
 */
alter table pdt_roles add column if not exists sistema boolean not null default false;

alter table pdt_roles drop constraint if exists pdt_roles_no_hereda_de_si_mismo;
alter table pdt_roles add constraint pdt_roles_no_hereda_de_si_mismo
    check (hereda_de is null or hereda_de <> clave);

update pdt_roles set sistema = true where clave = 'administrador';

-- ---------- un usuario, varios roles ----------

/*
 * `pdt_usuarios.rol` se conserva y se sigue respetando: es lo que tienen hoy los usuarios
 * reales, y vaciarlo en la migración los dejaría sin acceso hasta que alguien los recapture.
 * El perfil une las dos fuentes. Cuando la pantalla escriba aquí, aquello quedará de
 * respaldo por sí solo.
 */
create table if not exists pdt_usuario_roles (
    correo    text not null,
    rol       text not null references pdt_roles(clave) on delete cascade,
    creado_en timestamptz not null default now(),
    primary key (correo, rol)
);

create index if not exists pdt_usuario_roles_correo_idx on pdt_usuario_roles (correo);

comment on table pdt_usuario_roles is
    'Roles de cada usuario. Un usuario puede ser Educador y Revisor a la vez; sus capacidades '
    'son la unión de todos sus roles.';

alter table pdt_usuario_roles enable row level security;

-- Los roles que ya existen se copian aquí para que la unión no dependa de la tabla vieja.
insert into pdt_usuario_roles (correo, rol)
select lower(trim(u.correo)), u.rol
from pdt_usuarios u
where u.rol is not null
on conflict do nothing;

-- ---------- resolver herencia ----------

/*
 * Las capacidades de un rol: las suyas más las de toda su cadena de herencia.
 *
 * El `union` (no `union all`) es lo único que impide que un ciclo A→B→A cuelgue la consulta.
 * Es la misma protección que usa `pdt_alcance` con la jerarquía de personas, y por el mismo
 * motivo: nadie va a crear el ciclo a propósito, pero un rol mal enlazado no puede tumbar el
 * arranque de todos.
 */
create or replace function pdt_rol_capacidades(p_rol text)
returns table (clave text)
language sql
stable
security definer
set search_path = public
as $$
    with recursive cadena as (
        select r.clave, r.hereda_de
        from pdt_roles r
        where r.clave = p_rol

        union

        select padre.clave, padre.hereda_de
        from pdt_roles padre
        join cadena c on c.hereda_de = padre.clave
    )
    select distinct p.modulo || '.' || p.accion
    from pdt_permisos p
    join cadena c on c.clave = p.rol
$$;

/* Todas las capacidades de un correo: la unión de las de todos sus roles activos. */
create or replace function pdt_capacidades_de(p_correo text)
returns table (clave text)
language sql
stable
security definer
set search_path = public
as $$
    with yo as (select lower(trim(p_correo)) as correo),
    roles as (
        -- Los roles nuevos
        select ur.rol from pdt_usuario_roles ur, yo where lower(trim(ur.correo)) = yo.correo
        union
        -- El rol heredado de la tabla vieja
        select u.rol from pdt_usuarios u, yo
         where lower(trim(u.correo)) = yo.correo and u.activo and u.rol is not null
        union
        -- Y el de la invitación, para quien todavía no tiene fila de usuario
        select i.rol from pdt_invitaciones i, yo
         where lower(trim(i.correo)) = yo.correo
           and i.estado in ('pendiente', 'aceptada') and i.rol is not null
    )
    select distinct c.clave
    from roles r
    join pdt_roles rr on rr.clave = r.rol and rr.activo
    cross join lateral pdt_rol_capacidades(r.rol) c
$$;

-- ---------- el perfil, ahora con varios roles y herencia ----------

/*
 * Reemplaza a `pdt_perfil`. Conserva EXACTAMENTE las mismas claves que antes —`js/permisos.js`
 * las lee por nombre y romperlas dejaría a todo el mundo fuera— y agrega `roles`.
 *
 * Dos cambios de fondo:
 *
 *   · `permisos` sale ahora de `pdt_capacidades_de`, que une varios roles y sigue la herencia.
 *   · `es_admin` deja de compararse contra el literal 'administrador' y pasa a ser
 *     «tiene la capacidad administracion.configurar». Eso era precisamente un
 *     `if (rol == "administrador")` escondido en SQL: con él, un rol nuevo con todos los
 *     permisos de administración seguía sin ser admin.
 *
 * `pdt_admins` se sigue respetando como respaldo heredado: es la única llave de quien la
 * instalación tenía antes de que existieran los roles.
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
    )
    select jsonb_build_object(
        'correo', yo.correo,
        'nombre', coalesce((select nombre from usuario), (select nombre from invitacion)),
        -- Se conserva por compatibilidad: `Perfil.rol` sigue existiendo y se usa para
        -- etiquetar. Con varios roles es el primero; la verdad está en `roles` y `permisos`.
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
        'alcance', (select lista from alcance)
    )
    from yo
$$;

-- ---------- lectura para la pantalla de administración ----------

/* Los roles con sus capacidades PROPIAS, su herencia y cuánta gente los usa. */
create or replace function pdt_roles_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', r.clave,
        'nombre', r.nombre,
        'descripcion', r.descripcion,
        'orden', r.orden,
        'activo', r.activo,
        'sistema', r.sistema,
        'hereda_de', r.hereda_de,
        -- Las suyas, sin heredar: es lo que la pantalla deja editar.
        'capacidades', coalesce((
            select jsonb_agg(distinct p.modulo || '.' || p.accion)
            from pdt_permisos p where p.rol = r.clave
        ), '[]'::jsonb),
        -- Y las efectivas, para poder mostrar qué concede de verdad.
        'efectivas', coalesce((
            select jsonb_agg(distinct c.clave) from pdt_rol_capacidades(r.clave) c
        ), '[]'::jsonb),
        'usuarios', (
            select count(*) from pdt_usuario_roles ur where ur.rol = r.clave
        ),
        -- Si alguien hereda de él, no se puede borrar sin dejar huérfano a otro.
        'herederos', (
            select count(*) from pdt_roles h where h.hereda_de = r.clave
        )
    ) order by r.orden, r.clave), '[]'::jsonb)
    from pdt_roles r
$$;

/* El catálogo de capacidades, agrupado. */
create or replace function pdt_capacidades_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', c.clave, 'modulo', c.modulo, 'accion', c.accion,
        'nombre', c.nombre, 'descripcion', c.descripcion,
        'grupo', c.grupo, 'orden', c.orden
    ) order by c.orden, c.clave), '[]'::jsonb)
    from pdt_capacidades c
$$;

/* Los usuarios con sus roles y su jerarquía. */
create or replace function pdt_usuarios_admin()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with correos as (
        select lower(trim(correo)) as correo from pdt_usuarios
        union
        select lower(trim(correo)) from pdt_invitaciones
        union
        select lower(trim(correo)) from pdt_usuario_roles
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'correo', c.correo,
        'nombre', (select u.nombre from pdt_usuarios u
                    where lower(trim(u.correo)) = c.correo),
        'activo', coalesce((select u.activo from pdt_usuarios u
                             where lower(trim(u.correo)) = c.correo), true),
        'roles', coalesce((
            select jsonb_agg(distinct ur.rol) from pdt_usuario_roles ur
             where lower(trim(ur.correo)) = c.correo
        ), '[]'::jsonb),
        'invitacion', (select i.estado from pdt_invitaciones i
                        where lower(trim(i.correo)) = c.correo),
        'jefes', coalesce((
            select jsonb_agg(distinct lower(trim(j.jefe))) from pdt_jerarquia j
             where lower(trim(j.subordinado)) = c.correo
        ), '[]'::jsonb),
        'subordinados', coalesce((
            select jsonb_agg(distinct lower(trim(j.subordinado))) from pdt_jerarquia j
             where lower(trim(j.jefe)) = c.correo
        ), '[]'::jsonb)
    ) order by c.correo), '[]'::jsonb)
    from correos c
$$;

-- ---------- el catálogo inicial ----------

/*
 * Las capacidades que ya se conceden hoy, con su nombre legible.
 *
 * Se describe lo que CONCEDE, no lo que significa la palabra. «Aprobar evidencias» no dice
 * nada por sí solo; «dar por buena la evidencia de otro» sí dice a quién afecta.
 */
insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('visitas.crear',      'visitas', 'crear',      'Crear visitas',
     'Agendar visitas propias y capturar lo que ocurre en ellas.', 'Visitas', 10),
    ('visitas.consultar',  'visitas', 'consultar',  'Consultar visitas',
     'Ver las visitas propias y las de quien tenga a cargo. Sin esto no se ve nada.', 'Visitas', 20),
    ('visitas.revisar',    'visitas', 'revisar',    'Revisar visitas',
     'Entrar a la bandeja de revisión de visitas, incluida la de retrasos.', 'Visitas', 30),
    ('visitas.calificar',  'visitas', 'calificar',  'Calificar visitas',
     'Emitir un juicio sobre si la visita fue efectiva.', 'Visitas', 40),
    ('visitas.exportar',   'visitas', 'exportar',   'Exportar visitas',
     'Descargar la información de visitas fuera de la aplicación.', 'Visitas', 50),

    ('actividades.crear',     'actividades', 'crear',     'Registrar actividades',
     'Capturar actividades dentro de un sector de una visita.', 'Actividades', 110),
    ('actividades.consultar', 'actividades', 'consultar', 'Consultar actividades',
     'Ver las actividades registradas.', 'Actividades', 120),
    ('actividades.revisar',   'actividades', 'revisar',   'Revisar actividades',
     'Juzgar si se hizo lo que el sector se había propuesto.', 'Actividades', 130),
    ('actividades.calificar', 'actividades', 'calificar', 'Calificar la documentación',
     'Juzgar si el contacto, el área y los materiales están bien capturados.', 'Actividades', 140),

    ('materiales.crear',     'materiales', 'crear',     'Registrar materiales',
     'Anotar qué material se entregó en una actividad.', 'Materiales', 210),
    ('materiales.consultar', 'materiales', 'consultar', 'Consultar materiales',
     'Ver el material registrado.', 'Materiales', 220),
    ('materiales.revisar',   'materiales', 'revisar',   'Revisar materiales',
     'Verificar lo registrado contra lo entregado.', 'Materiales', 230),

    ('evidencias.subir',                 'evidencias', 'subir',                 'Subir evidencias',
     'Adjuntar la foto o el documento que respalda una actividad.', 'Evidencias', 310),
    ('evidencias.consultar',             'evidencias', 'consultar',             'Ver evidencias',
     'Abrir las evidencias cargadas.', 'Evidencias', 320),
    ('evidencias.aprobar',               'evidencias', 'aprobar',               'Aprobar evidencias',
     'Dar por buena la evidencia de otra persona.', 'Evidencias', 330),
    ('evidencias.rechazar',              'evidencias', 'rechazar',              'Rechazar evidencias',
     'Marcar una evidencia como no válida.', 'Evidencias', 340),
    ('evidencias.solicitar_correccion',  'evidencias', 'solicitar_correccion',  'Pedir corrección',
     'Devolver la evidencia a quien la subió, explicando qué arreglar.', 'Evidencias', 350),

    ('comentarios.crear',     'comentarios', 'crear',     'Comentar',
     'Escribir comentarios sobre una visita, sector, actividad o evidencia.', 'Comentarios', 410),
    ('comentarios.leer',      'comentarios', 'leer',      'Leer comentarios',
     'Ver la conversación. Sin esto los hilos no aparecen.', 'Comentarios', 420),
    ('comentarios.responder', 'comentarios', 'responder', 'Responder comentarios',
     'Contestar en un hilo abierto por otra persona.', 'Comentarios', 430),

    ('dashboards.personal', 'dashboards', 'personal', 'Ver mis indicadores',
     'Abrir el tablero con el desempeño propio.', 'Indicadores', 510),
    ('dashboards.equipo',   'dashboards', 'equipo',   'Ver indicadores del equipo',
     'Ver el desglose por persona de quien se tenga a cargo.', 'Indicadores', 520),
    ('dashboards.general',  'dashboards', 'general',  'Ver indicadores generales',
     'Ver el consolidado de toda la operación.', 'Indicadores', 530),

    ('administracion.configurar', 'administracion', 'configurar', 'Administrar la aplicación',
     'Editar catálogos, roles y usuarios. Concede el acceso a esta misma pantalla.',
     'Administración', 610)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

-- ---------- permisos de ejecución ----------

/*
 * Las tres funciones de lectura administrativa exponen el organigrama y quién puede qué.
 * Solo `service_role`, es decir: solo a través de Apps Script, que ya verifica la identidad
 * contra Google. La PWA lleva la clave anónima —viaja en su propio JavaScript— y con ella
 * cualquiera podría listar la plantilla entera.
 */
revoke execute on function pdt_roles_admin()       from public, anon, authenticated;
revoke execute on function pdt_capacidades_admin() from public, anon, authenticated;
revoke execute on function pdt_usuarios_admin()    from public, anon, authenticated;
revoke execute on function pdt_rol_capacidades(text) from public, anon, authenticated;
revoke execute on function pdt_capacidades_de(text)  from public, anon, authenticated;

grant execute on function pdt_roles_admin()         to service_role;
grant execute on function pdt_capacidades_admin()   to service_role;
grant execute on function pdt_usuarios_admin()      to service_role;
grant execute on function pdt_rol_capacidades(text) to service_role;
grant execute on function pdt_capacidades_de(text)  to service_role;

-- `pdt_perfil` sigue siendo llamable con la clave anónima: es lo que la PWA usa al arrancar.
grant execute on function pdt_perfil(text) to anon, authenticated, service_role;
