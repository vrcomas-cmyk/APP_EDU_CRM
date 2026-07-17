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

La visita se captura en dos momentos:

1. **Agendar** (pestaña *Agendar*): cliente, fecha/hora y qué sectores —líneas de producto—
   se van a trabajar, con el **objetivo** de cada uno.
2. **Ejecutar** (al llegar con el cliente, entrando a la visita desde la agenda): se registran
   las **actividades** hechas. Un sector puede tener varias, y cada una lleva su **evidencia**
   (imagen o PDF).

La evidencia es obligatoria pero **no bloquea**: puede subirse días después desde la pestaña
*Evidencias*, que lleva el contador de lo que falta.

## Estructura

| Archivo | Qué hace |
|---|---|
| `js/app.js` | Arranque, navegación por hash, sincronización |
| `js/storage.js` | localStorage (visitas/catálogo), IndexedDB (archivos), migración |
| `js/sync.js` | Cliente del Apps Script |
| `js/fechas.js` | Claves de día, semanas, meses, orden de la agenda |
| `js/sectores.js` | Selector de sectores por chips (formulario de agendar) |
| `js/agenda.js` | Lista agrupada por día |
| `js/calendario.js` | Vistas Día / Semana / Mes |
| `js/detalle.js` | Vista de ejecución (actividades por sector) |
| `js/evidencias.js` | Captura, compresión, cola de subida, bandeja |
| `apps-script/Codigo.gs` | Backend: catálogos, upsert en Sheets, subida a Drive |

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
