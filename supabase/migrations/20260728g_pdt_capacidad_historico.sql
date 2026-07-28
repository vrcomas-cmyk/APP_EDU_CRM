-- Plan de Trabajo — capacidad del módulo nuevo "Histórico" (Registro Actividades / Registro
-- Plan de Trabajo pre-AppSheet, ver 20260728f_pdt_historico_educadores.sql).
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.

insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('historico.ver', 'historico', 'ver', 'Ver Histórico (pre-AppSheet)',
     'Consultar el histórico de actividades y plan de trabajo de antes de esta app '
     '(Excel "Registro Actividades"/"Registro Plan de Trabajo"). Solo lectura. Quien no sea '
     'administrador ve únicamente su propio histórico.',
     'Histórico', 1100)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

insert into pdt_permisos (rol, modulo, accion) values
    ('administrador', 'historico', 'ver'),
    ('gerente', 'historico', 'ver')
on conflict (rol, modulo, accion) do nothing;
