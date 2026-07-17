# Iteración 01.2 — Planeación de Visitas y Ejecución de la Visita

Continuaremos desarrollando el módulo **Plan de Trabajo**, respetando toda la arquitectura definida previamente.

En esta iteración se diseñará el flujo completo desde la programación de una visita hasta el registro inicial de las actividades realizadas durante la visita.

No desarrollar todavía CRM, dashboards, analítica o inteligencia artificial.

---

# Objetivo

El objetivo es que el educador pueda:

1. Programar una visita.
2. Definir los sectores que atenderá.
3. Llegar al cliente y registrar su Check-in.
4. Registrar actividades por cada sector.
5. Registrar materiales cuando la actividad lo requiera.
6. Finalizar la visita mediante un Check-out.

Todo el flujo debe minimizar la cantidad de clics y sentirse natural tanto en dispositivos móviles como en escritorio.

---

# 1. Programar Visita

Al crear una nueva visita deberán capturarse los siguientes datos.

## Información General

* Cliente
* Hospital
* Fecha
* Hora de inicio
* Hora de finalización.

La duración será definida por el usuario.

No calcular automáticamente la hora de salida.

---

## Sectores

Una visita podrá contener múltiples sectores.

Cada sector deberá visualizarse como una tarjeta independiente dentro del formulario.

Cada sector almacenará:

* Sector
* Objetivo
* Origen de la actividad.

El usuario podrá agregar tantos sectores como sean necesarios.

---

## Origen de la Actividad

Este campo deberá provenir de un catálogo administrable.

El catálogo será gestionado desde el módulo de Administración para permitir agregar, modificar o eliminar opciones sin necesidad de modificar el código de la aplicación.

Por el momento incluir únicamente los siguientes valores:

* BI
* I&D
* Gerencia de Marca
* Ventas

---

# Restricciones después de Guardar

Una vez creada la visita no podrán modificarse directamente:

* Cliente
* Hospital
* Fecha
* Hora de inicio
* Hora de finalización.

Únicamente estarán disponibles las siguientes acciones:

* Agregar nuevos sectores.
* Cancelar la visita.
* Reagendar la visita.

La cancelación deberá solicitar una confirmación explícita antes de ejecutarse.

Nunca permitir cancelaciones accidentales.

Si es necesario cambiar la fecha o el horario deberá utilizarse la acción **Reagendar**, la cual conservará un historial de cambios indicando:

* Fecha y horario anterior.
* Nueva fecha y horario.
* Usuario que realizó el cambio.
* Fecha y hora del cambio.
* Motivo del cambio.

No permitir la edición directa de estos campos.

---

# 2. Inicio de la Visita (Check-in)

Al llegar al cliente, el usuario abrirá la visita programada y presionará el botón **"Iniciar Visita"**.

Esta acción registrará automáticamente:

* Fecha de llegada.
* Hora exacta de llegada.
* Coordenadas GPS (Latitud y Longitud).
* Precisión de la ubicación reportada por el dispositivo.
* Dirección aproximada (cuando exista conexión).
* Usuario que realizó la acción.
* Dispositivo desde el cual se registró.

Una vez realizado el Check-in, el estado de la visita cambiará automáticamente a:

**En Proceso**

Estos datos no podrán modificarse manualmente.

Si no existe conexión a Internet, la información deberá almacenarse localmente y sincronizarse automáticamente cuando el dispositivo recupere conexión.

---

# Sectores de la Visita

Después del Check-in se mostrarán todos los sectores registrados.

Cada sector deberá mostrar claramente su estado.

Ejemplo:

* Pendiente.
* En proceso.
* Finalizado.

Al seleccionar un sector iniciará el registro de las actividades correspondientes exclusivamente a dicho sector.

Las actividades únicamente podrán registrarse después de haber realizado el Check-in.

---

# Registro de Actividades

Cada actividad siempre pertenecerá a un sector.

Nunca podrá registrarse una actividad sin estar asociada a un sector previamente definido.

Al seleccionar un sector, la aplicación solicitará únicamente la siguiente información:

* Tipo de actividad.
* Área visitada.
* Contacto responsable.

Las opciones iniciales para **Área Visitada** serán:

* Área Usuaria.
* Otra.

El sector deberá mostrarse únicamente como información de contexto (solo lectura).

No podrá modificarse desde el registro de actividades.

La aplicación conocerá automáticamente el sector desde donde fue iniciada la actividad y lo almacenará internamente.

---

# Contacto Responsable

Cada actividad deberá registrar el contacto responsable que atendió esa actividad específica.

El contacto representa a la persona encargada del grupo, capacitación, evaluación o actividad realizada durante esa interacción.

Deberán capturarse los siguientes datos:

* Nombre.
* Cargo.
* Servicio.

Cada actividad tendrá su propio contacto responsable.

Una misma visita podrá contener múltiples actividades y cada una podrá estar asociada a un contacto diferente.

Incluso si el mismo contacto participa en varias actividades, deberá registrarse dentro de cada actividad para conservar el contexto histórico de la atención realizada.

---

# Materiales Utilizados

Dependiendo del Tipo de Actividad, la aplicación determinará automáticamente si será necesario registrar materiales.

Esta regla será configurable posteriormente desde el módulo de Administración.

Si la actividad requiere materiales aparecerá el botón:

**Agregar Material**

Una actividad podrá contener uno o varios materiales.

El usuario podrá agregar tantos materiales como sea necesario antes de guardar la actividad.

---

# Búsqueda de Material

Al presionar **Agregar Material** deberá abrirse una ventana independiente.

No utilizar un selector tradicional.

Implementar un buscador inteligente.

La búsqueda consultará la tabla **Materiales** utilizando el campo:

**Material y Nombre**

Únicamente deberán mostrarse materiales pertenecientes al sector que actualmente se está registrando.

Mientras el usuario escriba deberán mostrarse sugerencias en tiempo real.

Cada sugerencia únicamente mostrará:

**Material y Nombre**

No mostrar información adicional para mantener una interfaz limpia.

---

# Registro del Material

Una vez seleccionado el material deberán capturarse los siguientes datos:

* Cantidad.
* Unidad de medida.

Las unidades disponibles inicialmente serán:

* Pieza.
* Paquete.
* Bulto.
* Caja.
* Cajilla.
* Pares.

Posteriormente estas unidades deberán administrarse mediante un catálogo configurable.

---

# Origen del Material

Cada material deberá registrar su origen.

Se deberá permitir cualquiera de las siguientes opciones:

## Opción 1

Folio SAP correspondiente a una mercancía sin cargo.

Ejemplo:

4500123456

## Opción 2

Nombre de la persona que entregó físicamente el material para evaluación.

Ejemplos:

* Juan Pérez.
* Gerente Regional Norte.
* Director Comercial.

El campo deberá aceptar texto libre y no limitarse a valores numéricos.

En futuras versiones podrá evolucionar hacia un selector de colaboradores.

---

# 3. Finalización de la Visita (Check-out)

Al concluir la atención al cliente, el usuario deberá presionar el botón **"Finalizar Visita"**.

Esta acción registrará automáticamente:

* Fecha de salida.
* Hora exacta de salida.
* Coordenadas GPS.
* Precisión de la ubicación.
* Dirección aproximada (cuando exista conexión).
* Usuario que realizó la acción.

La aplicación calculará automáticamente:

* Tiempo total de permanencia.
* Duración real de la visita.

El estado cambiará automáticamente a:

**Finalizada**

Estos datos no podrán modificarse posteriormente.

El Check-out únicamente representa el final de la presencia física del educador en el cliente.

La captura de actividades, materiales, contactos y evidencias podrá completarse posteriormente sin alterar la fecha y hora reales del Check-out.

---

# Estados de la Visita

La visita podrá encontrarse en alguno de los siguientes estados:

* Programada.
* En Proceso.
* Finalizada.
* Cancelada.

La arquitectura deberá permitir agregar nuevos estados en futuras versiones sin afectar el funcionamiento de la aplicación.

---

# Reglas de Negocio

* No podrá realizarse un Check-out sin haber realizado previamente el Check-in.
* Solo podrá existir un Check-in y un Check-out por visita.
* Las actividades únicamente podrán registrarse después del Check-in.
* Una visita finalizada no podrá reabrirse.
* Un mismo sector podrá contener una o varias actividades.
* Un mismo tipo de actividad podrá registrarse múltiples veces dentro del mismo sector, cliente y visita, siempre que correspondan a eventos diferentes.
* Cada actividad mantendrá su propio contacto responsable, materiales, evidencias y demás información asociada, funcionando como un registro independiente dentro del historial de la visita.
* Las actividades, materiales y evidencias podrán capturarse el mismo día o posteriormente sin modificar las fechas reales del Check-in y Check-out.
* El sistema no deberá impedir finalizar la visita por información pendiente de captura.
* Todas las acciones deberán registrarse como eventos auditables para futuras métricas y análisis.

---

# Eventos de Negocio Generados

Cada una de las siguientes acciones deberá generar automáticamente un evento dentro del historial de la plataforma:

* Visita Programada.
* Check-in Realizado.
* Actividad Registrada.
* Material Registrado.
* Contacto Registrado.
* Evidencia Cargada.
* Check-out Realizado.
* Visita Finalizada.

Estos eventos constituirán la base para la futura integración con el CRM, los dashboards, los indicadores operativos y el motor de inteligencia comercial.

---

# Experiencia de Usuario

No utilizar formularios extensos.

Cada paso deberá solicitar únicamente la información necesaria en el momento adecuado.

Priorizar paneles laterales, tarjetas, buscadores inteligentes y ventanas contextuales.

Reducir la carga cognitiva del usuario.

El objetivo es que un educador pueda registrar una actividad completa en menos de un minuto desde un dispositivo móvil, manteniendo una experiencia moderna, rápida y altamente intuitiva.

Además, el sistema deberá diseñarse considerando que en futuras iteraciones la captura de información será completamente dinámica, basada en configuraciones definidas desde el módulo de Administración, evitando reglas fijas dentro del código y permitiendo que la plataforma evolucione sin necesidad de realizar cambios estructurales.
