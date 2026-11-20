-- Revisiones: criterios marcados, y avisos al educador en TODO veredicto de otra persona.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- 1. `criterios`: qué marcó el revisor punto por punto (Actividad, Evidencia, Puntualidad…).
-- 2. `reabierto`: ya es un valor válido — el CHECK de `resultado` se quitó en
--    `20260719_pdt_resultados_por_flujo.sql`. Reabrir inserta una revisión nueva; nada se borra.
-- 3. Avisos: antes solo avisaban rechazado/corrección. Ahora el educador también se entera de
--    una aprobación, de una reapertura y de cualquier veredicto de otra persona, salvo que el
--    veredicto declare expresamente `avisa_educador: false`.

alter table pdt_revisiones add column if not exists criterios jsonb;

comment on column pdt_revisiones.criterios is
    'Criterios marcados por el revisor: [{clave, etiqueta, ok}]. Sin marcar no se guarda.';

-- ---------- guardar: ahora con criterios ----------

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
        insert into pdt_revisiones (
            id, flujo, ambito, id_ambito, id_visita, educador_correo,
            resultado, observaciones, revisor_correo, revisor, momento, criterios
        )
        select
            r->>'id', r->>'flujo', r->>'ambito', r->>'id_ambito', r->>'id_visita',
            coalesce(v.educador_correo, lower(p_revisor_correo)),
            r->>'resultado', nullif(r->>'observaciones', ''),
            lower(p_revisor_correo), p_revisor,
            coalesce(nullif(r->>'momento', '')::timestamptz, now()),
            case when jsonb_typeof(r->'criterios') = 'array' and jsonb_array_length(r->'criterios') > 0
                 then r->'criterios' end
        from (select 1) x
        left join pdt_visitas v on v.id = r->>'id_visita'
        on conflict (id) do nothing;

        n := n + 1;
    end loop;

    return jsonb_build_object('ok', true, 'revisiones', n);
end;
$$;

-- ---------- leer: ahora con criterios ----------

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
        'criterios', v.criterios,
        'revisor_correo', v.revisor_correo,
        'revisor', v.revisor,
        'momento', v.momento,
        'seq', v.seq
    ) order by v.momento, v.seq), '[]'::jsonb)
    from visibles v
$$;

-- ---------- avisos: todo veredicto de otra persona llega al educador ----------

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

    -- Por defecto SÍ avisa (aprobado y reabierto incluidos). Solo se calla si el veredicto lo
    -- declara expresamente.
    v_avisa := coalesce((v_veredicto->>'avisa_educador')::boolean, true);

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
    v_etiqueta := coalesce(
        nullif(v_veredicto->>'etiqueta', ''),
        case when new.resultado = 'reabierto' then 'Reabierto' end,
        initcap(replace(new.resultado, '_', ' '))
    );

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
