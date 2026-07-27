-- Plan de Trabajo — capacidad del módulo nuevo "Actividades" (el reporte).
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.

insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('reporte_actividades.ver', 'reporte_actividades', 'ver', 'Ver Actividades (reporte)',
     'Entrar al reporte de Actividades: peso por sector/actividad y desglose mensual. '
     'Del EQUIPO, solo se ve lo de los sectores que tenga asignados en Accesos → Sectores '
     '— lo propio siempre se ve, en cualquier sector.',
     'Reporte de actividades', 1000)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

-- Semilla: administrador y gerente lo ven de entrada (es a quien está pensado el reporte);
-- el resto, el admin lo asigna desde Accesos → Roles si hace falta.
insert into pdt_permisos (rol, modulo, accion) values
    ('administrador', 'reporte_actividades', 'ver'),
    ('gerente', 'reporte_actividades', 'ver')
on conflict (rol, modulo, accion) do nothing;
