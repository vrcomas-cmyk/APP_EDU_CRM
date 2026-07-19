# APP_EDU_CRM — Gestor de Visitas

PWA para que los educadores registren sus visitas a clientes. Funciona offline y sincroniza
contra una hoja de Google vía Apps Script.

No hay build ni dependencias: es HTML + CSS + ES modules. Para verla en local basta con
servir la carpeta (`npm run dev` no aplica, no existe `package.json`):

```bash
python3 -m http.server 8080
```

En Codespaces, abre el puerto desde la pestaña **PORTS** (Live Server no funciona: corre
dentro del contenedor y el navegador está fuera).

## Flujo

El calendario **es** la pantalla; no hay router de vistas. Todo lo demás ocurre encima, en
niveles que se empujan: un drawer para la visita y su sector, y una ventana propia para cada
actividad y cada material.

```
Nueva visita → Agregar sector ⟲ (elegir → completar → guardar) → Guardar visita
                                                                       ↓
                       Check-in → Sector → Registrar actividad → Materiales
                                                 ↓
                                        Guardar actividad  (valida y sella)
                                                 ↓
                                         Evidencia (después) → Check-out
```

El ciclo de sectores se repite dentro de su propia ventana: al guardar uno se vuelve solo al
buscador para encadenar el siguiente, sin pasar por la pantalla de la visita.

La evidencia es obligatoria pero **no bloquea**: no se pide durante la captura y puede subirse
días después. El contador de la barra lleva lo que falta.

## Capturar, guardar, bloquear

La regla es la misma en los tres niveles: **nada existe hasta que alguien presiona Guardar**, y
después ya no se edita.

**La visita** nace como borrador y no aparece en el calendario ni se sincroniza hasta guardarse.
Fecha y horario llegan **vacíos** a propósito: un valor por defecto se acepta sin leerlo, y una
visita agendada en una fecha que nadie eligió es peor que un campo vacío. La única excepción es
arrastrar sobre el calendario, donde el gesto ya eligió el hueco. *Guardar visita* exige los
siete obligatorios —educador, cliente, hospital, fecha, hora de inicio, hora de término y al
menos un sector— y sella de paso sus sectores.

**El sector** exige objetivo, origen y solicitado por. Se corrige libremente mientras la visita
sea borrador; al guardarla queda en solo lectura y solo admite registrar actividades.

**La actividad** se autoguarda en cada tecla —perder lo escrito en un pasillo sin señal es el
peor error posible aquí— pero **no se sincroniza**, no suma a la salud de la visita y no genera
deuda de evidencia mientras siga siendo borrador.

Al presionar **Guardar** se validan los obligatorios y el registro se **sella** con quién,
cuándo y —en la actividad— desde qué dispositivo. A partir de ahí es un hecho histórico: el
formulario desaparece y quedan los datos en frío.

El único cambio permitido después del sello es **agregar evidencia**, porque no altera lo que
se afirmó: lo respalda. Para mover una visita está **Reagendar**, que deja historial.

Si hubo un error, la salida es registrar un registro nuevo — no reescribir la historia.

## Estructura

| Archivo | Qué hace |
|---|---|
| `js/app.js` | Arranque, sesión, atajos, sincronización, toasts |
| `js/permisos.js` | Rol, permisos por módulo/acción y alcance jerárquico |
| `js/datos.js` | Consulta única, filtros globales e indicadores; la costura para DuckDB/R2 |
| `src/modules/dashboard/` | Indicadores con filtros globales y desglose por educador |
| `js/revisiones.js` | Flujos de revisión: cola, estado vigente, historial |
| `src/modules/revision/` | Bandeja de revisión, una pestaña por flujo |
| `js/comentarios.js` | Comentarios inmutables sobre visita/sector/actividad/evidencia |
| `js/hilo.js` | Hilo de comentarios reutilizable |
| `js/vistaprevia.js` | Miniatura y visor de evidencias (imagen, PDF, video) |
| `js/storage.js` | localStorage (visitas/catálogo), IndexedDB (archivos), migraciones v1→v6 |
| `js/estado.js` | Ciclo de vida, salud del registro, solapes, los sellos (`estaGuardada`) |
| `js/visita.js` | Acciones de negocio: check-in/out, reagendar, cancelar |
| `src/modules/agenda/` | Vistas Día / Semana / Mes, arrastrar para crear y reagendar |
| `src/modules/visitas/` | Visita y sector: captura del borrador, panel de información, tarjetas de sector |
| `src/modules/sectores/` | Ventana del sector: elegir → completar → guardar, encadenando varios |
| `src/modules/actividades/` | Ventana de la actividad: borrador → validar → sellar → solo lectura |
| `js/materiales.js` | Ventana del material: buscador por sector, cantidad, unidad, origen |
| `js/campos.js` | Primitivas de formulario compartidas por las tres ventanas |
| `js/catalogos.js` | Configuración: qué campo pide cada tipo de actividad, y las listas |
| `src/modules/administracion/` | Pantalla de Administración; el rol de admin vive en Supabase |
| `js/evidencias.js` | Captura, compresión y cola de subida |
| `js/sync.js` | Cliente del Apps Script |
| `js/fechas.js` | Claves de día, semanas, meses |
| `apps-script/Codigo.gs` | Backend: catálogos, upsert en Sheets, Drive y espejo a Supabase |
| `supabase/migrations/` | Esquema de roles, permisos, jerarquía, invitaciones y espejo |

## Administración

Los formularios **no tienen lógica de campos escrita en el código**. Cada tipo de actividad
declara, campo por campo, uno de cuatro modos:

| Modo | Qué hace |
|---|---|
| `obligatorio` | Se pide y bloquea el guardado si falta |
| `opcional` | Se pide y se puede dejar vacío |
| `solo-lectura` | Se muestra si ya trae valor, pero no se captura |
| `oculto` | No aparece |

`js/catalogos.js` resuelve el modo efectivo en tres capas: el default del campo, las banderas
viejas `evidencia`/`materiales` del tipo, y lo configurado campo por campo. Una hoja que nunca
se actualice se comporta **exactamente como antes**; lo que se configure pisa a lo heredado.

Agregar un campo configurable nuevo es agregar una entrada a `CAMPOS_ACTIVIDAD`: la pantalla
de administración y el formulario de captura se dibujan recorriendo esa lista.

**Los sectores se curan, no se escriben.** Salen de la hoja de Materiales, que es de donde
salen también los materiales que se ofrecen dentro de cada sector; un sector escrito a mano
mostraría un buscador de materiales siempre vacío. Administración solo decide cuáles se
ofrecen, y se guarda la lista de **excluidos** para que un sector nuevo en Materiales nazca
disponible en vez de invisible.

## Roles y visibilidad

Ningún permiso está escrito en el código. La app pregunta `puede('visitas', 'exportar')` y la
respuesta sale de Supabase, de tablas con prefijo `pdt_`:

| Tabla | Qué guarda |
|---|---|
| `pdt_roles` | Los perfiles. Agregar uno **no** requiere tocar la aplicación |
| `pdt_permisos` | Un renglón por `(rol, módulo, acción)` permitido |
| `pdt_usuarios` | Quién es quién y con qué rol |
| `pdt_jerarquia` | Quién ve a quién. Muchos a muchos: alguien puede reportar a varios jefes |

`pdt_perfil(correo)` devuelve rol, permisos y alcance en una sola llamada — tres consultas
darían tres estados de carga distintos en pantalla. El **alcance** lo resuelve Postgres con un
recorrido recursivo (`pdt_alcance`), no el cliente: calcularlo aquí exigiría bajarse el
organigrama completo, que es justo lo que no debe salir.

**La ausencia de permiso es la negación.** No hay lista de denegados: con dos listas, "¿y si
está en ambas?" no tiene respuesta obvia, y las respuestas no obvias en control de acceso
terminan en fugas.

**El alcance se aplica en `datos.js`**, no en cada pantalla. Una pantalla nueva que lo olvidara
seguiría funcionando —solo que mostrando de más— y eso no se ve al probarla.

Sin red y sin caché, el perfil cae a **educador**: es el menor privilegio que todavía permite
capturar. Un educador en un pasillo sin señal tiene que poder registrar su visita; lo que no
puede es ver la de alguien más.

> ⚠ El proyecto de Supabase está **compartido con otras aplicaciones** (CRM, MSC, portal,
> tasks…). Todo lo de Plan de Trabajo lleva prefijo `pdt_` y las migraciones son aditivas.
> La migración vive en `supabase/migrations/`.

## Acceso por invitación

Nadie entra sin estar en `pdt_invitaciones`. Para invitar a alguien:

```sql
insert into pdt_invitaciones (correo, nombre, rol, invitado_por)
values ('nuevo@degasa.com', 'Nombre Apellido', 'educador', 'tu@degasa.com');
```

Y para quitarle el acceso, `update pdt_invitaciones set estado = 'revocada' where correo = …`
— surte efecto en el siguiente refresco de perfil, sin esperar a que la persona recargue.

El estado de invitación tiene **tres** valores, no dos:

| Valor | Qué pasa |
|---|---|
| `true` | Entra |
| `false` | Se le cierra la puerta con una pantalla que lo explica |
| `null` | Todavía no se pudo preguntar (sin red) — **no bloquea** |

Colapsar `null` en `false` convertiría cada bache de señal en un educador que no puede
trabajar; colapsarlo en `true` haría el control decorativo. Por eso solo se bloquea ante un
**no explícito** del servidor.

Los administradores que ya existían en `pdt_admins` quedaron invitados automáticamente: la
regla nueva no puede dejar fuera a quien ya tenía acceso.

## Espejo de lectura

Las visitas se **espejean** a Supabase al sincronizar, para que un gerente pueda ver a su
equipo. Sheets sigue recibiendo todo exactamente igual: el espejo es un extra y si se borrara
entero, no se pierde un solo dato.

```
PWA ──escribe──▶ Apps Script ──▶ Sheets        (fuente operativa, intacta)
                             └──▶ Supabase     (espejo)
PWA ──lee equipo──▶ Apps Script ──▶ Supabase   (recortado por jerarquía)
```

**Por qué la lectura pasa por Apps Script y no va directo a Supabase.** La PWA solo tiene la
clave anónima, que es **pública** — viaja en su propio JavaScript. Con ella, cualquiera podría
pedir las visitas de cualquier correo. Apps Script ya verifica el `id_token` de Google contra
el `CLIENT_ID` y el dominio, así que ahí el correo sí es de fiar. Las tablas del espejo tienen
RLS activo y **cero políticas**: para la clave anónima no existen.

Solo lo **sellado** cruza al espejo. Un borrador no es un hecho todavía, y contarlo en un
indicador afirmaría trabajo que aún no se termina.

### Para activarlo

En el editor de Apps Script: **Configuración del proyecto → Propiedades del script → Agregar**

| Propiedad | Valor |
|---|---|
| `SUPABASE_SERVICE_KEY` | La *service_role secret* de Supabase (Settings → API) |

Sin esa propiedad el espejo simplemente no se escribe y **todo lo demás sigue funcionando**
igual que antes contra Sheets. Es opcional por diseño.

> ⚠ El `service_role` salta las políticas de seguridad por fila. Va en Apps Script, cuyo
> código nadie ve — nunca en la PWA.

### Permisos de ejecución (no obvio, y muerde)

`security definer` **no** implica acceso restringido: Postgres da `EXECUTE` a `PUBLIC` por
defecto. Una función así queda llamable con la clave anónima, que es pública. Por eso la
migración **revoca** explícitamente:

| Función | Quién puede ejecutarla |
|---|---|
| `pdt_espejo_guardar` | solo `service_role` (si no, cualquiera escribe visitas falsas) |
| `pdt_visitas_en_alcance` | solo `service_role` (si no, cualquiera lee cualquier equipo) |
| `pdt_alcance` | solo `service_role` |
| `pdt_revisiones_en_alcance`, `pdt_revision_guardar`, `pdt_flujos_activos` | solo `service_role` |
| `pdt_perfil`, `pdt_aceptar_invitacion` | `anon` — la PWA las llama al arrancar |

Las dos últimas exponen el rol y la lista de subordinados de un correo: el organigrama, no
datos de visitas. Es una fuga menor y consciente, el precio de que la puerta de invitación
funcione antes de cualquier sincronización. Para cerrarla habría que enrutar también el
perfil por Apps Script, a cambio de más latencia en el arranque.

## Datos de muestra

Hay un equipo de prueba cargado para poder ver los dashboards con algo dentro: una gerente,
tres educadores, un analista y **51 visitas** repartidas en las últimas seis semanas y las
próximas dos, con sectores, actividades, materiales y ~23 evidencias pendientes.

Todo lleva `demo = true` y correos `@demo.degasa.com`. Para borrarlo cuando ya no sirva:

```sql
delete from pdt_visitas where demo;                       -- arrastra sectores/actividades/materiales
delete from pdt_invitaciones where demo;
delete from pdt_jerarquia   where jefe like '%@demo.degasa.com';
delete from pdt_usuarios    where correo like '%@demo.degasa.com';
```

## Módulo de revisión

Cada flujo de revisión es **independiente**. Quien revisa que la foto se vea bien no es quien
juzga si la visita valió la pena, ni quien evalúa si el retraso estuvo justificado. Con una
sola aprobación global esas tres personas se pisan: la primera en llegar cierra el registro, o
peor, una "rechaza" y borra el visto bueno de otra sobre algo distinto.

Por eso el estado **no vive en la visita**: vive en la pareja *(flujo, elemento)*.

Los cinco flujos vienen de `pdt_flujos_revision` — agregar uno no requiere tocar código:

| Flujo | Ámbito | Permiso requerido |
|---|---|---|
| Evidencias | actividad | `evidencias.aprobar` |
| Calidad de la visita | visita | `visitas.calificar` |
| Justificación de retrasos | visita | `visitas.revisar` |
| Cumplimiento de actividades | visita | `actividades.revisar` |
| Calidad de la documentación | actividad | `actividades.calificar` |

Cada persona solo ve las pestañas de los flujos en los que tiene permiso.

### Qué entra a la cola

Un elemento está pendiente si **nunca se revisó** en ese flujo o si su última revisión pidió
**corrección**. `Rechazado` no vuelve a la cola: ya se decidió, y reaparecer obligaría a
rechazar lo mismo cada vez.

No todo es revisable siempre. Una visita cancelada no ocurrió; una programada aún no tiene
qué juzgar; una evidencia sin archivo cargado es deuda del educador, no trabajo del revisor.
Esa es la única lógica del módulo que vive en código, porque depende de la forma del árbol y
no de una preferencia.

### Append-only

Una revisión no se edita ni se borra. El estado vigente es la **más reciente**; las anteriores
se conservan porque son las que cuentan la historia — `rechazado → corregido → aprobado` dice
algo que `aprobado` solo, no.

El revisor lo impone el servidor con la identidad verificada: lo que el cliente ponga en ese
campo se ignora. Sin eso, cualquiera podría firmar una aprobación a nombre de su jefe.

Rechazar o pedir corrección **exige observaciones**. Un rechazo sin explicación deja al
educador sin nada que hacer.

## Arquitectura y migración futura

`js/datos.js` es la costura. Toda consulta de la app pasa por `consultarVisitas(filtro)`, que
junta *fuentes* registradas. Hoy solo hay una (localStorage); mañana se enchufa Supabase con
`registrarFuente('supabase', …)` y **ninguna pantalla se entera**.

```
HOY      PWA ──escribe──▶ Apps Script ──▶ Sheets   (capa operativa)
                       └─▶ Drive                   (evidencias)
         PWA ──lee──▶ localStorage
         PWA ──lee──▶ Supabase                     (rol, permisos, jerarquía)

DESPUÉS  + Supabase como espejo de lectura (equipo)
         + DuckDB para agregados masivos
         + Cloudflare R2 para archivos
```

**Google Sheets, Drive y Apps Script no se sustituyen.** Siguen siendo la capa operativa y de
integración mientras no se defina explícitamente lo contrario; lo nuevo se suma, no reemplaza.

Dos detalles pensados para esa migración:

- `calcularIndicadores` recorre las visitas **una sola vez** y devuelve un objeto plano de
  contadores. Trece funciones sueltas serían trece recorridos, y esta forma se traduce directo
  a un `SELECT` con agregados cuando el cálculo se mueva a DuckDB.
- `urlEvidencia` es el único lugar que sabe dónde vive un archivo. El día que sea R2 en vez de
  Drive, cambia esa función y nada más.

## Comentarios

Un comentario nunca se edita ni se borra: si alguien se equivocó, escribe otro. Cuelgan de
visitas, sectores, actividades y evidencias, y cada uno guarda su hospital y su cliente —
desnormalizar ahí es deliberado, es lo que permite responder "¿qué se ha dicho de este
hospital?" sin recorrer el árbol de todas las visitas.

Eso alimenta los **comentarios históricos**: al programar una visita se muestran las
observaciones previas de ese hospital. Es contexto que hoy se pierde entre visitas, porque lo
escribe quien fue en marzo y lo necesita quien va en julio.

## Backend (Apps Script)

`apps-script/Codigo.gs` **no se despliega solo**. Hay que pegarlo en el editor de Apps Script
de la hoja y publicarlo como aplicación web con acceso **"Cualquier persona"** (las
instrucciones están en el encabezado del archivo).

Escribe en dos pestañas:

- **`Visitas`** (padre): una fila por cada visita × sector, con su objetivo y estado.
- **`Actividades`** (hija): una fila por actividad, ligada por `id_padre`, con la URL de su
  evidencia en Drive.

Todas las escrituras son **upsert por id**: la app reenvía la misma visita cada vez que se
edita, así que insertar a ciegas duplicaría filas.

Los catálogos se leen de **otro documento** (`SHEET_DB_ID`), no del de las visitas: clientes de
`Clientes`, educadores de `Educadores`, y los sectores de `Materiales` → `Descr. Sector`
deduplicados (no hay pestaña "Sectores").

Las pestañas de configuración las **crea Administración sola** la primera vez que guarda; si no
existen, la PWA usa sus valores por defecto y todo funciona igual:

| Pestaña | Columnas | Para qué |
|---|---|---|
| `TiposActividad` | `tipo, evidencia, materiales, folio, gerente` | Los tipos y sus banderas heredadas |
| `CamposActividad` | `tipo, campo, modo` | Un renglón por campo: la matriz que arma los formularios |
| `Origenes` | `origen` | Origen de la actividad del sector |
| `Areas` | `area` | Opciones de "Área visitada" |
| `Unidades` | `unidad` | Unidades de medida de los materiales |
| `TiposEvidencia` | `tipo_evidencia` | Solo se usa si algún tipo muestra ese campo |
| `SectoresOcultos` | `sector` | Sectores que **no** se ofrecen al agendar |
| `Admins` | `correo` | Respaldo del rol de admin (la fuente es Supabase) |

Y una pestaña más de captura, `Comentarios`, que se escribe en modo **append** (nunca upsert):
un comentario que se puede reescribir deja de servir para reconstruir una conversación.

`CamposActividad` se guarda como un renglón por par (tipo, campo) y no como JSON en una celda,
para que siga siendo legible y editable a mano desde la hoja, como el resto de los catálogos.

El manifiesto (`apps-script/appsscript.json`) declara los permisos y **debe copiarse también**:
Apps Script no amplía los scopes solo porque el código cambie, así que reautorizar sin tocarlo
vuelve a conceder el mismo permiso insuficiente y la subida sigue fallando con *"No cuentas con
el permiso para llamar a DriveApp.Folder.createFile"*.

Las evidencias usan **`drive.file`**: el script solo alcanza los archivos que él mismo crea, no
el resto del Drive. Se archivan así:

```
Evidencias/                        ← carpeta del usuario (el script NO la ve)
    Evidencias Visitas/            ← la crea el script; se mueve aquí a mano, una sola vez
        100000 HOSPITAL X/         ← una por cliente, automáticas
            foto.jpg
```

Consecuencias del scope, que explican el diseño:

- **No puede escribir en una carpeta creada a mano**, de ahí el paso de mover la suya. Al
  moverla el id no cambia, así que no pierde el acceso. Dejarla en *Mi unidad*: en una unidad
  compartida puede perderla.
- **No se puede buscar por nombre en el Drive** (`getFoldersByName` no ve nada). Por eso los ids
  de la raíz y de cada cliente viven en las propiedades del script: sin ellos se crearía una
  carpeta nueva en cada subida.
- La PWA **manda el `cliente`** en el POST de la evidencia. No se deduce de la hoja porque la
  fila puede no existir todavía (la evidencia puede subirse antes de sincronizar la visita).

Corre `autorizar()` desde el editor para verificarlo: crea un archivo de prueba real, porque un
permiso de solo lectura alcanza para *encontrar* la carpeta pero no para escribir en ella.

## Cuidado con

- **`sw.js`**: sube `CACHE_NAME` cada vez que cambies un archivo de `ASSETS`. Si no, los
  navegadores que ya instalaron el Service Worker siguen sirviendo la versión vieja y los
  cambios "no aparecen".
- **`Content-Type: text/plain`** en los POST: es a propósito. Evita el preflight OPTIONS, que
  Apps Script no responde. Cambiarlo a `application/json` rompe la sincronización.
- **Fechas**: las claves de día se sacan cortando la cadena, no con `toISOString()`, que
  convierte a UTC y correría de día una visita de la tarde.
