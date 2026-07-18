# Arquitectura — Iteración 01.6

Documento vivo. Describe hacia dónde va la reorganización y, sobre todo, **qué sigue igual**,
porque durante la migración conviven dos formas de escribir la misma app.

## Estado actual: migración progresiva, no reescritura

La app funciona **en cada commit**. No hay un "día del cambio" en el que todo se sustituye.

```
js/*.js          ← la app que corre hoy. Vanilla, intacta, sigue siendo la fuente de verdad.
src/             ← la arquitectura nueva. Crece módulo a módulo.
```

Vite consume los módulos ES actuales sin modificarlos, así que el paquete que se construye hoy
es la misma aplicación de siempre. Lo que se va moviendo a `src/` deja de existir en `js/`; lo
que todavía no se movió, sigue funcionando donde está.

> **Cambio de despliegue.** Al introducir el build, el artefacto ya no es la raíz del
> repositorio sino `dist/`. Servir los archivos sueltos como antes deja de funcionar en cuanto
> un módulo de `js/` importe algo de `src/`. Ese paso todavía no se ha dado.

## Capas, de adentro hacia afuera

Las dependencias apuntan **siempre hacia adentro**. Un módulo de dominio nunca importa un
componente; un componente nunca importa `fetch`.

```
core/        tipos y reglas que no dependen de nada
   ↑
modules/     un dominio cada uno: visitas, sectores, evidencias, revisiones…
   ↑
services/    la única frontera con el exterior
   ↑
app/         arranque, providers, rutas
```

### `core/`

`tipos.ts` describe **lo que ya se guarda**, no un modelo ideal. Casi todo es opcional a
propósito: hay visitas capturadas hace meses, en versiones anteriores del modelo, sin contacto
ni sello ni correo. Marcar esos campos como obligatorios describiría la app que nos gustaría
tener, no la que corre en los teléfonos.

### `services/`

El **único** lugar del proyecto donde se llama a `fetch`. Antes la URL de Apps Script vivía en
`sync.js` y la de Supabase en `permisos.js`, cada una con su propia petición; esa es justo la
dependencia que impide cambiar de origen de datos.

| Archivo | Responsabilidad |
|---|---|
| `config.ts` | Endpoints y la clave pública. Nada más los conoce. |
| `http.ts` | `fetch` con tope de tiempo y errores normalizados. |
| `google/appsScript.ts` | Sheets y Drive. Sigue siendo el backend operativo. |
| `supabase/rpc.ts` | Solo funciones, nunca tablas. |

Dos rarezas que hay que respetar y están documentadas en el código:

- **`Content-Type: text/plain`** hacia Apps Script. No responde al preflight `OPTIONS`, así que
  `application/json` rompe la sincronización entera aunque el cuerpo sí sea JSON.
- **El `id_token` va en el cuerpo**, no en `Authorization`: esa cabecera dispararía el mismo
  preflight que se está evitando.

Y una decisión de seguridad: `ErrorDeRed.esTransitorio` distingue lo que se arregla
reintentando (sin red, 5xx, 429) de lo que no (401, 403, 422). Reintentar un 403 para siempre
es exactamente cómo se construye una cola que nunca vacía.

### `modules/`

Un dominio por carpeta. Solo se crean las subcarpetas que de verdad se usan — un módulo de
doscientas líneas con trece carpetas vacías no es modular, es un laberinto.

```
modules/visitas/
   components/     presentación
   hooks/          estado y efectos reutilizables
   services/       orquestación del dominio
   repository/     de dónde salen los datos
   validators/     reglas de captura
   permissions/    qué puede hacer quién
```

## Permisos

Nunca se pregunta por el rol. Ni una sola vez, en ningún archivo:

```ts
can('visitas', 'crear')          // sí
if (perfil.rol === 'admin')      // no
```

`if (rol === 'admin')` esparcido por la app significa que crear un rol nuevo —"supervisor
regional", "coordinador de zona"— obliga a encontrar y editar cada condición, y la que se
olvide se vuelve una fuga que nadie ve hasta que alguien lee lo que no debía.

Los permisos vienen de la base de datos. **La ausencia de permiso es la negación**: no hay
lista de denegados, porque con dos listas la pregunta "¿y si está en las dos?" no tiene
respuesta obvia, y las respuestas no obvias en control de acceso terminan en fugas.

La invitación tiene **tres** estados y los tres importan: `true` entra, `false` no entra,
`null` todavía no se ha podido preguntar. Negar por no saber dejaría fuera a un educador que
abre la app en un sótano sin cobertura, que es justo cuando más necesita capturar.

## Repositorios

El resto de la app **nunca sabe de dónde vienen los datos**. Pide, y alguien responde.

```
hoy      Google Sheets  (vía Apps Script)  +  espejo de lectura en Supabase
después  Supabase
luego    DuckDB para analítica,  Cloudflare R2 para archivos
```

Google Sheets y Drive **no se eliminan** mientras no exista una decisión explícita de cambio
total: siguen siendo parte del flujo operativo.

## Pruebas

```bash
npm test        # Vitest
npm run check   # tsc --noEmit
npm run build   # Vite
```

225 aserciones. Las de dominio (`estado`, `storage`, `catalogos`, `datos`, `revisiones`) cubren
la lógica que **sobrevive intacta** a la migración: son las mismas pruebas antes y después de
que un módulo se mueva a TypeScript, y por eso sirven de red durante el traslado.

`modulos.test.js` merece una nota aparte. Comprueba que todos los módulos importan de verdad y
que el service worker no se desfase de los archivos en disco. Existe por dos accidentes reales:
un borrado por índices que dejó un fragmento de código al final de un archivo —`node --check` lo
dio por bueno, porque resultó ser sintaxis válida— y un módulo nuevo que no se agregó a la lista
del SW, lo que funciona en el escritorio y rompe la app en los teléfonos ya instalados.

## Lo que todavía no está hecho

- La interfaz sigue siendo vanilla. Ningún componente React está en producción.
- `js/sync.js` y `js/permisos.js` aún tienen su propio `fetch`; la capa de servicios existe y
  está probada, pero todavía no está conectada a ellos.
- Nada de esto se ha visto en un navegador. En este entorno no hay uno.
