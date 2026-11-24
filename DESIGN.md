---
name: APP_EDU_CRM — Gestor de Visitas
description: Cuaderno de campo estéril; neutros gasa y grafito, el color solo habla de estado.
colors:
  paper: "#F5F8F7"
  surface: "#FFFFFF"
  surface-2: "#EDF2F0"
  ink: "#101617"
  ink-2: "#3D4A48"
  muted: "#5C6762"
  rule: "#DCE3E1"
  rule-soft: "#E8EDEB"
  st-plan: "#8A9691"
  st-miss: "#C81E3A"
  st-part: "#0B72B9"
  st-done: "#1F8A54"
  st-plan-bg: "#EEF2F1"
  st-miss-bg: "#FBEEF0"
  st-part-bg: "#EAF2F8"
  st-done-bg: "#EAF4EE"
  degasa-green: "#62B81F"
  protec-blue: "#00458B"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.1em"
rounded:
  sm: "6px"
  md: "9px"
  lg: "14px"
  pill: "999px"
spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "20px"
  sp-6: "24px"
  sp-8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chip-on:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  input:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    rounded: "7px"
    padding: "8px 10px"
  input-focus:
    backgroundColor: "{colors.surface}"
  input-error:
    textColor: "{colors.st-miss}"
  pill-estado:
    backgroundColor: "{colors.st-done-bg}"
    textColor: "{colors.st-done}"
    rounded: "4px"
    padding: "1px 5px"
  segmented:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "7px"
    padding: "5px 11px"
  segmented-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  evento:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  toast:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "8px"
    padding: "10px 12px"
  modal:
    backgroundColor: "{colors.surface}"
    rounded: "12px"
  tabla-encabezado:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    padding: "7px 10px"
  tabla-celda:
    textColor: "{colors.ink}"
    padding: "7px 10px"
  tarjeta-sector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "10px"
    padding: "12px"
  calendario-celda-mes:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    padding: "5px 6px"
    height: "92px"
  calendario-hoy:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "999px"
  estado-vacio:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.lg}"
    padding: "32px 16px"
---

# Design System: APP_EDU_CRM — Gestor de Visitas

## Overview

**Creative North Star: "El Cuaderno de Campo Estéril"**

Papel clínico y tinta. Neutros de blanco gasa y grafito con una leve desviación azul-verde; no hay color de marca en la interacción. Lo interactivo se resuelve con tinta, peso y espacio, y el color saturado queda reservado para el **estado** de una visita o actividad. La interfaz se lee de un vistazo en un pasillo, con una mano y sin señal.

El sistema es denso pero calmado: escala tipográfica de seis pasos, espaciado en múltiplos de 4 px, radios chicos. Existen temas intercambiables (Claro, Oscuro, DEGASA y los que Administración cree) y un subtema opcional "Apple" que solo cambia forma, profundidad y movimiento, nunca la paleta.

**Key Characteristics:**
- El color es estado, nunca decoración; el estado siempre lleva texto o punto además del color.
- `--ink` gobierna botones, foco y selección: retintarlo re-marca toda la app.
- Superficies planas en reposo; la sombra aparece al responder.
- Un tema se define solo con variables; ningún componente depende de un tema concreto.

## Colors

Paleta de neutros fríos más cuatro colores de estado; todo lo demás se deriva con `color-mix()` desde `--ink`, `--surface` y `--paper`.

### Primary
- **Tinta Grafito** (#101617): texto, botones primarios, chip activo y foco. Es el "acento" del producto.

### Secondary (estado, única cromía)
- **Rojo Faltante** (#C81E3A): visita o actividad no realizada; acciones destructivas.
- **Azul Parcial** (#0B72B9): en curso o parcial.
- **Verde Hecho** (#1F8A54): completado; LED de guardado.
- **Gris Plan** (#8A9691): planeado, aún sin ejecutar.
Cada uno tiene su tinte de fondo (`st-*-bg`) para pastillas.

### Neutral
- **Gasa** (#F5F8F7): fondo de la app (paper).
- **Blanco Clínico** (#FFFFFF): tarjetas, drawers (surface).
- **Gasa Profunda** (#EDF2F0): controles, chips en reposo, hover (surface-2).
- **Tinta Media** (#3D4A48) y **Grafito Apagado** (#5C6762 en Claro; #5A6748 en DEGASA; #8C9A95 en Oscuro): texto secundario y metadatos.
- **Trazo** (#DCE3E1) y **Trazo Suave** (#E8EDEB): bordes y divisores.

### Temas
- **Oscuro** invierte neutros (paper #0D1112, surface #141A1B, ink #E9EEEC) y aclara los estados.
- **DEGASA** retinta `--ink` a verde bosque (#17301C), usa Verde DEGASA (#62B81F) para "hecho" y Azul PROTEC (#00458B) para "parcial"; la barra superior lleva una línea degradada verde→azul.
- Paleta categórica de ocho tonos (`--cat-1…8`, "Otros" en gris) solo para reportes donde el color identifica una categoría, no un estado.

### Named Rules
**The Color Is State Rule.** El color saturado solo comunica estado; nunca decora ni marca una acción.
**The Never Alone Rule.** Un estado nunca se expresa solo con color: siempre punto o pastilla con texto.
**The Readable Floor Rule.** Ningún texto baja de 11px (`--fs-xs`), y todo texto pasa 4.5:1 sobre su fondo en cada tema; las pastillas de estado mezclan el color con tinta (`--st-mezcla`, 55% en Claro y DEGASA, 100% en Oscuro) para lograrlo.
**The Ink Focus Rule.** El halo de foco es siempre tinta, nunca color de estado, para verse igual sobre cualquier tile.

## Typography

**Display / Body Font:** pila del sistema (-apple-system, Segoe UI, Roboto, Helvetica Neue)
**Label / Mono Font:** ui-monospace (SF Mono, Menlo, Consolas) para metadatos y marca

**Character:** nativa y sin ornamento; la monoespaciada aporta la sensación de registro técnico.

### Hierarchy
- **Display** (700, 26px / 2xl, letter-spacing -0.02em): cifras grandes.
- **Headline** (700, 20px / xl): título de vista.
- **Title** (700, 16px / lg): títulos de sección y drawer.
- **Body** (400, 14px / md, 1.5): cuerpo y controles.
- **Label** (700, 11px, 0.1em, mono, mayúsculas): eyebrows, LED de guardado, marca de la barra.
- Escala completa: 11 / 12.5 / 14 / 16 / 20 / 26 px.

### Named Rules
**The Six Steps Rule.** Todo tamaño sale de la escala `--fs-*`; no se inventan tamaños sueltos.

## Layout

Una sola pantalla: el calendario. Todo lo demás se empuja encima como drawer (ancho `min(520px, 100%)`) o ventana propia. Barra superior más navegación de módulos lateral en escritorio. Espaciado en pasos de 4 px (`--sp-1…8`); padding interno de drawer 14px; objetivo táctil mínimo 40px en `pointer: coarse`. Punto de quiebre principal a 720px (móvil), ajuste a 420px y ampliación desde 1200px. Respeta `env(safe-area-inset-bottom)` en pies fijos.

## Elevation & Depth

Plano por defecto; las capas se separan con borde fino (`--rule`) y cambio tonal paper → surface → surface-2. La sombra aparece como respuesta (hover de botones y tiles) o para objetos que entran (drawer, modal).

### Shadow Vocabulary
- **Reposo/hover** (`0 1px 2px rgba(16,22,23,.04), 0 8px 24px -12px rgba(16,22,23,.18)`): hover de tiles y botones.
- **Flotante** (`0 24px 60px -20px rgba(16,22,23,.4)`): drawers y modales, sobre un velo `rgba(16,22,23,.3)`.
- El subtema Apple añade vidrio esmerilado (`blur(20px) saturate(180%)`) en barra y navegación.

### Named Rules
**The Flat-At-Rest Rule.** Una superficie en reposo no lleva sombra; la sombra es una respuesta, no una decoración.
**The Error Stays Close Rule.** El error vive pegado al campo y desaparece al corregirlo; nunca un toast.

## Shapes

Radios en tres pasos: 6px en controles, 9px en tiles, 14px en superficies grandes; píldora (999px) para chips y estados. El subtema Apple sube a 9 / 12 / 16 / 20px y toma su color de foco del azul de estado del tema activo (`--st-part`), no de un azul fijo. Bordes de 1px; el borde discontinuo marca "agregar" (chips y botones de adjuntar).

## Components

### Buttons
- **Shape:** radio chico (6px).
- **Primary:** fondo tinta, texto paper, 7px 14px, peso 600, tamaño 13px.
- **Hover / Focus:** opacidad .88 con sombra y elevación de 1px; al presionar `scale(.98)` con curva de resorte (la única que la usa). Foco: halo de tinta.
- **Texto:** sin fondo, tinta media, hover surface-2; variante `peligro` en rojo.
- **Dashed / Add:** borde discontinuo que pasa a sólido y tinta al pasar el cursor.

### Chips
- **Style:** píldora, surface-2, borde trazo, 11.5px.
- **State:** activo = tinta sólida con texto paper; `add` con borde discontinuo y prefijo "+"; sellado = apagado (opacidad .55). El chip activo además lleva una marca "✓", peso 600 y un anillo doble (2px de surface y 3.5px de tinta): se reconoce sin depender del color.

### Cards / Containers
- **Tile:** surface, borde trazo, radio 9px, relleno 11px 12px; hover con borde tinta-2 y sombra. Etiqueta en mono de 11px en mayúsculas, valor de 26px con cifras tabulares, nota de 11px.
- **Pastilla de estado (`.pill`):** no es redonda: mono de 11px en mayúsculas, radio 4px, relleno 1px 5px, fondo `st-*-bg` con el color de estado. La variante neutra usa surface-2 y gris apagado. Es la expresión de la regla Never Alone.

### Inputs / Fields
- **Estructura:** cada campo es una columna (`.campo`, separación 5px) con una etiqueta en mono de 11px en mayúsculas y gris apagado (`.campo-lbl`) sobre el control.
- **Reposo:** fondo surface-2 (hundido), borde trazo de 1px, radio 7px, relleno 8px 10px, texto de 13.5px. El placeholder es gris apagado. La variante `mono` usa cifras tabulares (horas, números). Variante compacta de filtros (`.filtro .inp`, selectores incluidos): 12px y relleno 5px 8px; la fila de filtros dentro de una tabla baja a 11.5px y 4px 7px.
- **Foco:** el fondo pasa a surface, el borde a tinta y aparece un halo de 3px con 12% de tinta. Sin contorno nativo; el foco nunca toma color de estado.
- **Ayuda:** texto de 11.5px en gris apagado bajo el control (`.ayuda`). Un aviso informativo (`.aviso`) es azul parcial con borde izquierdo de 2px: avisa, no bloquea.
- **Casilla suelta:** casilla de 15px con `accent-color` tinta y texto de 12.5px (`.campo-check`).
- **Fila de campo:** en listas de ajustes, etiqueta a la izquierda y control a la derecha; bajo 720px se apila.
- **Fecha:** se muestra siempre en dd/mm/aaaa; el `input type=date` real va encima, invisible, para usar el calendario nativo. Vacía se ve en gris apagado.
- **Combo (autocompletar):** el menú es una superficie con borde de tinta, radio 7px, sombra grande y máximo 240px de alto; la opción activa o en hover usa surface-2 y el texto coincidente va en negrita. Un pie fijo en mono de 11px indica cantidad o ayuda.
- **Error:** el error vive pegado al campo y desaparece al corregirlo. El borde del control y la etiqueta pasan a rojo faltante, y debajo aparece un mensaje de 11px en el mismo rojo (`.campo-error`). Nunca un toast: obligaría a recordar cuál de varios campos era.
- **Pista de guardado (`.pista`):** línea de 11px en rojo que explica qué falta para poder guardar; pasa a verde hecho (`es-ok`) cuando se cumple.
- **Deshabilitado:** botones al 40% de opacidad con cursor `not-allowed`; chips al 55%; un botón con acción en curso usa cursor `progress`.
- **Error de bloque:** mensajes de fallo de acceso (por ejemplo Google) van en rojo sobre `st-miss-bg`, radio 6px, relleno 10px 12px.

### Segmented control / Solapas
- Grupo con borde trazo y radio 7px; cada botón en mono de 11px, mayúsculas y espaciado de .09em, gris apagado, con separadores de 1px.
- Activo: tinta sólida con texto paper (usa `aria-pressed` en filtros y `aria-selected` en solapas, con el mismo aspecto). El inactivo se atenúa y sube a tinta al pasar el cursor. El activo suma peso 700 y una línea interior inferior de 3px en color paper, para distinguirse sin depender del color.
- Nunca recorta texto: si no cabe, el grupo se desplaza horizontalmente sin barra visible. En móvil sube a 44px de alto. Dentro del drawer las solapas se estiran a todo el ancho.
- **Insignia de contador (`.tab-badge`):** píldora mono de 11px en azul parcial con texto blanco; invierte a paper sobre tinta cuando su solapa está activa.

### Calendario y eventos
- **Evento de visita (`.ev`):** posicionado por hora (46px por hora) con alto mínimo de 18px; fondo surface, borde trazo y **borde izquierdo de 3px con el color de estado** (esquinas izquierdas de 3px, derechas de 6px). Hora en mono de 11px, cliente de 11.5px en peso 600 que se recorta con "…", hospital en gris apagado. El relleno y el tamaño de letra se reducen al aumentar los solapes.
- **Hover:** sombra, elevación de 1px y borde izquierdo de 4px. Arrastrando baja a 30% de opacidad; una franja de 7px en el borde inferior redimensiona.
- **Variantes:** de equipo (fondo surface-2 y nombre de quien la registró); en vivo (borde izquierdo de tinta y punto con latido); cancelada (50% de opacidad); de otra persona (contorno de 2px). El color de persona sale de la paleta categórica (`--cat-*`), con un avatar de 15px con inicial y un contorno de 2px alrededor de la tarjeta, para distinguir a varios educadores a la vez sin tocar el borde izquierdo (que es del estado). La etiqueta de estado de la visita ("FINALIZADA · SIN ACTIVIDADES") va en mono, mayúsculas y en el color del estado.
- **Compromiso externo (Google Calendar):** rayado diagonal en surface-2/trazo suave, borde discontinuo, 85% de opacidad y sin borde de estado, por debajo de las visitas en el apilado.

### Calendario (rejillas Día, Semana, Mes y Agenda)
El calendario es la pantalla. Sus cuatro vistas comparten el mismo vocabulario: mono para días y horas, tinta para "hoy" y el color solo en el borde de estado de cada visita.
- **Día y Semana (rejilla de horas):** eje de 52px más una columna (Día) o cinco (Semana, mínimo 122px cada una y 700px en total); cada hora mide 46px y la media hora se marca con una línea discontinua. Encabezados pegajosos arriba con fondo surface y borde inferior; el día de hoy se hunde a surface-2. Día de la semana en mono de 11px en mayúsculas, número de 17px en peso 600; el eje de horas en mono de 11px alineado a la derecha sobre el fondo paper.
- **Línea de ahora:** es de tinta, no roja (el rojo ya significa "faltante"): una línea de 1px con un punto de 7px a la izquierda y una insignia mono de 11px con la hora a la derecha.
- **Mes:** cuadrícula de 7 columnas (mínimo 640px) con encabezado mono de 11px y una línea inferior de tinta; celdas de 92px de alto mínimo, borde trazo suave y relleno 5px 6px. Fines de semana y días de otro mes se hunden a surface-2 (el número de otro mes baja al 40%); hover surface-2. El número del día es un círculo de 18px y el de hoy se rellena de tinta. Cada visita es una línea de 11px con hora mono y cliente recortado con "…"; las del equipo van en cursiva; las canceladas, tachadas; el desborde se resume con "+N" en mono. Cada línea de visita empieza con un punto de estado (relleno = ya ocurrió, hueco = aún no, por daltonismo) y un punto de 7px con el color de la persona.
- **Agenda (móvil):** una tira semanal de 7 días con círculo de 22px para el día seleccionado (tinta) y puntos de 3px con el color de estado como carga. Debajo, encabezados de día pegajosos en mono con contador, y filas (`.arow`) en cuadrícula de 46px + resto: hora mono, cliente de 13.5px en peso 600, hospital en gris apagado y pastillas; borde izquierdo de 3px con el color de estado, radio 8px. Un compromiso de Google Calendar usa surface-2 y cursiva, sin color de estado.
- **Barra de conexión de Google Calendar:** franja discontinua surface-2 sobre la rejilla, visible solo mientras no hay conexión.

### Tarjeta de sector
- **Naturaleza:** es una tarjeta, no una fila: el sector carga con objetivo, procedencia y contadores, y un renglón obligaría a truncar justo lo que se viene a consultar.
- **Forma:** columna a todo el ancho, surface, borde trazo, radio 10px, relleno 12px, separación de 8px; toda ella es un botón que empuja al panel del sector.
- **Contenido:** nombre de 13.5px en peso 600 recortado con "…"; objetivo de 12px en tinta media; procedencia ("origen") de 11px en gris apagado en una sola línea; flecha de 16px a la derecha.
- **Pie:** línea divisoria suave y contadores en mono de 11px (por ejemplo "0 actividades"). La pastilla de estado no va aquí sino en la cabecera, junto al nombre.
- **Estado del sector:** pastilla mono de 11px en mayúsculas, borde de 1px y radio 4px. Neutra por defecto; "en proceso" lleva borde y texto de tinta; "finalizado" usa verde hecho sobre su fondo. Un dato faltante se dice con texto, no se deja en blanco. Verificado en la app: el estado inicial es "Pendiente" (neutro).
- **Hover:** borde de tinta, sombra y elevación de 1px. Una vez sellado el sector, la tarjeta no invita a tocarse para editarlo (solo admite registrar actividades).

### Tabla
- **Estructura:** `border-collapse` con texto de 12px, relleno 7px 10px, celdas sin saltos de línea y una línea de trazo suave entre filas. Envuelta en un contenedor con scroll horizontal táctil.
- **Encabezado:** mono de 11px en mayúsculas, peso 600, gris apagado, pegajoso con fondo surface. Las columnas ordenables muestran cursor de mano y suben a tinta al pasar el cursor. Debajo puede ir una fila de filtros por columna con inputs compactos (relleno 4px 7px, 11.5px).
- **Celdas:** las cifras (`.num`) se alinean a la derecha con números tabulares; la primera columna se recorta a 220px con "…" y las de proyecto a 280px; las descripciones largas pueden envolver (200–280px). En la práctica las cifras de la tabla usan la fuente monoespaciada.
- **Filas:** hover con `--row-hover` (5% de tinta, no surface-2, para no confundirse con un estado activo); las clicables llevan cursor de mano. Sin cebra y sin bordes verticales.
- **Carga más:** un botón centrado bajo la tabla, con 12px de aire arriba.

### Modal
- Superficie con borde trazo, radio 12px y sombra grande sobre un velo de 40%; cabeza, cuerpo con scroll y pie con acciones. Anchos por contenido: 420 (fecha), 440 (base), 480 (sector), 520 (actividad) y 860px (detalle). Bajo 720px ocupa toda la pantalla y el botón principal se estira.

### Ventanas modales y errores de carga
- Todas las ventanas `.modal` se mejoran de forma centralizada (`src/shared/a11y/dialogos.ts`): rol de diálogo, nombre por su título, foco inicial dentro, Tab atrapado y foco que vuelve a quien la abrió.
- **Estado de error (`EstadoError`):** mensaje humano ("No pudimos cargar…, revisa tu conexión"), el error técnico como "Detalle" aparte y un botón "Reintentar" cuando hay cómo.
- **Confirmación en línea (`BotonConfirmar`):** "¿Descartar…? Sí / No" en la propia fila, nunca `window.confirm`, que no se muestra en la app instalada.
- **Botón de icono:** se ve de 26px pero su área de respuesta es de 36px; en pantallas táctiles es de 40px. Los botones de quitar miden al menos 24×24.

### Toasts
- Aparecen abajo al centro, ancho máximo de 420px; superficie con borde izquierdo de 3px en el color del mensaje, radio 8px y sombra grande; entran con un desplazamiento de 8px en .2s. Pueden llevar una acción subrayada de texto ("Deshacer").

### Estados vacío y de carga
- **Vacío (`.estado-vacio`):** caja con borde discontinuo, radio 14px y fondo surface-2, centrada, con ícono, título de 16px en peso 600, texto de hasta 46ch y una acción opcional.
- **Esqueleto:** filas de 44px (la de título, 22px al 40%) con brillo que se desplaza en 1.4s; se desactiva con `prefers-reduced-motion`.
- **Movimiento reducido:** con `prefers-reduced-motion` se anulan todas las transiciones y animaciones.

### Navigation
- Barra superior con marca mono, navegación de fechas y botón "Hoy"; módulos en rail lateral (items de 72px) en escritorio, adaptados a móvil bajo 720px.

### Drawer (componente distintivo)
Entra desde la derecha con resorte (.28s); cabecera con eyebrow, cuerpo con scroll y pie fijo para Guardar. Indicador de autoguardado: LED de 5px que pasa a verde.

## Do's and Don'ts

### Do:
- **Do** derivar translúcidos y tintes con `color-mix()` desde `--ink`, `--surface` y `--paper`.
- **Do** usar `--st-*` solo para estado y acompañarlo siempre de texto o punto.
- **Do** tomar tamaños, radios y espaciado de las escalas `--fs-*`, `--r-*` y `--sp-*`.
- **Do** reservar la curva de resorte para la respuesta táctil de presionar y la entrada del drawer.
- **Do** mostrar el error junto al campo (borde, etiqueta y mensaje en rojo faltante) y quitarlo al corregir.
- **Do** usar `--on-st` (blanco en Claro, casi negro en Oscuro) para texto sobre un relleno sólido de estado.
- **Do** garantizar 40px de objetivo táctil en pantallas táctiles.

### Don't:
- **Don't** introducir un color de marca para botones o enlaces; la interacción es tinta.
- **Don't** usar `#FFF` ni negros sueltos: todo sale de los tokens del tema activo.
- **Don't** dejar que el foco tome un color de estado.
- **Don't** usar glifos de texto ni emojis como icono (✕ ✓ 🗄 📍): usar `Icono` (trazo de 1.6, `currentColor`).
- **Don't** reportar errores de campo con un toast.
- **Don't** añadir sombras a superficies en reposo.
- **Don't** hacer que el subtema Apple redefina paletas; solo cambia forma, profundidad y movimiento.
