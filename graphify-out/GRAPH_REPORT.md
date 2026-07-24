# Graph Report - .  (2026-07-22)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1340 nodes · 3538 edges · 61 communities (59 shown, 2 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.61)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f6fc06af`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- tipos.ts
- FormularioVisita.tsx
- VisitaDrawer.tsx
- borradorRBAC.ts
- catalogos.js
- compilerOptions
- devDependencies
- Dashboard.tsx
- revisiones.js
- visita.js
- app.js
- PanelFlujos.tsx
- servicios.test.ts
- useArrastre.ts
- montarVistas.tsx
- Calendario.tsx
- sectores.test.tsx
- estado.js
- sync.js
- paleta.test.tsx
- fechas.js
- demo_session.py
- VentanaActividad.tsx
- datos.js
- Visita
- permisos.js
- puente.ts
- estado.test.js
- can.ts
- administracion.test.tsx
- FormularioActividad.tsx
- NivelSector.tsx
- TarjetaVisita.tsx
- MiDia.tsx
- Avisar
- storage.js
- calendarSync.ts
- ActividadSellada.tsx
- Administracion.tsx
- montarCalendario.tsx
- guardarVisitas
- BorradorCatalogo
- arranque.test.tsx
- googleCalendar.js
- appsscript.json
- evidencias.js
- rbac.test.tsx
- vistaprevia.js
- borrador.ts
- generarSW.ts
- VentanaActividad.test.tsx
- auth.js
- manifest.json
- montarDrawer.tsx
- guardarCatalogo
- tema.js
- Calendario.test.tsx
- AlmacenLocal
- espejo-completo.test.js
- useAdmin.ts
- modulos.test.js

## God Nodes (most connected - your core abstractions)
1. `Visita` - 59 edges
2. `Avisar` - 39 edges
3. `Calendario()` - 26 edges
4. `compilerOptions` - 22 edges
5. `estadoDe()` - 21 edges
6. `iniciarApp()` - 20 edges
7. `guardarVisitas()` - 20 edges
8. `postear()` - 19 edges
9. `tieneCheckIn()` - 16 edges
10. `nuevoId()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `iniciarApp()` --indirect_call--> `refrescarCalendario()`  [INFERRED]
  js/app.js → src/modules/agenda/montarCalendario.tsx
- `flujosDisponibles()` --indirect_call--> `accion()`  [INFERRED]
  js/revisiones.js → tests/paleta.test.tsx
- `AccionesRevision()` --indirect_call--> `error()`  [INFERRED]
  src/modules/revision/components/AccionesRevision.tsx → js/visita.js
- `FichaFlujo()` --indirect_call--> `campo()`  [INFERRED]
  src/modules/administracion/components/PanelFlujos.tsx → tests/paleta.test.tsx
- `pintarAccesos()` --calls--> `refrescarVistas()`  [EXTRACTED]
  js/app.js → src/app/montarVistas.tsx

## Import Cycles
- None detected.

## Communities (61 total, 2 thin omitted)

### Community 0 - "tipos.ts"
Cohesion: 0.05
Nodes (60): ponerFlujos(), comentariosDeVisita, EstadoAviso, etiquetaRangoSemana, historialDe, inicioSemana, miniaturaEvidencia, pendientesDe (+52 more)

### Community 1 - "FormularioVisita.tsx"
Cohesion: 0.06
Nodes (46): comentar(), comentariosDe(), comentariosDeVisita(), comentariosPendientes(), cuantosComentarios(), historicoDeHospital(), leerComentarios(), marcarSincronizados() (+38 more)

### Community 2 - "VisitaDrawer.tsx"
Cohesion: 0.07
Nodes (39): cancelarVisita, hiloComentarios, sesionActual, BloqueReagendar(), HistorialReagendas(), Props, CuerpoSector(), PieBorrador() (+31 more)

### Community 3 - "borradorRBAC.ts"
Cohesion: 0.10
Nodes (46): guardarRoles, guardarUsuarios, leerRBAC, BorradorRBAC, CapacidadAdmin, RolAdmin, UsuarioAdmin, Props (+38 more)

### Community 4 - "catalogos.js"
Cohesion: 0.08
Nodes (48): catalogo(), cabeceraModal(), campoTexto(), cerrarConEscape(), envolver(), limpiarError(), marcarError(), resaltar() (+40 more)

### Community 5 - "compilerOptions"
Cohesion: 0.05
Nodes (42): dist, DOM, DOM.Iterable, ES2022, node, node_modules, src, ./src/core/* (+34 more)

### Community 6 - "devDependencies"
Cohesion: 0.06
Nodes (36): happy-dom, dependencies, react, react-dom, description, devDependencies, happy-dom, @testing-library/dom (+28 more)

### Community 7 - "Dashboard.tsx"
Cohesion: 0.10
Nodes (28): consultarVisitas, ESTADOS_VISITA, etiquetaEstado, Filtro, filtroVacio, hayEquipoCargado, Indicadores, opcionesDeFiltro (+20 more)

### Community 8 - "revisiones.js"
Cohesion: 0.12
Nodes (32): candidatosDe(), conteoPendientes(), detalleRetraso(), elemento(), estaPendiente(), ETIQUETAS_RESULTADO, flujos, FLUJOS_POR_DEFECTO (+24 more)

### Community 9 - "visita.js"
Cohesion: 0.18
Nodes (27): deudaGlobal(), estadoDe(), tieneCheckIn(), tieneCheckOut(), eventosDe(), eventosPendientes(), leerEventos(), marcarSincronizados() (+19 more)

### Community 10 - "app.js"
Cohesion: 0.14
Nodes (29): actualizarDeuda(), alCambiarConexion(), alCambiarSesion(), atajoPaleta(), atajos(), cargarRevisiones(), descargarCatalogoSiSePuede(), el (+21 more)

### Community 11 - "PanelFlujos.tsx"
Cohesion: 0.15
Nodes (25): guardarFlujosAdmin, leerFlujosAdmin, BorradorFlujos, FlujoAdmin, ESTILOS, FichaFlujo(), FichaProps, PanelFlujos() (+17 more)

### Community 12 - "servicios.test.ts"
Cohesion: 0.13
Nodes (16): APPS_SCRIPT_URL, Entorno, SUPABASE_ANON_KEY, SUPABASE_URL, TIMEOUT_MS, verificarClaveAnonima(), obtenerToken(), ProveedorDeToken (+8 more)

### Community 13 - "useArrastre.ts"
Cohesion: 0.20
Nodes (23): LineaAhora(), altoDeHoraPx(), clonarFantasma(), OpcionesCreacion, OpcionesTarjeta, ponerPosicion(), useArrastreCreacion(), useArrastreTarjeta() (+15 more)

### Community 14 - "montarVistas.tsx"
Cohesion: 0.13
Nodes (19): opciones, refrescarVistas(), Shell(), ClaveModulo, Modulo, MODULOS, modulosDisponibles(), resolverModulo() (+11 more)

### Community 15 - "Calendario.tsx"
Cohesion: 0.19
Nodes (22): aplicarFiltro, claveDia, claveHoy, desdeClave, diasDeSemana, etiquetaDiaLarga, etiquetaMes, finDe (+14 more)

### Community 16 - "sectores.test.tsx"
Cohesion: 0.15
Nodes (16): origenes, ChipsOrigen(), Paso, PasoCompletar(), PasoElegir(), VentanaSector(), abrirSector(), filtrarSectores() (+8 more)

### Community 17 - "estado.js"
Cohesion: 0.16
Nodes (23): actividadesGuardadasDe(), buscarSolapes(), detalleEstado(), duracionHoras(), duracionTexto(), ESTADOS, estadoSector(), estaEnCurso() (+15 more)

### Community 18 - "sync.js"
Cohesion: 0.18
Nodes (24): evidenciasLocales(), fusionarEstrategiasEquipo(), leerEstrategias(), todasLasActividades(), blobABase64(), descargarEstrategiasEquipo(), descargarRevisiones(), descargarVisitasEquipo() (+16 more)

### Community 19 - "paleta.test.tsx"
Cohesion: 0.14
Nodes (17): AccionPaleta, AtajoPaleta, Opcion, Paleta(), Props, acciones, atajos, cerrarPaleta() (+9 more)

### Community 20 - "fechas.js"
Cohesion: 0.15
Nodes (15): claveDia(), claveHoy(), desdeClave(), DIAS, DIAS_ABREV, DIAS_CORTOS, diasDeCuadriculaMes(), diasDeSemana() (+7 more)

### Community 21 - "demo_session.py"
Cohesion: 0.12
Nodes (19): interceptar_apps_script(), main(), Verifica la pantalla Administración → Accesos (Fase 1: RBAC) sin depender de una, Responde `leerRBAC`/`guardarRoles`/`guardarUsuarios` sin tocar la red real., interceptar_apps_script(), main(), Verifica la pantalla Administración → Flujos (Fase 5: flujos de revisión adminis, Responde `leerFlujos`/`guardarFlujos` sin tocar la red real. (+11 more)

### Community 22 - "VentanaActividad.tsx"
Cohesion: 0.15
Nodes (18): describirDispositivo, registrar, TIPOS_EVENTO, Sello, Sesion, VentanaActividad(), GeneradorId, selloDeActividad() (+10 more)

### Community 23 - "datos.js"
Cohesion: 0.17
Nodes (17): aplicarFiltro(), calcularIndicadores(), consultarVisitas(), FILTRO_VACIO, filtroVacio(), fuentes, hayFiltro(), indicadoresPorEducador() (+9 more)

### Community 24 - "Visita"
Cohesion: 0.12
Nodes (17): CompromisoCalendar, DIAS_ABREV, diasDeCuadriculaMes, repartirEnColumnas, SALUD, Visita, Props, ColumnaDia() (+9 more)

### Community 25 - "permisos.js"
Cohesion: 0.19
Nodes (20): cargarEquipo(), refrescarPerfil(), sesionActual(), ponerVisitasEquipo(), accesoBloqueado(), aceptarInvitacion(), actualizarPerfil(), alcance() (+12 more)

### Community 26 - "puente.ts"
Cohesion: 0.18
Nodes (19): describirUbicacion, ETIQUETAS_RESULTADO, finalizarVisita, iniciarVisita, minutosDeRetraso, OpcionesAviso, permanenciaTexto, precisionDudosa (+11 more)

### Community 27 - "estado.test.js"
Cohesion: 0.22
Nodes (11): actividad(), borrador(), checkIn(), checkOut(), momentoLocal(), sector(), visita(), visitaCompleta() (+3 more)

### Community 28 - "can.ts"
Cohesion: 0.24
Nodes (16): Perfil, Permiso, accesoBloqueado(), alcance(), can(), canAll(), canAny(), canDo() (+8 more)

### Community 29 - "administracion.test.tsx"
Cohesion: 0.15
Nodes (13): CAMPOS_ACTIVIDAD, ETIQUETAS_MODO, ModoCampo, TipoActividad, FichaProps, FichaTipo(), PanelTipos(), Props (+5 more)

### Community 30 - "FormularioActividad.tsx"
Cohesion: 0.18
Nodes (13): areas, campoEditable, camposExtra, configuracionCampos, MODOS, tiposActividad, tiposEvidencia, unidades (+5 more)

### Community 31 - "NivelSector.tsx"
Cohesion: 0.23
Nodes (14): AMBITOS, bloqueoParaActividades, estadoSector, estaGuardada, etiquetaSector, requiereEvidencia, ListaSectores(), PropsLista (+6 more)

### Community 32 - "TarjetaVisita.tsx"
Cohesion: 0.23
Nodes (15): buscarSolapes, detalleEstado, duracionHoras, duracionTexto, estadoDe, ESTADOS, hora, saludDe (+7 more)

### Community 33 - "MiDia.tsx"
Cohesion: 0.19
Nodes (11): calcularIndicadores, conteoPendientes, flujosDisponibles, indicadoresPorEducador, IndicadoresEducador, COLUMNAS, TablaEducadores(), tonoCumplimiento() (+3 more)

### Community 34 - "Avisar"
Cohesion: 0.17
Nodes (13): AMBITOS, vistaEvidencia(), OpcionesVistas, Avisar, abrirActividad(), OpcionesActividad, nuevaActividad(), Opciones (+5 more)

### Community 35 - "storage.js"
Cohesion: 0.25
Nodes (14): eliminarEstrategia(), guardarEstrategias(), historialDeCampo(), historialHospitales(), migrarSiHaceFalta(), migrarV1aV2(), migrarV2aV3(), migrarV3aV4() (+6 more)

### Community 36 - "calendarSync.ts"
Cohesion: 0.24
Nodes (12): borrarEventoVisita, CALENDAR_CLIENT_ID, conectarCalendar, intentarReconexionCalendar, sincronizarEventoVisita, tieneAccesoCalendar, reconexionUnaVezPorPestaña(), useConexionCalendar() (+4 more)

### Community 37 - "ActividadSellada.tsx"
Cohesion: 0.19
Nodes (11): campoVisible, Actividad, Material, Sector, ActividadSellada(), PropsSellada, PropsFormulario, PropsVentana (+3 more)

### Community 38 - "Administracion.tsx"
Cohesion: 0.14
Nodes (10): Administracion(), Area, AREAS, Pestana, PESTANAS, Props, GestionAccesos(), guardadas (+2 more)

### Community 39 - "montarCalendario.tsx"
Cohesion: 0.19
Nodes (10): ControlesExternos, MandosNavegacion, ModoCalendario, alAbrirVisita(), alCambiar(), alCrearEn(), initCalendario(), Mandos (+2 more)

### Community 40 - "guardarVisitas"
Cohesion: 0.16
Nodes (6): agregarVisita(), eliminarVisita(), guardarVisitas(), leerVisitas(), compromisos, montar()

### Community 41 - "BorradorCatalogo"
Cohesion: 0.18
Nodes (11): sectoresDelCatalogo, BorradorCatalogo, Props, ListaProps, PanelListas(), Props, PanelSectores(), Props (+3 more)

### Community 42 - "arranque.test.tsx"
Cohesion: 0.15
Nodes (6): arrancar(), asentar(), errores, intervalos, oyentes, raiz

### Community 43 - "googleCalendar.js"
Cohesion: 0.31
Nodes (12): borrarEventoVisita(), clienteTokenDe(), conectarCalendar(), encabezados(), eventoDeVisita(), intentarReconexionCalendar(), listarCompromisos(), recordarConexion() (+4 more)

### Community 44 - "appsscript.json"
Cohesion: 0.17
Nodes (11): dependencies, exceptionLogging, oauthScopes, runtimeVersion, timeZone, webapp, access, executeAs (+3 more)

### Community 45 - "evidencias.js"
Cohesion: 0.32
Nodes (11): adjuntarEvidencia(), comprimirImagen(), controlEvidencia(), escribirEvidencia(), nombreDeArchivo(), quitarEvidencia(), selectorArchivo(), abrirDB() (+3 more)

### Community 46 - "rbac.test.tsx"
Cohesion: 0.17
Nodes (8): olvidarPerfil(), leidas, respuestaRoles, respuestaUsuarios, rolesGuardados, usuariosGuardados, comoRevisor(), comoUsuario()

### Community 47 - "vistaprevia.js"
Cohesion: 0.40
Nodes (10): urlEvidencia(), leerArchivo(), abrirVisor(), cuerpoMiniatura(), cuerpoVisor(), esImagen(), esPDF(), esVideo() (+2 more)

### Community 48 - "borrador.ts"
Cohesion: 0.35
Nodes (8): IDS_CAMPOS, Educador, FilaProps, PanelEducadores(), conAdmin(), conCorreoDeEducador(), educadorNuevo(), sinEducador()

### Community 49 - "generarSW.ts"
Cohesion: 0.31
Nodes (5): generarSW(), listaDeAssets(), OpcionesSW, construidos, serviceWorkerGenerado()

### Community 50 - "VentanaActividad.test.tsx"
Cohesion: 0.31
Nodes (5): abrir(), anfitrion(), avisos, conActividadSellada(), visitaBase()

### Community 51 - "auth.js"
Cohesion: 0.44
Nodes (8): alCambiarSesion(), cargarGSI(), cerrarSesion(), decodificarJWT(), initAuth(), intentarRefresco(), manejarCredencial(), pintarBotonEntrada()

### Community 52 - "manifest.json"
Cohesion: 0.22
Nodes (8): background_color, display, icons, name, orientation, short_name, start_url, theme_color

### Community 53 - "montarDrawer.tsx"
Cohesion: 0.44
Nodes (8): abrirNuevaVisita(), abrirVisita(), alCambiar(), avisar(), cerrar(), cerrarVentanaHijaSiQueda(), initDrawer(), pintar()

### Community 54 - "guardarCatalogo"
Cohesion: 0.25
Nodes (4): guardarCatalogo(), descargarCatalogo(), leerCatalogos(), avisos

### Community 55 - "tema.js"
Cohesion: 0.50
Nodes (7): aplicarTema(), COLOR_BARRA, colorDeBarraActivo(), initTema(), sincronizarBarraMovil(), temaActual(), TEMAS

### Community 56 - "Calendario.test.tsx"
Cohesion: 0.32
Nodes (4): hoyISO(), montar(), montarEnMes(), visita()

### Community 58 - "espejo-completo.test.js"
Cohesion: 0.29
Nodes (5): codigo, ESPEJOS, raiz, SIN_ESPEJO_POR_DISEÑO, SOLO_POSTGRES

### Community 59 - "useAdmin.ts"
Cohesion: 0.53
Nodes (5): descargarCatalogo, guardarCatalogosAdmin, Opciones, useAdmin(), problemasDe()

## Knowledge Gaps
- **184 isolated node(s):** `timeZone`, `dependencies`, `exceptionLogging`, `runtimeVersion`, `https://www.googleapis.com/auth/spreadsheets` (+179 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Visita` connect `Visita` to `tipos.ts`, `FormularioVisita.tsx`, `VisitaDrawer.tsx`, `Dashboard.tsx`, `Calendario.tsx`, `sectores.test.tsx`, `paleta.test.tsx`, `VentanaActividad.tsx`, `puente.ts`, `FormularioActividad.tsx`, `NivelSector.tsx`, `TarjetaVisita.tsx`, `MiDia.tsx`, `Avisar`, `calendarSync.ts`, `ActividadSellada.tsx`, `guardarVisitas`, `VentanaActividad.test.tsx`, `Calendario.test.tsx`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `arrancar()` connect `arranque.test.tsx` to `app.js`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `Avisar` connect `Avisar` to `tipos.ts`, `FormularioVisita.tsx`, `VisitaDrawer.tsx`, `borradorRBAC.ts`, `calendarSync.ts`, `ActividadSellada.tsx`, `Administracion.tsx`, `montarCalendario.tsx`, `PanelFlujos.tsx`, `montarVistas.tsx`, `Calendario.tsx`, `sectores.test.tsx`, `montarDrawer.tsx`, `VentanaActividad.tsx`, `Visita`, `puente.ts`, `useAdmin.ts`, `NivelSector.tsx`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `timeZone`, `dependencies`, `exceptionLogging` to the rest of the system?**
  _184 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `tipos.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05485232067510549 - nodes in this community are weakly interconnected._
- **Should `FormularioVisita.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.061343204653622425 - nodes in this community are weakly interconnected._
- **Should `VisitaDrawer.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0672316384180791 - nodes in this community are weakly interconnected._