-- Importación de AppSheet: subir a las tablas VIVAS lo que alguien ya revisó y aprobó.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Contexto: mientras los educadores migran poco a poco, AppSheet sigue en uso. Un script de Apps
-- Script (`ImportarAppSheet.gs`) trae sus datos, los transforma al modelo de la app y los deja en
-- pestañas "AS_*" de la hoja de la app para que una PERSONA los revise. Solo lo que esa persona
-- marca `aprobada` llega aquí.
--
-- ── Por qué reutiliza `pdt_espejo_guardar` ──────────────────────────────────────────────
--
-- Los datos importados deben verse "como si se hubieran capturado en la app": en el calendario, en
-- los cálculos y en las revisiones. La forma más segura de lograrlo es guardarlos con la MISMA
-- función con la que guarda la app (`pdt_espejo_guardar`, la que usa `pdt_visitas_guardar_sesion`),
-- no con inserts propios que se desalineen cuando esa función cambie. Y se encolan para el export
-- a las pestañas normales (`pdt_export_cola`), igual que cualquier visita capturada.
--
-- ── Qué NO se pisa ──────────────────────────────────────────────────────────────────────
--
-- Los ids de AppSheet llevan el prefijo `as-`, así que no pueden chocar con los de la app. Si una
-- visita importada se EDITA después en la app (`actualizado` posterior a `importado_en`), una
-- importación nueva la omite y lo dice: lo que alguien corrigió en la app gana sobre AppSheet.

alter table pdt_visitas add column if not exists fuente       text;
alter table pdt_visitas add column if not exists importado_en timestamptz;

create or replace function pdt_appsheet_importar(p_visitas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v          jsonb;
    v_id       text;
    v_correo   text;
    v_nombre   text;
    v_previa   record;
    v_ahora    timestamptz := now();
    importadas text[] := '{}';
    omitidas   jsonb  := '[]'::jsonb;
begin
    for v in select * from jsonb_array_elements(coalesce(p_visitas, '[]'::jsonb))
    loop
        v_id     := v->>'id';
        v_correo := lower(nullif(trim(v->>'educador_correo'), ''));

        if v_id is null or v_id not like 'as-%' then
            omitidas := omitidas || jsonb_build_object('id', v_id, 'motivo', 'el id no empieza con as-');
            continue;
        end if;
        if v_correo is null then
            omitidas := omitidas || jsonb_build_object('id', v_id, 'motivo', 'sin correo del educador');
            continue;
        end if;

        select actualizado, importado_en into v_previa from pdt_visitas where id = v_id;
        if found and v_previa.importado_en is not null and v_previa.actualizado > v_previa.importado_en then
            omitidas := omitidas || jsonb_build_object(
                'id', v_id, 'motivo', 'se editó en la app después de importarse: no se pisa');
            continue;
        end if;

        -- La misma función con la que guarda la app. `actualizado` queda en now() y, como esto es UNA
        -- transacción, `importado_en` recibe exactamente el mismo valor: "sin editar desde la importación".
        perform pdt_espejo_guardar(v_correo, jsonb_build_array(v));
        update pdt_visitas set fuente = 'appsheet', importado_en = v_ahora, actualizado = v_ahora where id = v_id;

        -- Para las pestañas normales (Visitas, Actividades, Materiales_Capturados).
        select nombre into v_nombre from pdt_usuarios where lower(trim(correo)) = v_correo;
        insert into pdt_export_cola (id_visita, correo, nombre, payload, encolado)
        values (v_id, v_correo, v_nombre, v, v_ahora)
        on conflict (id_visita) do update set
            correo = excluded.correo, nombre = excluded.nombre, payload = excluded.payload,
            encolado = v_ahora, tomado = null;

        importadas := array_append(importadas, v_id);
    end loop;

    return jsonb_build_object('ok', true, 'importadas', to_jsonb(importadas), 'omitidas', omitidas);
end;
$$;

-- Solo Apps Script, con el service_role: nadie más debe poder escribir visitas "como" otro educador.
revoke execute on function pdt_appsheet_importar(jsonb) from public, anon, authenticated;
grant  execute on function pdt_appsheet_importar(jsonb) to service_role;
