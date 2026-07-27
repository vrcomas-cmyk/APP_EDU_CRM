-- Plan de Trabajo — el panel de Usuarios ahora sí invita de verdad.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- ── El bug que esto arregla ──────────────────────────────────────────────────────────
--
-- `pdt_invitaciones` es la lista blanca de acceso: "Sin renglón aceptado o pendiente aquí,
-- la PWA no deja entrar" (ver su comentario en 20260718b_pdt_espejo_e_invitaciones.sql).
-- Pero `pdt_usuario_guardar` —la función detrás de "+ Invitar por correo" en el panel de
-- Roles administrables— nunca escribía ahí. Efecto doble: la pantalla mostraba "Sin
-- invitar" para siempre (`pdt_usuarios_admin` lee el estado de esa tabla), y la persona
-- invitada de verdad NO PODÍA ENTRAR — `pdt_perfil` devolvía `invitado: false` por falta
-- de fila, y el cliente lo interpreta como un NO explícito del servidor (`accesoBloqueado`
-- en `js/permisos.js`), mostrando "Esta cuenta no tiene invitación para entrar" aunque el
-- administrador la hubiera dado de alta con su rol correctamente.

create or replace function pdt_usuario_guardar(p_actor text, p_usuario jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor   text := pdt_exige_admin(p_actor);
    v_correo  text := lower(trim(coalesce(p_usuario->>'correo', '')));
    v_activo  boolean := coalesce((p_usuario->>'activo')::boolean, true);
    v_roles   jsonb := p_usuario->'roles';
    v_malos   text;
begin
    if v_correo = '' or v_correo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'El correo "%" no parece válido.', coalesce(v_correo, '');
    end if;

    insert into pdt_usuarios (correo, nombre, activo)
    values (v_correo, nullif(trim(p_usuario->>'nombre'), ''), v_activo)
    on conflict (correo) do update
        set nombre = coalesce(excluded.nombre, pdt_usuarios.nombre),
            activo = excluded.activo;

    if v_roles is not null and jsonb_typeof(v_roles) = 'array' then
        select string_agg(quote_literal(x), ', ') into v_malos
        from jsonb_array_elements_text(v_roles) x
        where not exists (select 1 from pdt_roles r where r.clave = x);

        if v_malos is not null then
            raise exception 'Estos roles no existen: %.', v_malos;
        end if;

        delete from pdt_usuario_roles where lower(trim(correo)) = v_correo;

        insert into pdt_usuario_roles (correo, rol)
        select v_correo, x from jsonb_array_elements_text(v_roles) x
        on conflict do nothing;

        -- Apaga las dos concesiones viejas para este correo. Ver el comentario de arriba:
        -- sin esto, quitar un rol en la pantalla no lo quita en la práctica.
        update pdt_usuarios set rol = null where lower(trim(correo)) = v_correo;
        update pdt_invitaciones set rol = null where lower(trim(correo)) = v_correo;
    end if;

    -- La fila que faltaba. `activo:false` revoca —sea que ya estuviera aceptada o pendiente—;
    -- `activo:true` la deja `pendiente` si es nueva o si venía revocada (reactivar), y NO toca
    -- una que ya está `pendiente` o `aceptada`: perder el "aceptada" cada vez que el admin
    -- vuelve a guardar la pantalla (p. ej. al cambiarle un rol) le haría repetir el trámite de
    -- `pdt_aceptar_invitacion` sin necesidad y desordenaría `aceptada_en`.
    insert into pdt_invitaciones (correo, nombre, invitado_por, estado)
    values (
        v_correo, nullif(trim(p_usuario->>'nombre'), ''), v_actor,
        case when v_activo then 'pendiente' else 'revocada' end
    )
    on conflict (correo) do update
        set estado = case
                when not v_activo then 'revocada'
                when pdt_invitaciones.estado = 'revocada' then 'pendiente'
                else pdt_invitaciones.estado
            end;

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('correo', v_correo, 'guardado', true);
end $$;

revoke execute on function pdt_usuario_guardar(text, jsonb) from public, anon, authenticated;
grant execute on function pdt_usuario_guardar(text, jsonb) to service_role;
