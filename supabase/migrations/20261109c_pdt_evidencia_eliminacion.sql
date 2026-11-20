-- Eliminar una evidencia ya subida: la pide el educador y la autoriza su jefe a cargo.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Una evidencia subida es un registro que otras personas ya pudieron ver y revisar; quitarla en
-- silencio borraría justo lo que se audita. Por eso:
--   · el educador SOLICITA la eliminación, con un motivo;
--   · la autoriza alguien a cuyo cargo está —o un administrador—, y NUNCA la misma persona;
--   · al aprobarse, el archivo NO se borra: queda marcado como eliminado (auditoría) y deja de
--     poder verse; la actividad vuelve a "pendiente" para subir la correcta;
--   · rechazar deja la evidencia como estaba. Todo queda en `pdt_evidencia_solicitudes`.

alter table pdt_evidencias add column if not exists eliminada_en  timestamptz;
alter table pdt_evidencias add column if not exists eliminada_por text;

create table if not exists pdt_evidencia_solicitudes (
    id                  text primary key,
    id_actividad        text not null,
    id_visita           text,
    nombre_archivo      text,
    cliente             text,
    solicitante_correo  text not null,
    solicitante         text,
    motivo              text not null,
    estado              text not null default 'pendiente'
                        check (estado in ('pendiente', 'aprobada', 'rechazada')),
    resuelto_por_correo text,
    resuelto_por        text,
    nota                text,
    creado_en           timestamptz not null default now(),
    resuelto_en         timestamptz
);

-- Una sola solicitud abierta por evidencia: pedirla dos veces no debe duplicar la tarea del jefe.
create unique index if not exists pdt_evidencia_solicitudes_abierta_uq
    on pdt_evidencia_solicitudes (id_actividad) where estado = 'pendiente';
create index if not exists pdt_evidencia_solicitudes_solicitante_idx
    on pdt_evidencia_solicitudes (solicitante_correo, creado_en desc);

alter table pdt_evidencia_solicitudes enable row level security;

-- ---------- ver: una evidencia eliminada ya no se puede abrir ----------

create or replace function pdt_evidencia_puede_ver_sesion(p_sesion_token text, p_id_actividad text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_dueno  text;
    v_ruta   text;
begin
    select e.ruta into v_ruta from pdt_evidencias e
     where e.id = p_id_actividad and e.eliminada_en is null;
    if v_ruta is null then return null; end if;

    select lower(trim(v.educador_correo)) into v_dueno
      from pdt_actividades a join pdt_visitas v on v.id = a.id_visita
     where a.id = p_id_actividad;

    if v_dueno is null then
        if exists (select 1 from pdt_evidencias e where e.id = p_id_actividad and lower(e.subido_por) = lower(v_correo))
           or pdt_es_admin(v_correo) then
            return v_ruta;
        end if;
        return null;
    end if;

    if v_dueno = lower(v_correo)
       or pdt_es_admin(v_correo)
       or exists (select 1 from pdt_alcance(v_correo) al where lower(al.correo) = v_dueno) then
        return v_ruta;
    end if;
    return null;
end;
$$;

-- ---------- solicitar (el dueño de la visita) ----------

create or replace function pdt_evidencia_solicitar_eliminacion_sesion(
    p_sesion_token text, p_id_actividad text, p_motivo text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := lower(coalesce(pdt_correo_de_sesion(p_sesion_token), ''));
    v_nombre text;
    v_dueno  text;
    v_visita text;
    v_cliente text;
    v_archivo text;
begin
    if v_correo = '' then raise exception 'Sesión no válida' using errcode = '28000'; end if;
    if length(trim(coalesce(p_motivo, ''))) < 5 then
        raise exception 'Explica por qué se elimina la evidencia' using errcode = '22023';
    end if;

    select lower(trim(v.educador_correo)), v.id, v.cliente
      into v_dueno, v_visita, v_cliente
      from pdt_actividades a join pdt_visitas v on v.id = a.id_visita
     where a.id = p_id_actividad;

    -- Solo quien hizo la visita pide quitar su evidencia.
    if v_dueno is distinct from v_correo then
        raise exception 'Solo quien registró la visita puede pedir eliminar su evidencia' using errcode = '42501';
    end if;

    select e.nombre into v_archivo from pdt_evidencias e
     where e.id = p_id_actividad and e.eliminada_en is null;
    if not found then
        raise exception 'Esa evidencia no existe o ya se eliminó' using errcode = '22023';
    end if;

    select u.nombre into v_nombre from pdt_usuarios u where lower(u.correo) = v_correo limit 1;

    insert into pdt_evidencia_solicitudes (
        id, id_actividad, id_visita, nombre_archivo, cliente,
        solicitante_correo, solicitante, motivo
    ) values (
        'el-' || replace(gen_random_uuid()::text, '-', ''), p_id_actividad, v_visita, v_archivo, v_cliente,
        v_correo, v_nombre, trim(p_motivo)
    )
    on conflict do nothing;   -- ya hay una abierta para esta evidencia

    return jsonb_build_object('ok', true);
end;
$$;

-- ---------- listar: las mías y las que me toca autorizar ----------

create or replace function pdt_evidencia_solicitudes_sesion(p_sesion_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := lower(coalesce(pdt_correo_de_sesion(p_sesion_token), ''));
    v_admin  boolean;
begin
    if v_correo = '' then return '[]'::jsonb; end if;
    v_admin := pdt_es_admin(v_correo);

    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', s.id, 'id_actividad', s.id_actividad, 'id_visita', s.id_visita,
                   'nombre_archivo', s.nombre_archivo, 'cliente', s.cliente,
                   'solicitante_correo', s.solicitante_correo, 'solicitante', s.solicitante,
                   'motivo', s.motivo, 'estado', s.estado,
                   'resuelto_por', s.resuelto_por, 'nota', s.nota,
                   'creado_en', s.creado_en, 'resuelto_en', s.resuelto_en,
                   -- Si me toca a mí decidir (no la mía, y a mi cargo o soy admin).
                   'puedo_resolver', (
                       s.estado = 'pendiente' and s.solicitante_correo <> v_correo
                       and (v_admin or exists (
                            select 1 from pdt_alcance(v_correo) al
                             where lower(al.correo) = s.solicitante_correo))
                   )
               ) order by s.creado_en desc)
          from (
              select * from pdt_evidencia_solicitudes q
               where q.solicitante_correo = v_correo
                  or v_admin
                  or exists (select 1 from pdt_alcance(v_correo) al
                              where lower(al.correo) = q.solicitante_correo)
               order by q.creado_en desc
               limit 300
          ) s
    ), '[]'::jsonb);
end;
$$;

-- ---------- resolver (el jefe, nunca el mismo solicitante) ----------

create or replace function pdt_evidencia_resolver_eliminacion_sesion(
    p_sesion_token text, p_id text, p_aprobar boolean, p_nota text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := lower(coalesce(pdt_correo_de_sesion(p_sesion_token), ''));
    v_nombre text;
    s        pdt_evidencia_solicitudes;
begin
    if v_correo = '' then raise exception 'Sesión no válida' using errcode = '28000'; end if;

    select * into s from pdt_evidencia_solicitudes where id = p_id and estado = 'pendiente' for update;
    if not found then raise exception 'La solicitud ya no está pendiente' using errcode = '22023'; end if;

    if s.solicitante_correo = v_correo then
        raise exception 'No puedes autorizar tu propia solicitud' using errcode = '42501';
    end if;
    if not (pdt_es_admin(v_correo) or exists (
                select 1 from pdt_alcance(v_correo) al where lower(al.correo) = s.solicitante_correo)) then
        raise exception 'No tienes a cargo a quien la pidió' using errcode = '42501';
    end if;
    if not p_aprobar and length(trim(coalesce(p_nota, ''))) < 3 then
        raise exception 'Explica por qué se rechaza' using errcode = '22023';
    end if;

    select u.nombre into v_nombre from pdt_usuarios u where lower(u.correo) = v_correo limit 1;

    update pdt_evidencia_solicitudes
       set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
           resuelto_por_correo = v_correo, resuelto_por = v_nombre,
           nota = nullif(trim(coalesce(p_nota, '')), ''), resuelto_en = now()
     where id = s.id;

    if p_aprobar then
        -- Se conserva el archivo y su ruta (auditoría); solo deja de verse y de contar.
        update pdt_evidencias set eliminada_en = now(), eliminada_por = v_correo
         where id = s.id_actividad;
        -- La actividad vuelve a deber su evidencia.
        update pdt_actividades set evidencia_estado = 'pendiente', evidencia_url = null
         where id = s.id_actividad;
    end if;

    -- Respuesta al educador, en su bandeja de Avisos.
    insert into pdt_avisos (
        id, tipo, destinatario_correo, id_ambito, id_visita, resultado,
        etiqueta, titulo, detalle, cliente, revisor, revisor_correo
    ) values (
        'av-' || s.id, 'eliminacion', s.solicitante_correo, s.id_actividad, s.id_visita,
        case when p_aprobar then 'aprobada' else 'rechazada' end,
        case when p_aprobar then 'Eliminación aprobada' else 'Eliminación rechazada' end,
        case when p_aprobar then 'Eliminación aprobada · evidencia' else 'Eliminación rechazada · evidencia' end,
        coalesce(nullif(trim(coalesce(p_nota, '')), ''),
                 case when p_aprobar then 'Ya puedes subir la evidencia correcta.' end),
        s.cliente, v_nombre, v_correo
    )
    on conflict (id) do nothing;

    return jsonb_build_object('ok', true, 'estado', case when p_aprobar then 'aprobada' else 'rechazada' end);
end;
$$;

revoke execute on function pdt_evidencia_solicitar_eliminacion_sesion(text, text, text) from public;
revoke execute on function pdt_evidencia_solicitudes_sesion(text)                       from public;
revoke execute on function pdt_evidencia_resolver_eliminacion_sesion(text, text, boolean, text) from public;
grant  execute on function pdt_evidencia_solicitar_eliminacion_sesion(text, text, text) to anon, authenticated, service_role;
grant  execute on function pdt_evidencia_solicitudes_sesion(text)                       to anon, authenticated, service_role;
grant  execute on function pdt_evidencia_resolver_eliminacion_sesion(text, text, boolean, text) to anon, authenticated, service_role;
