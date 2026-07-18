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
| `js/storage.js` | localStorage (visitas/catálogo), IndexedDB (archivos), migraciones v1→v6 |
| `js/estado.js` | Ciclo de vida, salud del registro, solapes, los sellos (`estaGuardada`) |
| `js/visita.js` | Acciones de negocio: check-in/out, reagendar, cancelar |
| `js/calendario.js` | Vistas Día / Semana / Mes, arrastrar para crear y reagendar |
| `js/drawer.js` | Visita y sector: captura del borrador, panel de información, tarjetas de sector |
| `js/sector.js` | Ventana del sector: elegir → completar → guardar, encadenando varios |
| `js/actividad.js` | Ventana de la actividad: borrador → validar → sellar → solo lectura |
| `js/materiales.js` | Ventana del material: buscador por sector, cantidad, unidad, origen |
| `js/campos.js` | Primitivas de formulario compartidas por las tres ventanas |
| `js/catalogos.js` | Configuración: qué campo pide cada tipo de actividad, y las listas |
| `js/admin.js` | Pantalla de Administración; el rol de admin vive en Supabase |
| `js/evidencias.js` | Captura, compresión y cola de subida |
| `js/sync.js` | Cliente del Apps Script |
| `js/fechas.js` | Claves de día, semanas, meses |
| `apps-script/Codigo.gs` | Backend: catálogos, upsert en Sheets, subida a Drive |

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
