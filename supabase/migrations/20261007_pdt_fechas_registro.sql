-- Fechas de REGISTRO: cuándo se generó cada registro, aparte de la fecha de la visita (`dia`) y
-- de la fecha del documento (`fecha_documento`).
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
--   visita      creada_en    cuándo se generó el registro en la app (fecha de CAPTURA). Nunca se
--                            reescribe: el primer valor que llegó es el bueno.
--               registrada_en  cuándo llegó al servidor por primera vez (default now(); las filas
--                            que ya existían quedan en null: no se sabe).
--   sector      creado_en    cuándo se agregó el sector a la visita.
--   actividad   creada_en    cuándo se abrió el borrador (el sello `guardada_momento` ya existía).
--               evidencia_adjuntada_en  cuándo se adjuntó el archivo de evidencia.
--   material    creado_en    cuándo se capturó el material.
--
-- Por qué el sello viene del CLIENTE y no de un `default now()`: `pdt_espejo_guardar` borra y
-- vuelve a insertar sectores, actividades y materiales en cada guardado, así que un default se
-- reiniciaría en cada sync. Por la misma razón, las dos lecturas (`pdt_visitas_en_alcance`) DEBEN
-- devolver estos campos: `adoptarVisitasPropias` reemplaza la visita local por la remota y, si no
-- vinieran, la siguiente subida los dejaría en null.
--
-- Las funciones NO se reescriben a mano: se parchan sobre su definición VIVA
-- (`pg_get_functiondef`), tolerando espacios, para conservar cualquier cambio posterior. Si la
-- definición cambió de forma que no se pueda parchar, la migración FALLA y no cambia nada.

alter table pdt_visitas     add column if not exists creada_en   timestamptz;
alter table pdt_visitas     add column if not exists registrada_en timestamptz;
alter table pdt_visitas     alter column registrada_en set default now();
alter table pdt_sectores    add column if not exists creado_en   timestamptz;
alter table pdt_actividades add column if not exists creada_en   timestamptz;
alter table pdt_actividades add column if not exists evidencia_adjuntada_en timestamptz;
alter table pdt_materiales  add column if not exists creado_en   timestamptz;

do $$
declare
    f record;
    d text;
    n int;
begin
    -- ---------- guardar (espejo) ----------
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'pdt_espejo_guardar';

    if d is null then
        raise exception 'pdt_espejo_guardar no existe';
    end if;

    if d not like '%evidencia_adjuntada_en%' then
        -- visita
        d := regexp_replace(d, 'calendar_event_id(\s*)\)(\s*)values',
            'calendar_event_id, creada_en\1)\2values');
        d := regexp_replace(d, 'nullif\(v->>''calendar_event_id'', ''''\)(\s*)\)(\s*)on conflict',
            'nullif(v->>''calendar_event_id'', ''''),' || chr(10)
            || '            nullif(v->>''creada'', '''')::timestamptz\1)\2on conflict');
        -- el primer valor que llegó es el bueno: nunca se reescribe
        d := regexp_replace(d,
            'calendar_event_id = coalesce\(excluded\.calendar_event_id, pdt_visitas\.calendar_event_id\);',
            'calendar_event_id = coalesce(excluded.calendar_event_id, pdt_visitas.calendar_event_id),' || chr(10)
            || '            creada_en = coalesce(pdt_visitas.creada_en, excluded.creada_en);');

        -- sector
        d := regexp_replace(d, 'guardado_momento, guardado_usuario, programado(\s*)\)(\s*)values',
            'guardado_momento, guardado_usuario, programado, creado_en\1)\2values');
        d := regexp_replace(d, '\(s->>''programado''\)::boolean(\s*)\)',
            '(s->>''programado'')::boolean,' || chr(10)
            || '                nullif(s->>''creado'', '''')::timestamptz\1)');

        -- actividad
        d := regexp_replace(d, 'resultado_seguimiento, sectores_ids(\s*)\)(\s*)values',
            'resultado_seguimiento, sectores_ids, creada_en, evidencia_adjuntada_en\1)\2values');
        d := regexp_replace(d,
            '(jsonb_array_elements_text\(a->''sectores_ids''\) x\)\s*else null end)(\s*)\)',
            '\1,' || chr(10)
            || '                    nullif(a->>''creada'', '''')::timestamptz,' || chr(10)
            || '                    nullif(a#>>''{evidencia,adjuntada}'', '''')::timestamptz\2)');

        -- material
        d := regexp_replace(d, 'unidad, origen(\s*)\)(\s*)values',
            'unidad, origen, creado_en\1)\2values');
        d := regexp_replace(d, 'm->>''unidad'', m->>''origen''(\s*)\)',
            'm->>''unidad'', m->>''origen'',' || chr(10)
            || '                        nullif(m->>''creado'', '''')::timestamptz\1)');

        n := (length(d) - length(replace(d, 'creado_en', ''))) / length('creado_en');
        if d not like '%creada_en = coalesce(pdt_visitas.creada_en%'
           or d not like '%evidencia_adjuntada_en%'
           or d not like '%nullif(m->>''creado''%'
           or d not like '%nullif(s->>''creado''%'
           or d not like '%nullif(v->>''creada''%'
           or d not like '%nullif(a->>''creada''%'
           or n < 2 then
            raise exception 'pdt_espejo_guardar: no se pudo parchar (la definición cambió)';
        end if;
        execute d;
    end if;

    -- ---------- leer (las sobrecargas de pdt_visitas_en_alcance) ----------
    for f in
        select p.oid, p.pronargs
          from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public' and p.proname = 'pdt_visitas_en_alcance'
    loop
        d := pg_get_functiondef(f.oid);
        if d like '%evidencia_adjuntada_en%' then
            continue;
        end if;

        d := replace(d, '''id'', v.id,', '''id'', v.id, ''creada'', v.creada_en,');
        d := replace(d, '''id'', s.id,', '''id'', s.id, ''creado'', s.creado_en,');
        d := replace(d, '''id'', a.id,', '''id'', a.id, ''creada'', a.creada_en,');
        d := replace(d, '''tipo'', a.evidencia_tipo)',
            '''tipo'', a.evidencia_tipo, ''adjuntada'', a.evidencia_adjuntada_en)');
        d := replace(d, '''origen'', m.origen))', '''origen'', m.origen, ''creado'', m.creado_en))');

        if d like '%v.creada_en%' and d like '%s.creado_en%' and d like '%a.creada_en%'
           and d like '%evidencia_adjuntada_en%' and d like '%m.creado_en%' then
            execute d;
        elsif f.pronargs = 5 then
            -- Es la que usa la PWA (visitas del equipo): si no se puede parchar, no se sigue.
            raise exception 'pdt_visitas_en_alcance(%): no se pudo parchar (la definición cambió)', f.pronargs;
        else
            raise notice 'pdt_visitas_en_alcance con % parámetros: definición antigua, se deja igual', f.pronargs;
        end if;
    end loop;
end $$;
