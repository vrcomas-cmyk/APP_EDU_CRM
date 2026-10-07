-- Avisos al educador: cuando se RECHAZA algo o se PIDE CORRECCIÓN en Revisiones, el educador
-- dueño lo ve dentro de la app (bandeja "Avisos", insignia en el menú y aviso emergente), con la
-- observación del revisor y un acceso directo a la visita.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Antes la observación del revisor se guardaba y viajaba al dispositivo del educador, pero
-- ninguna pantalla suya la mostraba: no se enteraba de que algo se le devolvió.
--
-- ── Cómo se crea el aviso ───────────────────────────────────────────────────────────────
--
-- Con un TRIGGER sobre `pdt_revisiones` (AFTER INSERT), no reescribiendo `pdt_revision_guardar`:
-- así cubre cualquier camino por el que entre una revisión (la PWA directo, la ruta de
-- compatibilidad de Apps Script) y ocurre en la MISMA transacción que la revisión, de modo que
-- no puede quedar una sin la otra. `pdt_revision_guardar` ya hace `on conflict do nothing`: un
-- reenvío del mismo lote no inserta y por tanto no dispara el trigger, así que no duplica.
--
-- ── Qué veredictos avisan ───────────────────────────────────────────────────────────────
--
-- Es un DATO del veredicto (`avisa_educador` dentro de `pdt_flujos_revision.resultados`,
-- configurable en Administración → Flujos). Si el veredicto no lo declara:
--   · si declara `acepta = false`  → avisa (el trabajo no se dio por bueno);
--   · si no declara nada (flujos sin `resultados` propios) → avisan 'rechazado' y 'correccion'.
-- No se avisa a quien se revisa a sí mismo.
--
-- ── Cómo se resuelve ────────────────────────────────────────────────────────────────────
--
-- Una revisión NUEVA del mismo (flujo, elemento) resuelve los avisos abiertos anteriores
-- ('reemplazado' si el nuevo veredicto también avisa, 'nueva_revision' si no). El educador
-- también puede marcarlo resuelto ("Ya lo corregí") — eso NO cierra la revisión: sigue pendiente
-- para el revisor hasta que él vuelva a revisar.

create table if not exists pdt_avisos (
    id                  text primary key,
    tipo                text not null default 'revision',
    destinatario_correo text not null,
    -- Una revisión produce a lo más un aviso: la deduplicación es estructural.
    id_revision         text unique,
    flujo               text,
    ambito              text,
    -- Id del visita/actividad revisada. Sin llave foránea a propósito: `pdt_espejo_guardar` borra y
    -- vuelve a insertar sectores y actividades en cada guardado, y un delete en cascada se llevaría
    -- el aviso con él.
    id_ambito           text,
    id_visita           text,
    resultado           text,
    etiqueta            text,
    titulo              text,
    detalle             text,
    cliente             text,
    hospital            text,
    dia_visita          date,
    revisor             text,
    revisor_correo      text,
    creado_en           timestamptz not null default now(),
    leido_en            timestamptz,
    resuelto_en         timestamptz,
    resuelto_motivo     text
);

create index if not exists pdt_avisos_abiertos_idx
    on pdt_avisos (destinatario_correo, creado_en desc) where resuelto_en is null;
create index if not exists pdt_avisos_elemento_idx
    on pdt_avisos (destinatario_correo, flujo, id_ambito);

-- Sin políticas, como el resto del espejo: el acceso real pasa por las funciones de abajo.
alter table pdt_avisos enable row level security;

-- ---------- trigger: una revisión que devuelve algo crea el aviso ----------

create or replace function pdt_avisos_de_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_veredicto jsonb;
    v_flujo     text;
    v_visita    record;
    v_avisa     boolean;
    v_etiqueta  text;
    v_dueno     text := lower(new.educador_correo);
begin
    select r, f.nombre into v_veredicto, v_flujo
      from pdt_flujos_revision f
      left join lateral (
          select x from jsonb_array_elements(
              case when jsonb_typeof(f.resultados) = 'array' then f.resultados else '[]'::jsonb end
          ) x where x->>'valor' = new.resultado limit 1
      ) lat(r) on true
     where f.clave = new.flujo;

    v_avisa := coalesce(
        (v_veredicto->>'avisa_educador')::boolean,
        case when (v_veredicto->>'acepta') is not null
             then not (v_veredicto->>'acepta')::boolean end,
        new.resultado in ('rechazado', 'correccion')
    );

    -- Esta revisión reemplaza lo que se había avisado de este mismo elemento.
    update pdt_avisos
       set resuelto_en = now(),
           resuelto_motivo = case when v_avisa then 'reemplazado' else 'nueva_revision' end
     where destinatario_correo = v_dueno
       and flujo = new.flujo and id_ambito = new.id_ambito
       and resuelto_en is null;

    -- Nadie necesita un aviso de lo que se revisó a sí mismo.
    if not v_avisa or v_dueno = lower(new.revisor_correo) then
        return new;
    end if;

    select v.cliente, v.hospital, v.dia into v_visita from pdt_visitas v where v.id = new.id_visita;
    v_etiqueta := coalesce(nullif(v_veredicto->>'etiqueta', ''), initcap(replace(new.resultado, '_', ' ')));

    insert into pdt_avisos (
        id, destinatario_correo, id_revision, flujo, ambito, id_ambito, id_visita, resultado,
        etiqueta, titulo, detalle, cliente, hospital, dia_visita, revisor, revisor_correo
    ) values (
        'av-' || new.id, v_dueno, new.id, new.flujo, new.ambito, new.id_ambito, new.id_visita, new.resultado,
        v_etiqueta,
        v_etiqueta || coalesce(' · ' || v_flujo, ''),
        new.observaciones,
        v_visita.cliente, v_visita.hospital, v_visita.dia,
        new.revisor, lower(new.revisor_correo)
    )
    on conflict (id_revision) do nothing;

    return new;
end;
$$;

revoke execute on function pdt_avisos_de_revision() from public, anon, authenticated;

drop trigger if exists trg_pdt_avisos_de_revision on pdt_revisiones;
create trigger trg_pdt_avisos_de_revision
    after insert on pdt_revisiones
    for each row execute function pdt_avisos_de_revision();

-- ---------- lectura y marca, SIEMPRE con la sesión (nunca con un correo libre) ----------
--
-- Mismo patrón que `pdt_calendar_compromisos_equipo_sesion`: el correo sale del token de sesión,
-- no del cliente, así que nadie puede leer ni marcar los avisos de otra persona — es justo el
-- hueco que se cerró en `20260904_pdt_cerrar_rpc_expuestas.sql` para `pdt_perfil`.
-- VOLATILE a propósito: `pdt_correo_de_sesion()` hace UPDATE de `ultimo_uso`.

create or replace function pdt_avisos_mios_sesion(
    p_sesion_token text, p_solo_abiertos boolean default true, p_limite int default 100
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
begin
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', a.id, 'tipo', a.tipo, 'flujo', a.flujo, 'ambito', a.ambito,
            'id_ambito', a.id_ambito, 'id_visita', a.id_visita,
            'resultado', a.resultado, 'etiqueta', a.etiqueta, 'titulo', a.titulo,
            'detalle', a.detalle, 'cliente', a.cliente, 'hospital', a.hospital,
            'dia_visita', to_char(a.dia_visita, 'YYYY-MM-DD'),
            'revisor', a.revisor, 'creado_en', a.creado_en,
            'leido_en', a.leido_en, 'resuelto_en', a.resuelto_en,
            'resuelto_motivo', a.resuelto_motivo
        ) order by a.creado_en desc)
        from (
            select * from pdt_avisos
             where destinatario_correo = lower(v_correo)
               and (not coalesce(p_solo_abiertos, true) or resuelto_en is null)
             order by creado_en desc
             limit greatest(1, least(coalesce(p_limite, 100), 500))
        ) a
    ), '[]'::jsonb);
end;
$$;

create or replace function pdt_avisos_marcar_sesion(
    p_sesion_token text, p_ids jsonb, p_accion text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := pdt_correo_de_sesion(p_sesion_token);
    v_ids    text[];
    n        int := 0;
begin
    if p_accion not in ('leido', 'resuelto') then
        raise exception 'Acción no válida' using errcode = '22023';
    end if;

    select coalesce(array_agg(x), '{}') into v_ids
      from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) x;

    -- Solo los del dueño de la sesión: un id ajeno simplemente no coincide.
    if p_accion = 'leido' then
        update pdt_avisos set leido_en = coalesce(leido_en, now())
         where id = any(v_ids) and destinatario_correo = lower(v_correo) and leido_en is null;
    else
        update pdt_avisos
           set resuelto_en = now(), resuelto_motivo = 'educador', leido_en = coalesce(leido_en, now())
         where id = any(v_ids) and destinatario_correo = lower(v_correo) and resuelto_en is null;
    end if;
    get diagnostics n = row_count;

    return jsonb_build_object('ok', true, 'marcados', n);
end;
$$;

revoke execute on function pdt_avisos_mios_sesion(text, boolean, int) from public;
revoke execute on function pdt_avisos_marcar_sesion(text, jsonb, text) from public;
grant execute on function pdt_avisos_mios_sesion(text, boolean, int) to anon, authenticated, service_role;
grant execute on function pdt_avisos_marcar_sesion(text, jsonb, text) to anon, authenticated, service_role;
