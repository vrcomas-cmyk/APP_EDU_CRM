-- Avisos al educador por comentarios de su jefe o de quien revisa.
--
-- Hasta hoy el educador solo se enteraba de lo que decía un VEREDICTO de revisión
-- (`pdt_avisos_de_revision`). Un comentario suelto sobre su visita, sector, actividad o
-- evidencia quedaba escrito pero sin avisar a nadie.
--
-- Regla: cuando alguien que NO es el educador comenta una visita, y esa persona tiene gente a su
-- cargo (aparece como `jefe` en pdt_jerarquia) o puede ver revisiones (`revision.ver`), el
-- educador responsable de la visita recibe un aviso en su bandeja de Avisos. El comentario que
-- alguien se escribe a sí mismo, o el de un colega sin rol de jefe ni de revisor, no avisa.
--
-- No toca pdt_avisos ni pdt_comentarios: solo agrega un trigger. Se puede revertir con
--   drop trigger trg_pdt_avisos_de_comentario on pdt_comentarios;
--   drop function pdt_avisos_de_comentario();

create or replace function pdt_avisos_de_comentario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_autor   text := lower(new.usuario_correo);
    v_visita  record;
    v_dueno   text;
    v_donde   text;
begin
    if new.id_visita is null then
        return new;
    end if;

    select v.educador_correo, v.cliente, v.hospital, v.dia
      into v_visita
      from pdt_visitas v
     where v.id = new.id_visita;

    if not found or v_visita.educador_correo is null then
        return new;
    end if;

    v_dueno := lower(v_visita.educador_correo);

    -- Nadie necesita un aviso de lo que comentó él mismo en su propia visita.
    if v_dueno = v_autor then
        return new;
    end if;

    -- Solo avisa quien tiene gente a su cargo o puede revisar.
    if not (
        exists (select 1 from pdt_jerarquia j where lower(j.jefe) = v_autor)
        or pdt_puede(v_autor, 'revision.ver')
    ) then
        return new;
    end if;

    v_donde := case new.ambito
        when 'sector'     then 'un sector'
        when 'actividad'  then 'una actividad'
        when 'evidencia'  then 'una evidencia'
        else 'la visita'
    end;

    insert into pdt_avisos (
        id, tipo, destinatario_correo, ambito, id_ambito, id_visita, resultado,
        etiqueta, titulo, detalle, cliente, hospital, dia_visita, revisor, revisor_correo
    ) values (
        'avc-' || new.id, 'comentario', v_dueno, new.ambito, new.id_ambito, new.id_visita, 'comentario',
        'Comentario',
        'Comentario sobre ' || v_donde,
        new.texto,
        v_visita.cliente, v_visita.hospital, v_visita.dia,
        coalesce(new.usuario, v_autor), v_autor
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

revoke execute on function pdt_avisos_de_comentario() from public, anon, authenticated;

drop trigger if exists trg_pdt_avisos_de_comentario on pdt_comentarios;
create trigger trg_pdt_avisos_de_comentario
    after insert on pdt_comentarios
    for each row execute function pdt_avisos_de_comentario();
