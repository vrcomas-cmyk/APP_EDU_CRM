-- Plan de Trabajo — capacidad propia para la nueva área de Administración "Estrategias"
-- (catálogos de Tipos de estrategia y Etapas).
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- `estrategias.ver` YA EXISTE (`20260727c_pdt_capacidades_modulos.sql`) y significa "puede
-- entrar al módulo Estrategias" — lo tiene hasta un Educador de serie. La nueva área de
-- Administración necesitaba su propio id de área en la pantalla y por poco reusa ese mismo
-- nombre: de haberlo hecho, cualquier Educador con el piso por defecto habría visto (y con
-- `puede()` cayendo en el bypass de admin, potencialmente guardado) el catálogo de Tipos de
-- estrategia/Etapas, que solo un administrador completo debe poder tocar. Se le da una
-- capacidad separada, igual que Catálogos/Accesos/Flujos/Territorios.

insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('estrategia_admin.ver', 'estrategia_admin', 'ver', 'Ver Estrategias (Administración)',
     'Entrar al área de Tipos de estrategia y Etapas dentro de Administración, en solo
      lectura. Guardar cambios ahí sigue exigiendo administrador completo — no tiene relación
      con "estrategias.ver", que es lo que deja entrar al módulo Estrategias.',
     'Administración', 645)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

-- Semilla: solo el rol administrador la trae de serie, igual que las otras áreas de
-- Administración (Catálogos/Accesos/Flujos/Territorios) — no es un candado, se ajusta desde
-- Administración → Accesos → Roles cuando se quiera.
insert into pdt_permisos (rol, modulo, accion) values
    ('administrador', 'estrategia_admin', 'ver')
on conflict (rol, modulo, accion) do nothing;
