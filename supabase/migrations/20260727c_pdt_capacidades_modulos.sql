-- Plan de Trabajo — quién ve qué módulo.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- Hasta hoy, casi todos los módulos del riel reusaban un permiso de OTRO módulo para decidir
-- si se mostraban ("Mi día" e "Indicadores" compartían `dashboards.personal`; "Administración"
-- ni siquiera pasaba por `puede()`, estaba fijo a `esAdministrador()`). Eso hacía imposible
-- que un administrador decidiera, por ejemplo, que alguien vea Indicadores pero no Mi día, o
-- que alguien vea Catálogos de Administración sin ver Accesos.
--
-- Cada módulo (y, dentro de Administración, cada una de sus 4 áreas ya existentes en la
-- pantalla) recibe su propia capacidad `modulo.ver`. Es SOLO de visibilidad —entrar o no
-- entrar—; no delega la capacidad de guardar cambios dentro de Administración, que sigue
-- exigiendo administrador completo del lado del servidor (`pdt_exige_admin`) exactamente
-- igual que hoy.
--
-- Calendario se queda SIN capacidad propia a propósito: es la pantalla de trabajo con la que
-- arranca la app, y así lo declara ya `modulos.ts` ("Sin condición: quien entra a la app viene
-- a esto"). No hay caso de uso hoy para ocultársela a alguien que ya entró.

insert into pdt_capacidades (clave, modulo, accion, nombre, descripcion, grupo, orden) values
    ('mi_dia.ver', 'mi_dia', 'ver', 'Ver "Mi día"',
     'Entrar al resumen del día: la agenda de hoy y qué falta por registrar.', 'Mi día', 700),

    ('estrategias.ver', 'estrategias', 'ver', 'Ver Estrategias',
     'Entrar a Cliente × Sector × Grupo de Artículo: qué se planea trabajar y con quién.',
     'Estrategias', 800),

    ('indicadores.ver', 'indicadores', 'ver', 'Ver Indicadores',
     'Entrar al tablero de indicadores. Qué se ve DENTRO (solo lo propio, el equipo, o todo)
      lo sigue decidiendo `dashboards.*`, como hoy.', 'Indicadores', 505),

    ('revision.ver', 'revision', 'ver', 'Ver Revisión',
     'Entrar a la bandeja de revisión. Sigue exigiendo también `visitas.consultar`: sin eso
      la bandeja está garantizadamente vacía.', 'Revisión', 900),

    ('catalogos.ver', 'catalogos', 'ver', 'Ver Catálogos (Administración)',
     'Entrar al área de Catálogos dentro de Administración. No concede guardar cambios ahí:
      eso lo sigue exigiendo el servidor solo a un administrador completo.',
     'Administración', 620),
    ('accesos.ver', 'accesos', 'ver', 'Ver Accesos (Administración)',
     'Entrar al área de Roles, Usuarios y Jerarquía dentro de Administración, en solo
      lectura. Guardar cambios ahí sigue exigiendo administrador completo.',
     'Administración', 630),
    ('flujos.ver', 'flujos', 'ver', 'Ver Flujos (Administración)',
     'Entrar al área de Flujos de revisión dentro de Administración, en solo lectura.',
     'Administración', 640),
    ('territorios.ver', 'territorios', 'ver', 'Ver Territorios (Administración)',
     'Entrar al área de Territorios dentro de Administración, en solo lectura.',
     'Administración', 650)
on conflict (clave) do update
    set nombre = excluded.nombre,
        descripcion = excluded.descripcion,
        grupo = excluded.grupo,
        orden = excluded.orden;

-- ---------- semilla por rol ----------
--
-- Se conserva lo que cada rol ya podía ver hoy, EXCEPTO Educador: el pedido explícito fue que
-- Educador vea solo Estrategias, Mi día y Calendario —Calendario no necesita fila, ya es
-- incondicional—, así que se le retira deliberadamente Indicadores y Revisión, que antes
-- heredaba sin querer de `dashboards.personal`/`visitas.consultar`.
--
-- Es semilla, no un candado: el administrador ajusta cada casilla desde Administración →
-- Accesos → Roles cuando quiera, exactamente como ya hace con el resto de las capacidades.
insert into pdt_permisos (rol, modulo, accion) values
    ('administrador', 'mi_dia', 'ver'), ('administrador', 'estrategias', 'ver'),
    ('administrador', 'indicadores', 'ver'), ('administrador', 'revision', 'ver'),
    ('administrador', 'catalogos', 'ver'), ('administrador', 'accesos', 'ver'),
    ('administrador', 'flujos', 'ver'), ('administrador', 'territorios', 'ver'),

    ('gerente', 'mi_dia', 'ver'), ('gerente', 'estrategias', 'ver'),
    ('gerente', 'indicadores', 'ver'), ('gerente', 'revision', 'ver'),

    ('analista', 'mi_dia', 'ver'), ('analista', 'indicadores', 'ver'),
    ('analista', 'revision', 'ver'),

    ('educador', 'mi_dia', 'ver'), ('educador', 'estrategias', 'ver')
on conflict (rol, modulo, accion) do nothing;
