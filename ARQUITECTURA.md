# Arquitectura — Iteración 01.6

Documento vivo. Describe hacia dónde va la reorganización y, sobre todo, **qué sigue igual**,
porque durante la migración conviven dos formas de escribir la misma app.

## Estado actual: migración progresiva, no reescritura

La app funciona **en cada commit**. No hay un "día del cambio" en el que todo se sustituye.

```
js/*.js          ← lo que todavía no se porta. Encoge con cada iteración.
src/             ← la arquitectura nueva. Crece módulo a módulo.
```

**Portado hasta ahora**, ambos exponiendo la misma API que antes para no tocar a quien los
llama:

| Original | Ahora | Mayor archivo |
|---|---|---|
| `js/drawer.js` (1,390 líneas) | `modules/visitas/` — 10 archivos | ~290 |
| `js/calendario.js` (759 líneas) | `modules/agenda/` — 10 archivos | ~255 |
| `js/actividad.js` (662 líneas) | `modules/actividades/` — 6 archivos | ~265 |
| `js/sector.js` (406 líneas) | `modules/sectores/` — 4 archivos | ~330 |
| `js/dashboard.js` (583 líneas) | `modules/dashboard/` — 4 archivos | ~207 |
| `js/revision.js` (379 líneas) | `modules/revision/` — 7 archivos | ~92 |
| `js/admin.js` (562 líneas) | `modules/administracion/` — 7 archivos | ~148 |
| `js/paleta.js` (187 líneas) | `modules/paleta/` — 3 archivos | ~160 |

### Los módulos son un registro de datos, no condiciones repartidas

`src/app/navegacion/modulos.ts` es una lista. Cada entrada declara su rótulo, su icono, su
insignia y **su propia condición de acceso**, que nunca pregunta por el rol: pregunta por un
permiso (`puede('dashboards','personal')`) o por una capacidad (`esAdministrador()`,
`flujosDisponibles().length > 0`). Agregar CRM o Analytics es añadir una entrada; el riel, el
orden y quién lo ve salen solos.

Lo que no se puede abrir no se dibuja. Un botón que lleva a "no tienes permiso" es una promesa
rota, y además revela que el módulo existe.

`Navegacion.tsx` es **un solo componente** para el riel lateral de escritorio y para la barra
inferior de móvil; el CSS elige cuál de los dos rótulos —largo o corto— se ve. Duplicarlo
garantizaría que algún día un módulo apareciera en uno y no en el otro. La barra va abajo en
móvil porque la app se usa de pie y con una mano dentro de un hospital: el borde inferior es lo
único que alcanza el pulgar sin recolocar el teléfono.

El módulo activo se distingue por **fondo y por una barra lateral** (`::before`), no solo por
tono: saber dónde estoy no puede depender de percibir un color.

**Ya no queda ningún módulo modal.** La bandera `modal: true` existió tres commits, mientras
revisión y administración seguían siendo vanilla y construían su propio panel a pantalla
completa; se declaraba en el registro —y no escondida en el shell— justamente para que la deuda
se viera desde donde se lee la lista. Al portarlos, el campo se borró entero.

### Un módulo declara TODO lo que necesita para funcionar, no solo su permiso propio

Revisión pedía únicamente tener flujos asignados. Pero la cola sale de `consultarVisitas()`,
que devuelve vacío sin `visitas.consultar`: con flujos y sin consulta, la bandeja estaba
garantizadamente vacía y el riel seguía ofreciéndola. Un botón que promete trabajo que no se
puede ver es la misma promesa rota que un botón hacia «no tienes permiso».

La cola está además acotada por **alcance**: se revisa al equipo que se tiene asignado, no a la
empresa. Es correcto y conviene recordarlo al configurar un revisor —sin alcance sobre nadie,
su bandeja está vacía aunque tenga todos los permisos.

### Administración publica; por eso valida antes

Es el único módulo cuyo guardado es **explícito**. En el drawer cada tecla se persiste sola,
pero aquí un error no se queda en una pantalla: se reparte a todos los educadores en el
siguiente sync. El botón «Guardar» existe para dar ocasión de revisar antes de que eso pase.

`problemasDe` devuelve **todos** los problemas a la vez, no el primero: corregir de uno en uno,
con una confirmación por vuelta, es cómo se abandona a la mitad.

La configuración de campos se materializa al abrir, resolviendo defaults + banderas viejas + lo
ya configurado. Mostrar la tabla vacía haría creer que el tipo está «sin configurar» e
invitaría a rellenarlo de nuevo, cuando en realidad ya tiene reglas activas — y esas reglas SON
el formulario de captura: la pantalla de actividad no tiene ni una condición escrita a mano.

### Las ventanas cuelgan del `host` que reciben, nunca de `document.body`

`.drawer-raiz` es `z-index: 50` y crea su propio contexto de apilado; `.modal` es `z-index: 20`.
Una ventana montada FUERA de ese contexto queda por debajo del drawer: se ve a medias y los
clics se los come el scrim, cuya respuesta es ofrecer descartar la visita.

Ya ocurrió una vez, con la ventana de sector, y el síntoma reportado fue que no se podían
agregar sectores a una visita nueva. Por eso el drawer renderiza un `<div>` que React deja
siempre vacío —y que por tanto nunca reconcilia— dentro de `.drawer-raiz`, y todas las ventanas
se cuelgan de ahí.

### El arrastre no pasa por el estado de React

Los tres gestos del calendario —crear arrastrando, mover, redimensionar— mutan directamente un
elemento **fantasma** durante el gesto, y solo tocan el estado al soltar.

Un `setState` por `pointermove` re-renderizaría el calendario entero sesenta veces por segundo,
con sus tarjetas y su reparto en columnas; en un teléfono de gama media eso se siente como que
el arrastre "se pega". El fantasma además deja la tarjeta original quieta, que es lo que
permite cancelar el gesto sin haber movido nada.

Era la técnica del calendario anterior. No era un atajo: era la decisión correcta, y se
conserva.

Vite consume los módulos ES actuales sin modificarlos, así que el paquete que se construye hoy
es la misma aplicación de siempre. Lo que se va moviendo a `src/` deja de existir en `js/`; lo
que todavía no se movió, sigue funcionando donde está.

> **El despliegue ya cambió.** `js/app.js` importa del árbol `src/`, así que servir los
> archivos sueltos desde la raíz **ya no funciona**. El artefacto es `dist/`, y se produce con
> `npm run build`.

### Service worker

Se **genera en el build** (`src/app/generarSW.ts` + un plugin en `vite.config.ts`). La lista de
precache dejaba de ser mantenible en cuanto los nombres llevan hash, y a mano ya era una fuente
de errores: olvidar un módulo funciona perfecto en el escritorio y rompe la app offline en los
teléfonos que ya la tenían instalada, porque `cache.addAll` falla entero si un archivo no está.

Los estáticos que deben conservar su nombre —`icon.svg`, `manifest.json`— viven en `public/`.
Si se dejan en la raíz, Vite les pone hash y los mueve a `assets/`, y entonces la referencia
`./icon.svg` del manifiesto apunta a un archivo que no existe: la app instalada pierde su ícono.

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

## Configuración

Todo sale de `.env` (ver `.env.example`). **Nada de eso es secreto**: el prefijo `VITE_`
significa que el valor se incrusta en el paquete que descarga el navegador.

`config.ts` comprueba al arrancar que la clave de Supabase sea de rol `anon`. Si alguien pega
por error la `service_role` —las dos cadenas se ven iguales— la app se detiene en vez de
publicar en internet una clave que se salta todas las políticas de la base.

## Lo que todavía no está hecho

- `app.js` sigue siendo vanilla: es lo último que queda del arranque.
- `materiales.js`, `evidencias.js`, `vistaprevia.js` e `hilo.js` devuelven nodos DOM y se
  montan con `NodoVanilla`. Ese componente debe quedarse sin usos y desaparecer.
- La barra de navegación del calendario vive en `index.html`, fuera del árbol de React, y se
  enlaza con un hook (`useControlesExternos`) que pone `textContent` a mano. Es un artefacto
  de la migración; desaparece cuando se porte el shell.
- `js/sync.js` y `js/permisos.js` aún tienen su propio `fetch`; la capa de servicios existe y
  está probada, pero todavía no está conectada a ellos.
- **Costo del cambio a React: ~60 kB gzip.** El paquete pasó de 39 kB a ~100 kB. En la red de
  un hospital eso se nota en el primer arranque; después el trozo de React queda en caché y no
  se vuelve a descargar salvo que suba de versión.
- Nada se ha visto en un navegador: en este entorno no hay uno. Lo que sí hay ahora son
  pruebas de render contra un DOM real (`tests/VisitaDrawer.test.tsx`), que verifican
  comportamiento pero no dicen nada sobre si se ve bien.

## La prueba que enciende la app

`tests/arranque.test.tsx` monta el `index.html` real, invoca el arranque y comprueba que se
pinte algo.

Existe por un fallo concreto: al mover los módulos al riel quité tres botones de `index.html` y
dejé vivo un `addEventListener` sobre uno de ellos. Eso revienta en la primera línea del
arranque y deja la pantalla en blanco. `tsc` no lo ve, porque `app.js` es JavaScript —y **las
465 pruebas que había pasaban con la app rota, porque ninguna la encendía**.

Es la misma lección que ya había dado la ventana de sector: una prueba que dobla el punto de
unión no puede fallar donde el fallo vive. Cada capa nueva necesita al menos una prueba que
atraviese la unión de verdad.

Tiene un coste que conviene conocer, y que ha mordido dos veces: **el `document` no se
reinicia entre pruebas**, aunque los módulos sí. Todo lo que la app cuelga de él se acumula, y
cada copia cierra sobre la instancia de SU prueba —con los contenedores que su limpieza ya
arrancó del DOM—.

- Los `setInterval` que repintan el calendario: acumulados, happy-dom no consigue cerrar el
  entorno y vitest mata el worker DESPUÉS de que todas las pruebas hayan pasado. El informe
  dice que todo va bien y la ejecución falla igual.
- Los `keydown`: el manejador de la primera prueba corre PRIMERO y gana. Con Ctrl+K abría la
  paleta de su propia instancia, dentro de un contenedor ya desmontado, así que la prueba de la
  paleta no veía nada —y pasaba en solitario, que es la peor forma de fallar—.

Por eso `arrancar()` apunta unos y otros, y `afterEach` los retira.
