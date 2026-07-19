/*
 * Roles administrables — el camino de ESCRITURA.
 *
 * La migración anterior (20260719c) puso el cimiento: el catálogo de capacidades, la herencia
 * entre roles, varios roles por persona y `es_admin` calculado por capacidad. Todo eso se
 * podía LEER desde la pantalla, pero solo se podía ESCRIBIR con SQL a mano. Esto lo cierra.
 *
 * ── Por qué todo pasa por funciones y no por la tabla ────────────────────────────────────
 *
 * La PWA solo tiene la clave anónima, que es pública: viaja dentro de su propio JavaScript.
 * Si estas tablas fueran escribibles con ella, cualquiera podría concederse el rol que
 * quisiera. Por eso todo esto es `security definer`, se le revoca a `anon`, y el único que
 * puede llamarlo es Apps Script con la clave de servicio — que vive en Script Properties y
 * nunca entra al repositorio. Es el mismo camino que ya usan `leerVisitasEquipo` y
 * `guardarCatalogosAdmin`, por el mismo motivo.
 *
 * ── Las cuatro cosas que estas funciones no dejan hacer ──────────────────────────────────
 *
 *   1. Quedarse sin administradores. Es el error irreversible: el que edita sus propios roles
 *      y se quita el último `administracion.configurar` pierde la pantalla que necesitaría
 *      para devolvérselo. Cada escritura verifica al final que quede alguien, y si no, falla.
 *   2. Ciclos de herencia. El CHECK de la tabla solo impide que un rol herede de sí mismo;
 *      A→B→A pasaba. No cuelga —`pdt_rol_capacidades` usa `union`— pero es una cadena sin
 *      raíz que nadie puede razonar. Se rechaza al escribir, que es cuando se puede explicar.
 *   3. Conceder capacidades que no existen. Un `visitas.aprovar` mal escrito se guardaría sin
 *      protestar y no concedería nada; el rol se vería correcto en pantalla y no funcionaría.
 *   4. Borrar un rol que alguien está usando o del que otro hereda.
 */

-- ---------- quién puede llamar a esto ----------

/*
 * ¿Este correo tiene esta capacidad?
 *
 * Envuelve a `pdt_capacidades_de` para poder preguntar por una sola sin traerlas todas.
 */
create or replace function pdt_puede(p_correo text, p_capacidad text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from pdt_capacidades_de(p_correo) c where c.clave = p_capacidad
    );
$$;

/*
 * Falla si el actor no puede administrar.
 *
 * Apps Script ya comprueba lo mismo antes de llamar, y aun así se vuelve a comprobar aquí.
 * No es desconfianza del script: es que la comprobación tiene que vivir junto al dato, para
 * que un camino nuevo —otro script, una consola, una función futura— no pueda saltársela por
 * olvido. La autorización que solo existe en el llamador se pierde en cuanto hay dos.
 *
 * `pdt_admins` se sigue aceptando: es la llave heredada de quien instaló esto antes de que
 * existieran los roles, y quitarla dejaría fuera a la única persona que hoy puede entrar.
 */
create or replace function pdt_exige_admin(p_actor text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_actor text := lower(trim(coalesce(p_actor, '')));
begin
    if v_actor = '' then
        raise exception 'Falta la identidad de quien hace el cambio.';
    end if;

    if pdt_puede(v_actor, 'administracion.configurar')
       or exists (select 1 from pdt_admins a where lower(trim(a.correo)) = v_actor)
    then
        return v_actor;
    end if;

    raise exception 'La cuenta % no puede administrar roles ni usuarios.', v_actor;
end $$;

/*
 * ¿Queda alguien que pueda administrar?
 *
 * Se llama al FINAL de cada escritura, no al principio. La diferencia importa: el cambio que
 * deja la instalación sin administradores casi nunca se ve venir mirando el estado previo
 * —quitarle un rol a alguien, desactivar un rol, borrar un permiso— y sí se ve mirando el
 * estado resultante. Como la excepción aborta la función entera, el estado malo nunca llega
 * a existir.
 */
create or replace function pdt_exige_que_quede_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Los legados de `pdt_admins` cuentan: mientras exista uno, la instalación es recuperable.
    if exists (select 1 from pdt_admins) then return; end if;

    if exists (
        select 1
        from (
            select lower(trim(correo)) as correo from pdt_usuario_roles
            union
            select lower(trim(correo)) from pdt_usuarios where activo
        ) c
        where pdt_puede(c.correo, 'administracion.configurar')
    ) then
        return;
    end if;

    raise exception
        'Ese cambio dejaría la instalación sin ningún administrador, y nadie podría volver '
        'a entrar a esta pantalla para deshacerlo.';
end $$;

-- ---------- roles ----------

/*
 * Crea o actualiza un rol con sus capacidades PROPIAS (las heredadas no se guardan: se
 * resuelven al leer, que es lo que permite que cambiar el padre actualice a todos los hijos).
 *
 * Carga esperada:
 *   { clave, nombre, descripcion, orden, activo, hereda_de, capacidades: [ "modulo.accion" ] }
 *
 * `capacidades` ausente significa «no toques las capacidades»; `[]` significa «déjalo sin
 * ninguna». Son cosas distintas y confundirlas vaciaría un rol al renombrarlo.
 */
create or replace function pdt_rol_guardar(p_actor text, p_rol jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor     text := pdt_exige_admin(p_actor);
    v_clave     text := lower(trim(coalesce(p_rol->>'clave', '')));
    v_hereda    text := nullif(trim(coalesce(p_rol->>'hereda_de', '')), '');
    v_sistema   boolean;
    v_activo    boolean := coalesce((p_rol->>'activo')::boolean, true);
    v_caps      jsonb := p_rol->'capacidades';
    v_paso      text;
    v_saltos    int := 0;
    v_desconocidas text;
begin
    if v_clave = '' then
        raise exception 'El rol necesita una clave.';
    end if;

    -- La clave viaja dentro de las capacidades como `modulo.accion` y se compara en código.
    -- Un espacio o un acento la volverían imposible de escribir en un `puede(...)`.
    if v_clave !~ '^[a-z][a-z0-9_]*$' then
        raise exception 'La clave "%" solo puede llevar minúsculas, números y guion bajo, y '
                        'debe empezar por letra.', v_clave;
    end if;

    select sistema into v_sistema from pdt_roles where clave = v_clave;

    -- Un rol del sistema se puede renombrar y reajustar, pero no apagar: `administrador` es
    -- el que concede la entrada a esta pantalla.
    if coalesce(v_sistema, false) and not v_activo then
        raise exception 'El rol "%" es del sistema y no se puede desactivar.', v_clave;
    end if;

    if v_hereda is not null then
        if not exists (select 1 from pdt_roles where clave = v_hereda) then
            raise exception 'El rol del que quiere heredar ("%") no existe.', v_hereda;
        end if;

        -- Sube por la cadena del padre propuesto. Si llega al propio rol, cerraría un ciclo.
        -- El tope de saltos es una red por si ya existiera uno en la tabla de antes.
        v_paso := v_hereda;
        while v_paso is not null and v_saltos < 50 loop
            if v_paso = v_clave then
                raise exception 'Esa herencia haría un ciclo: "%" ya hereda de "%".',
                                v_hereda, v_clave;
            end if;
            select hereda_de into v_paso from pdt_roles where clave = v_paso;
            v_saltos := v_saltos + 1;
        end loop;
    end if;

    insert into pdt_roles (clave, nombre, descripcion, orden, activo, hereda_de)
    values (
        v_clave,
        coalesce(nullif(trim(p_rol->>'nombre'), ''), initcap(replace(v_clave, '_', ' '))),
        nullif(trim(p_rol->>'descripcion'), ''),
        coalesce((p_rol->>'orden')::int, 0),
        v_activo,
        v_hereda
    )
    on conflict (clave) do update
        set nombre      = excluded.nombre,
            descripcion = excluded.descripcion,
            orden       = excluded.orden,
            activo      = excluded.activo,
            hereda_de   = excluded.hereda_de;

    if v_caps is not null and jsonb_typeof(v_caps) = 'array' then
        -- Una capacidad que no está en el catálogo no concede nada. Guardarla en silencio
        -- daría un rol que se ve bien en pantalla y no funciona, que es el peor de los dos.
        select string_agg(quote_literal(x), ', ') into v_desconocidas
        from jsonb_array_elements_text(v_caps) x
        where not exists (select 1 from pdt_capacidades c where c.clave = x);

        if v_desconocidas is not null then
            raise exception 'Estas capacidades no existen en el catálogo: %.', v_desconocidas;
        end if;

        delete from pdt_permisos where rol = v_clave;

        insert into pdt_permisos (rol, modulo, accion)
        select v_clave, c.modulo, c.accion
        from jsonb_array_elements_text(v_caps) x
        join pdt_capacidades c on c.clave = x
        on conflict do nothing;
    end if;

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('clave', v_clave, 'guardado', true);
end $$;

/*
 * Borra un rol. Se niega en tres casos, y en los tres el mensaje dice qué hacer en vez de
 * limitarse a negar: quien administra necesita saber si el camino es reasignar gente,
 * desenlazar un hijo, o que sencillamente no hay camino.
 *
 * Desactivar es casi siempre lo que se quería: conserva los permisos por si la decisión se
 * revierte, mientras que borrar se lleva por delante los renglones de `pdt_permisos`.
 */
create or replace function pdt_rol_eliminar(p_actor text, p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor     text := pdt_exige_admin(p_actor);
    v_clave     text := lower(trim(coalesce(p_clave, '')));
    v_sistema   boolean;
    v_usuarios  int;
    v_herederos int;
begin
    select sistema into v_sistema from pdt_roles where clave = v_clave;
    if v_sistema is null then
        raise exception 'El rol "%" no existe.', v_clave;
    end if;

    if v_sistema then
        raise exception 'El rol "%" es del sistema y no se puede borrar. Si ya no quieres '
                        'que se use, quítaselo a quien lo tenga.', v_clave;
    end if;

    select count(*) into v_usuarios
      from (
        select lower(trim(correo)) as correo from pdt_usuario_roles where rol = v_clave
        union
        select lower(trim(correo)) from pdt_usuarios where rol = v_clave
      ) x;

    if v_usuarios > 0 then
        raise exception 'El rol "%" lo tienen % persona(s). Cámbiales el rol antes de '
                        'borrarlo, o desactívalo para que deje de ofrecerse.',
                        v_clave, v_usuarios;
    end if;

    select count(*) into v_herederos from pdt_roles where hereda_de = v_clave;
    if v_herederos > 0 then
        raise exception 'De "%" heredan % rol(es). Quítales la herencia antes de borrarlo.',
                        v_clave, v_herederos;
    end if;

    delete from pdt_roles where clave = v_clave;   -- pdt_permisos se va por CASCADE

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('clave', v_clave, 'borrado', true);
end $$;

-- ---------- usuarios ----------

/*
 * Guarda un usuario y REEMPLAZA su conjunto de roles.
 *
 * Carga: { correo, nombre, activo, roles: ["educador", "analista"] }
 *
 * ── El detalle que hace que esto funcione de verdad ──────────────────────────────────────
 *
 * `pdt_capacidades_de` une TRES fuentes: `pdt_usuario_roles`, el `pdt_usuarios.rol` viejo y
 * el `pdt_invitaciones.rol` de la invitación. Esa unión fue deliberada —era lo que impedía
 * que la migración dejara sin acceso a los usuarios reales— pero convierte a las dos últimas
 * en concesiones que sobreviven a cualquier cambio hecho desde aquí.
 *
 * Sin lo de abajo, quitarle el rol de administrador a alguien en la pantalla no se lo
 * quitaría: seguiría entrando por su fila vieja o por su invitación, y el registro de
 * permisos diría una cosa mientras la aplicación hace otra. Así que en cuanto un correo tiene
 * roles explícitos, ese conjunto es el único que manda y las dos fuentes viejas se apagan
 * para él. No se apagan para los demás: quien nunca haya pasado por esta pantalla conserva su
 * acceso intacto.
 */
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

    perform pdt_exige_que_quede_admin();

    return jsonb_build_object('correo', v_correo, 'guardado', true);
end $$;

/*
 * Reemplaza a quién ve un jefe.
 *
 * Es la tabla que decide el ALCANCE —qué visitas de otros aparecen— así que se escribe por
 * conjunto completo y no fila a fila: la pantalla muestra la lista entera de subordinados y
 * guardar significa «esta es la lista», incluido el caso de dejarla vacía.
 *
 * `pdt_alcance` es recursiva y ya corta ciclos con `union`, pero un ciclo aquí significa que
 * dos personas se ven mutuamente hacia arriba, que no es una jerarquía. Se rechaza igual que
 * en los roles y por la misma razón: es al escribir cuando se puede explicar qué pasó.
 */
create or replace function pdt_jerarquia_guardar(
    p_actor         text,
    p_jefe          text,
    p_subordinados  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor text := pdt_exige_admin(p_actor);
    v_jefe  text := lower(trim(coalesce(p_jefe, '')));
    v_sub   text;
    v_n     int := 0;
begin
    if v_jefe = '' then
        raise exception 'Falta el correo del jefe.';
    end if;

    for v_sub in
        select distinct lower(trim(x)) from jsonb_array_elements_text(
            coalesce(p_subordinados, '[]'::jsonb)) x
        where trim(x) <> ''
    loop
        if v_sub = v_jefe then
            raise exception 'Nadie puede ser su propio jefe.';
        end if;

        -- ¿El subordinado propuesto ya ve al jefe? Entonces esto cerraría el círculo.
        if exists (select 1 from pdt_alcance(v_sub) a where lower(trim(a.correo)) = v_jefe) then
            raise exception '% ya está por encima de % en la jerarquía; ponerlo debajo haría '
                            'un ciclo.', v_sub, v_jefe;
        end if;
    end loop;

    delete from pdt_jerarquia where lower(trim(jefe)) = v_jefe;

    insert into pdt_jerarquia (jefe, subordinado)
    select v_jefe, lower(trim(x))
    from jsonb_array_elements_text(coalesce(p_subordinados, '[]'::jsonb)) x
    where trim(x) <> '' and lower(trim(x)) <> v_jefe
    on conflict do nothing;

    get diagnostics v_n = row_count;

    return jsonb_build_object('jefe', v_jefe, 'subordinados', v_n);
end $$;

-- ---------- el hueco que dejaba fuera a los roles nuevos ----------

/*
 * `pdt_es_admin` comparaba solo contra `pdt_admins`.
 *
 * Es la función que Apps Script consulta para dejar publicar catálogos, así que un rol nuevo
 * con TODAS las capacidades de administración seguía sin poder publicar: el rol se creaba en
 * la pantalla, se veía correcto, y la acción fallaba con «no tiene permisos de
 * administrador». Era el mismo `if (rol == "administrador")` de `pdt_perfil`, escondido un
 * nivel más abajo, y se arregla igual: la pregunta es qué puede, no cómo se llama.
 *
 * Sigue siendo un OR con `pdt_admins`, así que esto solo puede conceder de más, nunca de
 * menos: nadie que hoy entre deja de entrar.
 */
create or replace function pdt_es_admin(p_correo text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from pdt_admins where correo = lower(trim(p_correo))
    ) or pdt_puede(p_correo, 'administracion.configurar');
$$;

-- ---------- permisos de ejecución ----------

/*
 * Nada de esto se le da a `anon`. La clave anónima es pública —viaja en el JavaScript de la
 * PWA— y con ella cualquiera podría concederse el rol que quisiera.
 */
revoke execute on function pdt_puede(text, text)                    from public, anon, authenticated;
revoke execute on function pdt_exige_admin(text)                    from public, anon, authenticated;
revoke execute on function pdt_exige_que_quede_admin()              from public, anon, authenticated;
revoke execute on function pdt_rol_guardar(text, jsonb)             from public, anon, authenticated;
revoke execute on function pdt_rol_eliminar(text, text)             from public, anon, authenticated;
revoke execute on function pdt_usuario_guardar(text, jsonb)         from public, anon, authenticated;
revoke execute on function pdt_jerarquia_guardar(text, text, jsonb) from public, anon, authenticated;

grant execute on function pdt_puede(text, text)                    to service_role;
grant execute on function pdt_exige_admin(text)                    to service_role;
grant execute on function pdt_exige_que_quede_admin()              to service_role;
grant execute on function pdt_rol_guardar(text, jsonb)             to service_role;
grant execute on function pdt_rol_eliminar(text, text)             to service_role;
grant execute on function pdt_usuario_guardar(text, jsonb)         to service_role;
grant execute on function pdt_jerarquia_guardar(text, text, jsonb) to service_role;

-- `pdt_es_admin` conserva el suyo: Apps Script la llama con la clave anónima desde
-- `esAdminSupabase`, y quitárselo rompería el guardado de catálogos que hoy funciona.
grant execute on function pdt_es_admin(text) to anon, authenticated, service_role;
