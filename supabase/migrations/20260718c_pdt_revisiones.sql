-- Plan de Trabajo — flujos de revisión.
--
-- ⚠ Proyecto COMPARTIDO. Prefijo `pdt_`, migración ADITIVA.
--
-- ── Por qué varios flujos y no una aprobación ────────────────────────────────────────
--
-- Quien revisa que la foto se vea bien no es quien juzga si la visita valió la pena, ni
-- quien evalúa si el retraso estuvo justificado. Con una sola aprobación global, esas tres
-- personas se pisan: la primera en llegar cierra el registro y las otras dos ya no pueden
-- opinar, o peor, una "rechaza" y borra el visto bueno de otra sobre algo distinto.
--
-- Por eso el estado de revisión NO vive en la visita: vive en la pareja (flujo, elemento).
-- Una evidencia puede estar aprobada en el flujo de evidencias y su visita seguir pendiente
-- en el de calidad, sin que ninguno sepa del otro.
--
-- ── Append-only ──────────────────────────────────────────────────────────────────────
--
-- Una revisión no se edita ni se borra, igual que todo lo demás en esta plataforma. El
-- estado actual de un elemento en un flujo es su revisión MÁS RECIENTE; las anteriores
-- quedan, y son justo lo que cuenta la historia: rechazado → corregido → aprobado.

-- ---------- flujos ----------

create table if not exists pdt_flujos_revision (
    clave       text primary key,
    nombre      text not null,
    descripcion text,
    -- Qué se revisa: 'visita', 'actividad' o 'evidencia'.
    ambito      text not null check (ambito in ('visita', 'actividad', 'evidencia')),
    -- Permiso que hay que tener para actuar en este flujo, en formato modulo.accion.
    permiso     text not null,
    activo      boolean not null default true,
    orden       int not null default 0
);

comment on table pdt_flujos_revision is
    'Los flujos de revisión son datos: agregar uno no requiere tocar la aplicación.';

alter table pdt_flujos_revision enable row level security;

-- ---------- revisiones ----------

create table if not exists pdt_revisiones (
    id              text primary key,
    flujo           text not null references pdt_flujos_revision(clave),
    ambito          text not null,
    id_ambito       text not null,
    id_visita       text not null,
    -- De quién es lo revisado. Se guarda aquí y no se deduce por JOIN para que el recorte
    -- por jerarquía sea un WHERE directo: a cientos de miles de filas, la diferencia
    -- entre filtrar por columna y filtrar tras un JOIN es la diferencia entre usable y no.
    educador_correo text not null,
    resultado       text not null
                    check (resultado in ('aprobado', 'rechazado', 'correccion')),
    observaciones   text,
    revisor_correo  text not null,
    revisor         text,
    momento         timestamptz not null default now(),
    -- Desempate determinista. Dentro de una transacción `now()` es constante, así que un
    -- lote de varias revisiones comparte `momento` y "la más reciente" quedaría al azar.
    -- Con una cola offline que sube varias juntas, eso es el estado vigente equivocado.
    seq             bigserial,
    demo            boolean not null default false
);

create index if not exists pdt_revisiones_elemento_idx
    on pdt_revisiones (flujo, ambito, id_ambito, momento desc, seq desc);
create index if not exists pdt_revisiones_educador_idx on pdt_revisiones (educador_correo);
create index if not exists pdt_revisiones_visita_idx   on pdt_revisiones (id_visita);

alter table pdt_revisiones enable row level security;

-- ---------- estado vigente ----------

/*
 * La última revisión de cada (flujo, elemento). Es una vista y no una columna en las tablas
 * del espejo a propósito: derivarla del histórico garantiza que no puedan contradecirse.
 */
create or replace view pdt_revision_vigente as
select distinct on (flujo, ambito, id_ambito)
       flujo, ambito, id_ambito, id_visita, educador_correo,
       resultado, observaciones, revisor_correo, revisor, momento, seq
from pdt_revisiones
order by flujo, ambito, id_ambito, momento desc, seq desc;

-- ---------- lectura ----------

/*
 * Las revisiones de lo que `p_correo` puede ver. Devuelve el HISTÓRICO completo: el cliente
 * calcula el estado vigente y también dibuja la conversación, que es lo que explica por qué
 * algo se rechazó y qué se hizo al respecto.
 */
create or replace function pdt_revisiones_en_alcance(
    p_correo text,
    p_limite int default 5000
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
        select r.*
        from pdt_revisiones r
        join permitidos p on p.correo = r.educador_correo
        order by r.momento desc, r.seq desc
        limit greatest(1, least(coalesce(p_limite, 5000), 20000))
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id,
        'flujo', v.flujo,
        'ambito', v.ambito,
        'id_ambito', v.id_ambito,
        'id_visita', v.id_visita,
        'educador_correo', v.educador_correo,
        'resultado', v.resultado,
        'observaciones', v.observaciones,
        'revisor_correo', v.revisor_correo,
        'revisor', v.revisor,
        'momento', v.momento,
        'seq', v.seq
    ) order by v.momento, v.seq), '[]'::jsonb)
    from visibles v
$$;

/* Los flujos activos, para que el cliente arme el módulo sin conocerlos de antemano. */
create or replace function pdt_flujos_activos()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', clave, 'nombre', nombre, 'descripcion', descripcion,
        'ambito', ambito, 'permiso', permiso, 'orden', orden
    ) order by orden, clave), '[]'::jsonb)
    from pdt_flujos_revision where activo
$$;

-- ---------- escritura ----------

/*
 * Guarda un lote de revisiones. Inserta, nunca actualiza: una revisión que se puede
 * reescribir no sirve para auditar nada.
 *
 * `p_revisor_correo` es la identidad YA VERIFICADA por Apps Script; lo que el cliente haya
 * puesto en el campo `revisor_correo` se ignora. Si se confiara en él, cualquiera podría
 * firmar una aprobación con el nombre de su jefe.
 *
 * El `on conflict do nothing` cubre el reenvío tras una falla de red: el mismo lote puede
 * llegar dos veces y no debe duplicar.
 */
create or replace function pdt_revision_guardar(
    p_revisor_correo text,
    p_revisor        text,
    p_revisiones     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
    n int := 0;
begin
    for r in select * from jsonb_array_elements(coalesce(p_revisiones, '[]'::jsonb))
    loop
        -- El educador dueño de lo revisado se toma del espejo, no de lo que mande el
        -- cliente: es lo que decide después quién puede VER esta revisión.
        insert into pdt_revisiones (
            id, flujo, ambito, id_ambito, id_visita, educador_correo,
            resultado, observaciones, revisor_correo, revisor, momento
        )
        select
            r->>'id', r->>'flujo', r->>'ambito', r->>'id_ambito', r->>'id_visita',
            coalesce(v.educador_correo, lower(p_revisor_correo)),
            r->>'resultado', nullif(r->>'observaciones', ''),
            lower(p_revisor_correo), p_revisor,
            coalesce(nullif(r->>'momento', '')::timestamptz, now())
        from (select 1) x
        left join pdt_visitas v on v.id = r->>'id_visita'
        on conflict (id) do nothing;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'revisiones', n);
end;
$$;

-- ---------- permisos de ejecución ----------
--
-- `security definer` NO restringe por sí solo: Postgres da EXECUTE a PUBLIC por defecto, y
-- la clave anónima de la PWA es pública. Sin esto, cualquiera podría leer las revisiones de
-- cualquier equipo o firmar aprobaciones a nombre de otro.

revoke execute on function pdt_revisiones_en_alcance(text, int)     from public, anon, authenticated;
revoke execute on function pdt_revision_guardar(text, text, jsonb)  from public, anon, authenticated;
revoke execute on function pdt_flujos_activos()                     from public, anon, authenticated;

grant execute on function pdt_revisiones_en_alcance(text, int)      to service_role;
grant execute on function pdt_revision_guardar(text, text, jsonb)   to service_role;
grant execute on function pdt_flujos_activos()                      to service_role;

-- ---------- los cinco flujos del spec ----------

insert into pdt_flujos_revision (clave, nombre, descripcion, ambito, permiso, orden) values
    ('evidencia', 'Evidencias',
     'Que el archivo corresponda a la actividad y se vea legible.',
     'actividad', 'evidencias.aprobar', 1),
    ('calidad_visita', 'Calidad de la visita',
     'Si lo registrado justifica el tiempo invertido en el cliente.',
     'visita', 'visitas.calificar', 2),
    ('retrasos', 'Justificación de retrasos',
     'Solo aparece cuando la llegada fue más de 15 minutos tarde.',
     'visita', 'visitas.revisar', 3),
    ('cumplimiento', 'Cumplimiento de actividades',
     'Si se hizo lo que el sector se había propuesto como objetivo.',
     'visita', 'actividades.revisar', 4),
    ('documentacion', 'Calidad de la documentación',
     'Si el contacto, el área y los materiales están bien capturados.',
     'actividad', 'actividades.calificar', 5)
on conflict (clave) do nothing;
