-- Una visita puede avanzar VARIAS estrategias (antes solo una: `id_estrategia`).
--
-- Se AGREGA `ids_estrategias` y `id_estrategia` se conserva con la primera: Sheets, los
-- indicadores y las visitas ya guardadas lo siguen leyendo igual. Al leer, una visita vieja sin
-- `ids_estrategias` devuelve `[id_estrategia]`, así que no hay que migrar datos.
--
-- Las funciones NO se reescriben a mano: se parchan sobre su definición VIVA
-- (`pg_get_functiondef`) con reemplazos de texto exactos. Así cualquier cambio posterior a la
-- última migración que las tocó se conserva, en vez de pisarse con una copia vieja.

alter table pdt_visitas add column if not exists ids_estrategias text[];

do $$
declare
    f record;
    d text;
begin
    -- ---------- guardar (espejo) ----------
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'pdt_espejo_guardar';

    if d not like '%ids_estrategias%' then
        d := replace(d, 'notas, id_estrategia,', 'notas, id_estrategia, ids_estrategias,');
        d := replace(d, 'v->>''notas'', v->>''id_estrategia'',',
            'v->>''notas'', v->>''id_estrategia'', '
            || 'case when jsonb_typeof(v->''ids_estrategias'') = ''array'' '
            || 'then array(select jsonb_array_elements_text(v->''ids_estrategias'')) else null end,');
        d := replace(d, 'id_estrategia = excluded.id_estrategia,',
            'id_estrategia = excluded.id_estrategia, ids_estrategias = excluded.ids_estrategias,');
        if d not like '%ids_estrategias = excluded.ids_estrategias%' then
            raise exception 'pdt_espejo_guardar: no se pudo parchar (la definición cambió)';
        end if;
        execute d;
    end if;

    -- ---------- leer (las dos sobrecargas de pdt_visitas_en_alcance) ----------
    for f in
        select p.oid
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'pdt_visitas_en_alcance'
    loop
        d := pg_get_functiondef(f.oid);
        if d not like '%ids_estrategias%' then
            d := replace(d, '''id_estrategia'', v.id_estrategia,',
                '''id_estrategia'', v.id_estrategia, '
                || '''ids_estrategias'', to_jsonb(coalesce(v.ids_estrategias, '
                || 'case when v.id_estrategia is null then null else array[v.id_estrategia] end)),');
            if d not like '%ids_estrategias%' then
                raise exception 'pdt_visitas_en_alcance: no se pudo parchar (la definición cambió)';
            end if;
            execute d;
        end if;
    end loop;
end $$;
