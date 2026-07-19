/*
 * Completa el espejo: eventos, comentarios y catálogos.
 *
 * ── Qué faltaba ──────────────────────────────────────────────────────────────────────
 *
 * Apps Script ya escribía en Sheets Y en Supabase las visitas —con sus sectores, actividades
 * y materiales— y las revisiones. Tres cosas se quedaban solo en la hoja:
 *
 *   EVENTOS      La bitácora de negocio: check-in, check-out, reagendar, cancelar. Es lo que
 *                permite reconstruir qué pasó y cuándo, y sin ella el espejo cuenta el estado
 *                final pero no la historia que llevó a él.
 *   COMENTARIOS  La conversación sobre una visita, sector, actividad o evidencia. Es la mitad
 *                que explica POR QUÉ algo se rechazó; sin ella `pdt_revisiones` guarda el
 *                veredicto y pierde el diálogo.
 *   CATÁLOGOS    Lo que Administración publica: tipos de actividad y su matriz de campos,
 *                listas, sectores ofrecidos, equipo. Es la configuración que decide qué se
 *                puede capturar, así que sin ella un análisis no puede saber si un campo
 *                faltaba porque nadie lo llenó o porque nadie lo pedía.
 *
 * ── El mismo trato que el resto del espejo ───────────────────────────────────────────
 *
 * Sheets sigue siendo la fuente operativa. Estas tablas se escriben DESPUÉS y su fallo no
 * puede tumbar una captura: `supabaseRPC` devuelve null y la PWA reintenta en el siguiente
 * envío. Todo es idempotente por id, porque el reintento manda el lote entero otra vez.
 */

-- ---------- bitácora ----------

create table if not exists pdt_eventos (
    id              text primary key,
    tipo            text not null,
    momento         timestamptz,
    id_visita       text,
    cliente         text,
    hospital        text,
    educador        text,
    -- De quién es. Se guarda aquí y no se deduce por JOIN contra pdt_visitas para que el
    -- recorte por jerarquía sea un WHERE directo, igual que en pdt_revisiones: a cientos de
    -- miles de filas, filtrar por columna o tras un JOIN es la diferencia entre usable y no.
    educador_correo text not null,
    dispositivo     text,
    -- Carga variable según el tipo de evento. Es un log: forzar columnas obligaría a migrar
    -- el esquema cada vez que un evento nuevo quiera contar algo más.
    datos           jsonb,
    actualizado     timestamptz not null default now()
);

create index if not exists pdt_eventos_visita_idx on pdt_eventos (id_visita);
create index if not exists pdt_eventos_educador_idx on pdt_eventos (educador_correo, momento desc);

comment on table pdt_eventos is
    'Bitácora de negocio. Espejo de la hoja Eventos; append-only, nunca se actualiza.';

alter table pdt_eventos enable row level security;

-- ---------- comentarios ----------

create table if not exists pdt_comentarios (
    id             text primary key,
    ambito         text not null,
    id_ambito      text not null,
    id_visita      text,
    cliente        text,
    hospital       text,
    texto          text not null,
    usuario        text,
    usuario_correo text not null,
    momento        timestamptz,
    actualizado    timestamptz not null default now()
);

create index if not exists pdt_comentarios_ambito_idx on pdt_comentarios (ambito, id_ambito);
create index if not exists pdt_comentarios_visita_idx on pdt_comentarios (id_visita);

comment on table pdt_comentarios is
    'Conversación sobre visita/sector/actividad/evidencia. Inmutable: corregir es comentar de '
    'nuevo, igual que en la app.';

alter table pdt_comentarios enable row level security;

-- ---------- catálogos ----------

/*
 * Una fila por sección, con su contenido en jsonb.
 *
 * No se desglosa en tablas por tipo porque Administración publica el catálogo ENTERO de una
 * vez: guardar una sección es reemplazarla, y con tablas granulares habría que decidir qué
 * pasa con lo que desapareció del envío. Aquí ese problema no existe —la fila se pisa— y el
 * jsonb sigue siendo consultable con los operadores de Postgres.
 */
create table if not exists pdt_catalogos (
    clave           text primary key,
    valor           jsonb not null,
    -- Quién publicó y cuándo. Un catálogo malo se reparte a todos los educadores en el
    -- siguiente sync, así que saber a quién preguntar importa más que en cualquier otra tabla.
    publicado_por   text,
    actualizado     timestamptz not null default now()
);

comment on table pdt_catalogos is
    'Lo que publica Administración: tipos de actividad y su matriz de campos, listas, '
    'sectores ofrecidos y equipo. Una fila por sección; guardar reemplaza.';

alter table pdt_catalogos enable row level security;

-- ---------- escritura ----------

/*
 * Guarda un lote de eventos.
 *
 * `p_educador_correo` es la identidad YA VERIFICADA por Apps Script; lo que venga en el
 * cuerpo se ignora. Si se confiara en el cliente, cualquiera podría escribir bitácora a
 * nombre de otro, que es justo lo que una bitácora no puede permitir.
 *
 * `on conflict do nothing` cubre el reenvío tras falla de red: el mismo lote llega dos veces
 * y no debe duplicar.
 */
create or replace function pdt_eventos_guardar(
    p_educador_correo text,
    p_educador        text,
    p_eventos         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    e jsonb;
    n int := 0;
begin
    for e in select * from jsonb_array_elements(coalesce(p_eventos, '[]'::jsonb))
    loop
        if coalesce(e->>'id', '') = '' then continue; end if;

        insert into pdt_eventos (
            id, tipo, momento, id_visita, cliente, hospital,
            educador, educador_correo, dispositivo, datos
        ) values (
            e->>'id',
            coalesce(e->>'tipo', ''),
            nullif(e->>'momento', '')::timestamptz,
            nullif(e->>'id_visita', ''),
            nullif(e->>'cliente', ''),
            nullif(e->>'hospital', ''),
            coalesce(nullif(p_educador, ''), e->>'educador'),
            p_educador_correo,
            nullif(e->>'dispositivo', ''),
            coalesce(e->'datos', '{}'::jsonb)
        )
        on conflict (id) do nothing;

        n := n + case when found then 1 else 0 end;
    end loop;

    return jsonb_build_object('insertados', n);
end $$;

/*
 * Guarda un lote de comentarios. Mismo trato que los eventos: identidad verificada desde
 * fuera, e idempotente por id.
 */
create or replace function pdt_comentarios_guardar(
    p_usuario_correo text,
    p_usuario        text,
    p_comentarios    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    c jsonb;
    n int := 0;
begin
    for c in select * from jsonb_array_elements(coalesce(p_comentarios, '[]'::jsonb))
    loop
        -- Un comentario sin texto no dice nada y ensuciaría el hilo.
        if coalesce(c->>'id', '') = '' or coalesce(trim(c->>'texto'), '') = '' then
            continue;
        end if;

        insert into pdt_comentarios (
            id, ambito, id_ambito, id_visita, cliente, hospital,
            texto, usuario, usuario_correo, momento
        ) values (
            c->>'id',
            coalesce(c->>'ambito', ''),
            coalesce(c->>'id_ambito', ''),
            nullif(c->>'id_visita', ''),
            nullif(c->>'cliente', ''),
            nullif(c->>'hospital', ''),
            c->>'texto',
            coalesce(nullif(p_usuario, ''), c->>'usuario'),
            p_usuario_correo,
            nullif(c->>'momento', '')::timestamptz
        )
        on conflict (id) do nothing;

        n := n + case when found then 1 else 0 end;
    end loop;

    return jsonb_build_object('insertados', n);
end $$;

/*
 * Guarda el catálogo publicado. A diferencia de los otros dos, aquí sí se REEMPLAZA: es una
 * configuración, no un histórico, y Administración manda siempre el documento entero.
 *
 * Solo se tocan las secciones presentes en el envío. Borrar las ausentes convertiría un
 * despliegue parcial —o un campo que la app todavía no manda— en una pérdida silenciosa de
 * configuración.
 */
create or replace function pdt_catalogos_guardar(
    p_publicado_por text,
    p_catalogos     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Prefijo deliberado: una variable llamada `clave` choca con la columna `clave` y
    -- Postgres rechaza el INSERT por ambigüedad. La migración se aplica sin quejarse y la
    -- función revienta en la primera llamada.
    v_clave text;
    n int := 0;
begin
    for v_clave in select jsonb_object_keys(coalesce(p_catalogos, '{}'::jsonb))
    loop
        insert into pdt_catalogos (clave, valor, publicado_por, actualizado)
        values (v_clave, p_catalogos->v_clave, p_publicado_por, now())
        on conflict (clave) do update
            set valor = excluded.valor,
                publicado_por = excluded.publicado_por,
                actualizado = excluded.actualizado;

        n := n + 1;
    end loop;

    return jsonb_build_object('secciones', n);
end $$;
