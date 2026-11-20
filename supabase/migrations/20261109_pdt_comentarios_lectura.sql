-- Lectura de comentarios desde el servidor.
--
-- Hasta hoy los comentarios solo SUBÍAN (`pdt_comentarios_guardar_sesion`): cada dispositivo veía
-- únicamente los que escribió. El revisor no veía lo que dijo el educador, ni al revés.
--
-- Esta función devuelve los comentarios de las visitas pedidas que la sesión puede ver, con la
-- MISMA regla de acceso que la evidencia: el dueño de la visita, alguien a cuyo cargo está el
-- dueño, un administrador — y siempre lo que la propia sesión escribió.

create or replace function pdt_comentarios_de_visitas_sesion(p_sesion_token text, p_ids_visita text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
    v_correo text := lower(coalesce(pdt_correo_de_sesion(p_sesion_token), ''));
    v_admin  boolean;
begin
    if v_correo = '' or p_ids_visita is null or cardinality(p_ids_visita) = 0 then
        return '[]'::jsonb;
    end if;

    v_admin := pdt_es_admin(v_correo);

    return coalesce((
        select jsonb_agg(jsonb_build_object(
                   'id', c.id,
                   'ambito', c.ambito,
                   'id_ambito', c.id_ambito,
                   'id_visita', c.id_visita,
                   'cliente', c.cliente,
                   'hospital', c.hospital,
                   'texto', c.texto,
                   'usuario', c.usuario,
                   'usuario_correo', c.usuario_correo,
                   'momento', c.momento
               ) order by c.momento)
          from pdt_comentarios c
          left join pdt_visitas v on v.id = c.id_visita
         where c.id_visita = any (p_ids_visita)
           and (
                v_admin
                or lower(c.usuario_correo) = v_correo
                or lower(trim(v.educador_correo)) = v_correo
                or exists (select 1 from pdt_alcance(v_correo) al
                            where lower(al.correo) = lower(trim(v.educador_correo)))
           )
    ), '[]'::jsonb);
end;
$$;

revoke execute on function pdt_comentarios_de_visitas_sesion(text, text[]) from public;
grant  execute on function pdt_comentarios_de_visitas_sesion(text, text[]) to anon, authenticated, service_role;
