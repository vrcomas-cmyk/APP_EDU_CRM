-- Plan de Trabajo — espejo de lectura e invitaciones.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- ── Por qué las tablas están normalizadas y no son un JSONB por visita ───────────────
--
-- El destino de esto es DuckDB sobre cientos de miles de registros. "¿Cuántas piezas de
-- gasas entregó el equipo norte en julio?" sobre un JSONB obliga a desanidar en cada
-- consulta; sobre estas cuatro tablas es un JOIN con un GROUP BY. La forma del árbol la
-- reconstruye `pdt_visitas_arbol` para el cliente, que sí lo necesita así.
--
-- ── Quién escribe y quién lee ────────────────────────────────────────────────────────
--
-- NADIE con la anon key. Estas tablas tienen RLS activo y CERO políticas, así que para
-- anon no existen. Solo el service_role las toca, y ese vive únicamente en las propiedades
-- del proyecto de Apps Script — que es el que ya verifica el id_token de Google.
--
-- Es a propósito: la anon key viaja en el bundle de la PWA, o sea que es pública. Si la
-- lectura dependiera de ella, cualquiera podría pedir las visitas de cualquier correo.
--
-- Google Sheets sigue siendo la fuente operativa. Esto es un ESPEJO: si se borrara entero,
-- no se pierde un solo dato.

-- ---------- invitaciones ----------

create table if not exists pdt_invitaciones (
    correo       text primary key,
    nombre       text,
    rol          text references pdt_roles(clave),
    invitado_por text,
    estado       text not null default 'pendiente'
                 check (estado in ('pendiente', 'aceptada', 'revocada')),
    creada_en    timestamptz not null default now(),
    aceptada_en  timestamptz,
    demo         boolean not null default false
);

comment on table pdt_invitaciones is
    'Lista blanca de acceso. Sin renglón aceptado o pendiente aquí, la PWA no deja entrar.';

alter table pdt_invitaciones enable row level security;

-- ---------- espejo ----------

create table if not exists pdt_visitas (
    id                text primary key,
    educador_correo   text not null,
    educador          text,
    cliente           text,
    hospital          text,
    dia               date,
    hora_inicio       text,
    hora_fin          text,
    estado            text,
    motivo_cancelacion text,
    reagendas         int  not null default 0,
    check_in_momento  timestamptz,
    check_in_lat      double precision,
    check_in_lng      double precision,
    check_out_momento timestamptz,
    permanencia_min   int,
    actualizado       timestamptz not null default now(),
    demo              boolean not null default false
);

create index if not exists pdt_visitas_educador_idx on pdt_visitas (educador_correo);
create index if not exists pdt_visitas_dia_idx      on pdt_visitas (dia);
-- El par (educador, día) es el filtro real de todo dashboard: "mi equipo, este mes".
create index if not exists pdt_visitas_edu_dia_idx  on pdt_visitas (educador_correo, dia);

create table if not exists pdt_sectores (
    id               text primary key,
    id_visita        text not null references pdt_visitas(id) on delete cascade,
    nombre           text,
    objetivo         text,
    origen           text,
    solicitado_por   text,
    guardado_momento timestamptz,
    guardado_usuario text
);
create index if not exists pdt_sectores_visita_idx on pdt_sectores (id_visita);
create index if not exists pdt_sectores_nombre_idx on pdt_sectores (nombre);

create table if not exists pdt_actividades (
    id                text primary key,
    id_sector         text not null references pdt_sectores(id) on delete cascade,
    id_visita         text not null,
    tipo              text,
    area_visitada     text,
    contacto_nombre   text,
    contacto_cargo    text,
    contacto_servicio text,
    fecha_documento   date,
    evidencia_estado  text,
    evidencia_url     text,
    evidencia_tipo    text,
    guardada_momento  timestamptz,
    guardada_usuario  text
);
create index if not exists pdt_actividades_sector_idx on pdt_actividades (id_sector);
create index if not exists pdt_actividades_visita_idx on pdt_actividades (id_visita);
create index if not exists pdt_actividades_tipo_idx   on pdt_actividades (tipo);

create table if not exists pdt_materiales (
    id           text primary key,
    id_actividad text not null references pdt_actividades(id) on delete cascade,
    id_visita    text not null,
    material     text,
    cantidad     numeric,
    unidad       text,
    origen       text
);
create index if not exists pdt_materiales_actividad_idx on pdt_materiales (id_actividad);
create index if not exists pdt_materiales_visita_idx    on pdt_materiales (id_visita);

-- RLS con cero políticas: para anon estas tablas no existen. Solo service_role entra.
alter table pdt_visitas     enable row level security;
alter table pdt_sectores    enable row level security;
alter table pdt_actividades enable row level security;
alter table pdt_materiales  enable row level security;

-- ---------- escritura del espejo ----------

/*
 * Recibe el árbol tal como lo manda la PWA y lo aplana en las cuatro tablas.
 *
 * Es un UPSERT por id: la misma visita se reenvía cada vez que cambia, igual que hacia
 * Sheets, así que insertar a ciegas duplicaría. Los hijos se BORRAN y se reinsertan —un
 * sector o una actividad pueden desaparecer del árbol, y un upsert sin borrado dejaría
 * huérfanos que seguirían contando en los indicadores.
 *
 * `p_correo` es la identidad YA VERIFICADA por Apps Script. La función no la comprueba
 * porque no puede: solo confía en que quien la llama tiene el service_role.
 */
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
        -- La PWA no manda `permanencia_min`: lo deriva de check_in/check_out al vuelo. Si se
        -- leyera del árbol, la columna quedaría siempre nula y con ella las "horas efectivas"
        -- de cualquier consulta analítica futura.
        t_in  := nullif(v#>>'{check_in,momento}', '')::timestamptz;
        t_out := nullif(v#>>'{check_out,momento}', '')::timestamptz;

        insert into pdt_visitas (
            id, educador_correo, educador, cliente, hospital, dia, hora_inicio, hora_fin,
            estado, motivo_cancelacion, reagendas,
            check_in_momento, check_in_lat, check_in_lng, check_out_momento,
            permanencia_min, actualizado
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
            -- Solo si ambos existen y el orden tiene sentido. Un check-out anterior al
            -- check-in daría una permanencia negativa, que no es un dato: es un error.
            case when t_in is not null and t_out is not null and t_out >= t_in
                 then (extract(epoch from (t_out - t_in)) / 60)::int end,
            now()
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
            actualizado = now();

        -- El borrado en cascada limpia sectores, actividades y materiales de un golpe.
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
                -- Solo lo SELLADO cruza al espejo. Un borrador no es un hecho todavía y
                -- contarlo en un indicador afirmaría trabajo que aún no se termina.
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
                        -- La cantidad llega como texto desde un <input>; lo que no sea
                        -- número se guarda nulo en vez de tumbar el espejo completo.
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

-- ---------- lectura del espejo ----------

/*
 * Las visitas que `p_correo` puede ver, ya reconstruidas como árbol.
 *
 * El recorte por jerarquía ocurre AQUÍ, en el WHERE: si se hiciera en el cliente, los datos
 * de los demás ya habrían viajado por la red y el recorte sería decorativo.
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
    with permitidos as (
        select correo from pdt_alcance(p_correo)
    ),
    visibles as (
        select v.*
        from pdt_visitas v
        join permitidos p on p.correo = v.educador_correo
        where (p_desde is null or v.dia >= p_desde)
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
            'dia', to_char(v.dia, 'YYYY-MM-DD'),
            'hora_inicio', v.hora_inicio,
            'hora_fin', v.hora_fin,
            'estado', v.estado,
            'motivo_cancelacion', v.motivo_cancelacion,
            'sincronizado', true,
            'remota', true,
            'reagendas', (
                -- El cliente solo cuenta cuántas hubo; el detalle vive en Sheets.
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
    from visibles v
$$;

-- ---------- el perfil ahora dice si hay invitación ----------

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
    invitacion as (
        select i.* from pdt_invitaciones i, yo where lower(i.correo) = yo.correo
    ),
    es_admin_legado as (
        select exists (
            select 1 from pdt_admins a, yo where lower(a.correo) = yo.correo
        ) as v
    ),
    rol_efectivo as (
        select coalesce(
            (select rol from usuario),
            (select rol from invitacion),
            case when (select v from es_admin_legado) then 'administrador' else null end
        ) as rol
    )
    select jsonb_build_object(
        'correo',   (select correo from yo),
        'nombre',   coalesce((select nombre from usuario), (select nombre from invitacion)),
        'rol',      (select rol from rol_efectivo),
        'es_admin', coalesce((select v from es_admin_legado), false)
                    or coalesce((select rol from rol_efectivo) = 'administrador', false),
        -- Un admin heredado nunca se queda fuera por no tener invitación: quitarle el acceso
        -- al introducir esta regla sería romper algo que ya funcionaba.
        'invitado', coalesce((select estado from invitacion) in ('pendiente', 'aceptada'), false)
                    or coalesce((select v from es_admin_legado), false),
        'invitacion_estado', coalesce((select estado from invitacion),
                                      case when (select v from es_admin_legado)
                                           then 'aceptada' else 'sin_invitacion' end),
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

/* Marca la invitación como aceptada la primera vez que alguien entra. */
create or replace function pdt_aceptar_invitacion(p_correo text)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
    update pdt_invitaciones
       set estado = 'aceptada', aceptada_en = coalesce(aceptada_en, now())
     where lower(correo) = lower(trim(p_correo))
       and estado = 'pendiente'
    returning true;
$$;

-- El administrador que ya existía queda invitado para no quedarse fuera con la regla nueva.
insert into pdt_invitaciones (correo, nombre, rol, invitado_por, estado, aceptada_en)
select a.correo, a.nombre, 'administrador', 'migración', 'aceptada', now()
from pdt_admins a
on conflict (correo) do nothing;

-- ---------- permisos de ejecución ----------
--
-- `security definer` NO implica acceso restringido: Postgres da EXECUTE a PUBLIC por
-- defecto. Sin este bloque, estas funciones quedan llamables con la clave anónima —que
-- viaja en el bundle de la PWA y por lo tanto es pública— y cualquiera puede leer las
-- visitas de cualquier equipo o escribir visitas falsas pasando el correo que quiera.
-- Enrutar la lectura por Apps Script no sirve de nada mientras esto esté abierto.

revoke execute on function pdt_espejo_guardar(text, jsonb)              from public, anon, authenticated;
revoke execute on function pdt_visitas_en_alcance(text, date, date, int) from public, anon, authenticated;
revoke execute on function pdt_alcance(text)                            from public, anon, authenticated;

grant execute on function pdt_espejo_guardar(text, jsonb)               to service_role;
grant execute on function pdt_visitas_en_alcance(text, date, date, int) to service_role;
grant execute on function pdt_alcance(text)                             to service_role;

-- Estas dos sí las llama la PWA al arrancar, antes de cualquier sincronización, para saber
-- si dejar entrar. Exponen rol y subordinados de un correo —el organigrama—, no visitas.
grant execute on function pdt_perfil(text)             to anon, authenticated;
grant execute on function pdt_aceptar_invitacion(text) to anon, authenticated;
