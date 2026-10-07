# Importar AppSheet → hoja de revisión → Supabase

Mientras los educadores migran poco a poco, AppSheet sigue en uso. `ImportarAppSheet.gs` trae sus
datos, los transforma al modelo de la app y los deja en pestañas **AS_*** de la hoja donde la app
ya guarda sus registros (`SHEET_VISITAS_ID`). **Nada llega a Supabase sin que una persona lo
apruebe.**

## Puesta en marcha (una vez)

1. Pega `ImportarAppSheet.gs` como archivo nuevo en el proyecto de Apps Script (junto a `Codigo.gs`)
   y actualiza `appsscript.json` (se agregó el permiso `script.scriptapp` para poder instalar el
   trigger). Al guardar, Apps Script pedirá autorizar de nuevo con la cuenta que despliega.
2. Comparte las dos hojas de AppSheet (Plan de trabajo y Actividades) con esa cuenta, aunque sea
   como lectura.
3. En **Configuración del proyecto → Propiedades del script** crea `APPSHEET_ID_PLAN` y pega el
   **enlace completo** de la hoja de Plan de trabajo (o su id). `APPSHEET_ID_ACTIVIDADES` hace lo
   mismo para la de Actividades (ya viene con un valor que funciona).
4. Ejecuta **`appsheetVerificarAcceso`** desde el editor: dice si el script abre las hojas y encuentra
   las pestañas (`Plan de trabajo`, `PT_Sectores`, `Actividades_Reg`, `Actividades_Materiales`).
5. Aplica en Supabase `20261007_pdt_fechas_registro.sql` y `20261009_pdt_appsheet_importar.sql`
   (esta última necesita la anterior).

## El ciclo

| Paso | Quién | Qué |
|---|---|---|
| 1 | script | **`appsheetTransformar`** lee AppSheet, transforma y escribe/actualiza las pestañas AS_*. No toca Supabase. Seguro de repetir. Se puede dejar corriendo cada hora con **`appsheetInstalarTrigger`**. |
| 2 | persona | Revisa `AS_Visitas` (y sus hijas), corrige lo que haga falta y cambia `import_estado` a `aprobada` o `descartada`. |
| 3 | script | **`appsheetSubirAprobadas`** sube solo lo `aprobada`. Se guarda con la misma función que la app, así que se ve como lo capturado en la app (calendario, cálculos, revisiones) y se encola para las pestañas normales. |

Atajo para después de revisar: **`appsheetAprobarLasLimpias`** aprueba toda visita `pendiente` sin notas.

## Las pestañas

- **AS_Visitas** (una por visita), **AS_Sectores**, **AS_Actividades**, **AS_Materiales**: el modelo de
  la app. Cada renglón trae `src_json` con TODAS las columnas de origen, `import_notas` con lo que
  conviene mirar y `import_estado`.
- **AS_Problemas**: lo que no se pudo enlazar (sectores sin visita, materiales sin actividad…).
  **AS_Resumen**: cifras de la última corrida.
- **AS_Alias** (tipo | original | valor): nombres de AppSheet que no se reconocieron. Escribe en `valor`
  a qué corresponden y la siguiente corrida lo usa. Los sectores `Catálogo completo`, los tipos
  `Mercancia sin cargo`, `Donativo`, `Congreso/Eventos`… aparecen aquí.
- **AS_Corte** (correo | importar_hasta): ver abajo.

## Estados (`import_estado`)

`pendiente` por revisar · `con_error` le falta algo que la app exige (correo, fecha, cliente) ·
`sin_visita` actividad cuya visita no está en el plan · `omitida_corte` el educador ya capturó en la
app · **`aprobada` es la única que sube** · `subida` · `descartada` (nunca se toca).

Una corrida nueva **no pisa tu trabajo**: lo que no cambió en AppSheet queda exactamente como lo
dejaste. Lo que sí cambió allá, aunque estuviera aprobado o subido, vuelve a `pendiente` con una
nota para revisarlo otra vez.

## Migración de usuarios, poco a poco

En `AS_Corte` pon el correo del educador y la fecha hasta la que se importa (inclusive). De ese
educador se importa solo lo anterior a esa fecha; lo posterior queda `omitida_corte`. Así nunca se
duplica una visita capturada en las dos aplicaciones. Sin renglón se importa todo.

## Cómo se transforma (lo que conviene saber al revisar)

- **Reagendadas.** AppSheet crea una visita nueva al reagendar. Aquí la visita reagendada deja de
  ser una visita aparte: se une a la que la sustituyó (`reagendas` cuenta cuántas veces se movió).
  Una reagendada **sin** visita nueva se importa como `cancelada`, con nota.
- **Estado.** `Completo` → finalizada · `Pendiente` → programada · `Cancelado` → cancelada.
- **Visitas "abiertas".** Para la app, una visita con llegada y sin salida está abierta, y mientras haya
  una el educador no puede iniciar otra. En AppSheet hay cientos viejas así: se importan **sin
  check-in** (con nota). Solo una de hoy se queda en proceso.
- **Sectores.** AppSheet y la app comparten los nombres de 20 caracteres (`ALGODÓN Y APLICADORE`). Los
  que no se reconocen se conservan y se piden en `AS_Alias`.
- **Evidencia.** Si AppSheet ya tiene el archivo se marca `subida` (no es deuda), aunque no haya un
  enlace de Drive para verla desde la app (queda la ruta en `evidencia_ruta`). Sin archivo, `pendiente`.
- **Fecha del documento.** Los números de serie (`46122`) se convierten a fecha.
- **Materiales.** El origen es el `Folio`. Los renglones vacíos que AppSheet crea por sector no son
  materiales y no se importan. Un origen que no cumple las reglas (6 dígitos / 3 caracteres) se
  importa con nota.
- **Zona y ejecutivo** salen del catálogo de clientes de la app.

## ¿Por qué hay menos registros que en AppSheet? (conciliación)

La pestaña **AS_Resumen** cuenta, de cada hoja de AppSheet, cuántos renglones había, cuántos entraron
y por qué salieron los demás; las filas `cuadra_*` dicen si la cuenta cierra. Lo normal:

| En AppSheet | Aquí | Por qué hay menos |
|---|---|---|
| Plan de trabajo | `AS_Visitas` | Una visita **reagendada** ya no es una visita aparte: se une a la que la sustituyó (`reagendadas_unidas`). |
| PT_Sectores | `AS_Sectores` | Se une el mismo sector repetido en una visita (`sectores_repetidos_en_visita`, casi siempre el de una visita reagendada) y se descartan los sectores de visitas que no están en el plan (`sectores_sin_visita`, detalle en `AS_Problemas`). |
| Actividades_Reg | `AS_Actividades` | Deben coincidir. Las de visita no encontrada entran como `sin_visita` pero no suben. |
| Actividades_Materiales | `AS_Materiales` | AppSheet crea un renglón por sector aunque no se haya entregado nada (`materiales_vacios`): no son materiales. |

Con la exportación de octubre: 4,478 renglones de plan → 3,601 visitas + 877 reagendadas unidas;
5,138 de sectores → 4,127 + 932 repetidos + 79 sin visita; 2,904 de materiales → 839 + 2,054 vacíos
+ 11 sin actividad. Si tus cifras no cuadran con `AS_Resumen`, revisa también que el filtro de la
pestaña no oculte renglones y que `import_estado` no esté en `descartada` o `omitida_corte`.

## Lo que queda fuera por ahora

Las revisiones de AppSheet (`Estado revisión PT`, `Efectividad`…) viajan completas en `src_json` y en
las columnas `estado_revision_pt` / `efectividad`, pero todavía no se convierten en revisiones de la
app. Tampoco los comentarios ni los contactos.
