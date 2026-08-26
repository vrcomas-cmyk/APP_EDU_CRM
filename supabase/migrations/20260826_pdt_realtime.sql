-- Fase 2: sincronía instantánea por broadcast desde triggers.
--
-- Las tablas pdt_* tienen RLS sin políticas (deny-all para anon) y así debe seguir: la clave
-- anónima es pública, y suscribirse a `postgres_changes` obligaría a abrir lectura de filas a
-- internet entero. En su lugar el servidor manda un PING SIN DATOS ("algo cambió en esta
-- tabla") y el cliente responde llamando a los RPC que ya existen y ya resuelven alcance
-- jerárquico (`pdt_visitas_equipo_sesion`, etc.) — el mismo patrón que el poll de 60s de hoy,
-- solo que disparado al instante en vez de una vez por minuto.
--
-- Solo se aplica al proyecto de PRUEBA. El oficial (fiplfsuhsqibzrpvjvbx) no se toca.

set check_function_bodies = off;

-- ---------- secreto del servidor ----------
--
-- El topic de cada quien tiene que ser opaco (no el correo en claro: un canal público con el
-- correo como nombre dejaría "ver" quién existe y cuándo se conecta). Lo que lo hace opaco es
-- mezclar el correo con un secreto que NADIE fuera de una función `security definer` puede
-- leer — ni siquiera con la clave anónima. Por eso vive en su propia tabla con RLS sin
-- políticas, exactamente el mismo candado que ya protege `pdt_sesiones`.
create table if not exists public.pdt_config_interno (
    clave text primary key,
    valor text not null
);
alter table public.pdt_config_interno enable row level security;

insert into public.pdt_config_interno (clave, valor)
values ('secreto_canal_realtime', encode(gen_random_bytes(32), 'hex'))
on conflict (clave) do nothing;

-- ---------- jefes de un correo (inverso de pdt_alcance) ----------
--
-- `pdt_alcance(correo)` ya baja: de un jefe a todos sus subordinados. Para avisar hace falta
-- lo contrario: de quien capturó, subir a todos sus jefes (que también deben enterarse al
-- instante de lo que hace su equipo). Se incluye al propio correo porque sus otros
-- dispositivos también necesitan el aviso.
create or replace function public.pdt_jefes_de(p_correo text)
returns table(correo text)
language sql
stable
security definer
set search_path to 'public'
as $function$
    with recursive arriba as (
        select lower(trim(p_correo)) as correo
        union
        select lower(trim(j.jefe))
        from pdt_jerarquia j
        join arriba a on lower(trim(j.subordinado)) = a.correo
    )
    select distinct arriba.correo from arriba
$function$;

revoke all on function public.pdt_jefes_de(text) from public;

-- ---------- canal de sesión ----------
--
-- Envoltura pública (como `pdt_visitas_guardar_sesion`): resuelve identidad a partir del
-- `sesion_token` con `pdt_correo_de_sesion` y devuelve SOLO el topic derivado, nunca el
-- secreto ni el correo de otra persona.
create or replace function public.pdt_canal_de_sesion(p_sesion_token text)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
    v_correo   text := pdt_correo_de_sesion(p_sesion_token);
    v_secreto  text;
begin
    select valor into v_secreto from pdt_config_interno where clave = 'secreto_canal_realtime';
    return 'pdt_' || encode(digest(lower(trim(v_correo)) || v_secreto, 'sha256'), 'hex');
end;
$function$;

revoke all on function public.pdt_canal_de_sesion(text) from public;
grant execute on function public.pdt_canal_de_sesion(text) to anon;

-- ---------- trigger de aviso ----------
--
-- Un solo disparador para las seis tablas donde un cambio de un dispositivo tiene que
-- reflejarse en otro al instante. `pdt_catalogos` queda fuera de esta pasada a propósito: no
-- tiene un dueño (`educador_correo`) del que colgar el aviso, y sus cambios son poco
-- frecuentes (importaciones), no el caso que esta fase busca resolver.
create or replace function public.pdt_avisar_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
    -- `v_fila` es un `record` genérico (esta función dispara sobre seis tablas con columnas
    -- distintas): acceder a un campo con `v_fila.campo` hace que PL/pgSQL intente resolverlo
    -- contra el tipo real de la fila incluso en una rama del CASE que no se va a tomar, y
    -- revienta con "no field campo" para la tabla que no lo tiene. `to_jsonb()->>` no tiene
    -- ese problema: devuelve NULL si la clave no existe, en vez de fallar.
    v_fila    record := coalesce(NEW, OLD);
    v_json    jsonb := to_jsonb(v_fila);
    v_correo  text;
    v_secreto text;
    v_jefe    record;
begin
    v_correo := case TG_TABLE_NAME
        when 'pdt_visitas'     then v_json->>'educador_correo'
        when 'pdt_eventos'     then v_json->>'educador_correo'
        when 'pdt_revisiones'  then v_json->>'educador_correo'
        when 'pdt_comentarios' then v_json->>'usuario_correo'
        when 'pdt_sectores'    then (select v.educador_correo from pdt_visitas v where v.id = v_json->>'id_visita')
        when 'pdt_actividades' then (select v.educador_correo from pdt_visitas v where v.id = v_json->>'id_visita')
    end;

    if v_correo is not null then
        select valor into v_secreto from pdt_config_interno where clave = 'secreto_canal_realtime';

        for v_jefe in select correo from pdt_jefes_de(v_correo) loop
            perform realtime.send(
                jsonb_build_object('tabla', TG_TABLE_NAME, 'momento', now()),
                'cambio',
                'pdt_' || encode(digest(v_jefe.correo || v_secreto, 'sha256'), 'hex'),
                false
            );
        end loop;
    end if;

    return v_fila;
end;
$function$;

-- Postgres concede EXECUTE a PUBLIC por defecto a toda función nueva. Un `revoke ... from
-- anon, authenticated` sin `public` deja ese grant de PUBLIC intacto, del que ambos roles
-- siguen heredando acceso igual — es justo el hueco que dejó pasar la primera versión de esta
-- migración, encontrado por `get_advisors` después de aplicarla.
revoke all on function public.pdt_avisar_cambio() from public;

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_visitas;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_visitas
    for each row execute function public.pdt_avisar_cambio();

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_sectores;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_sectores
    for each row execute function public.pdt_avisar_cambio();

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_actividades;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_actividades
    for each row execute function public.pdt_avisar_cambio();

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_revisiones;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_revisiones
    for each row execute function public.pdt_avisar_cambio();

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_comentarios;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_comentarios
    for each row execute function public.pdt_avisar_cambio();

drop trigger if exists trg_pdt_avisar_cambio on public.pdt_eventos;
create trigger trg_pdt_avisar_cambio after insert or update or delete on public.pdt_eventos
    for each row execute function public.pdt_avisar_cambio();
