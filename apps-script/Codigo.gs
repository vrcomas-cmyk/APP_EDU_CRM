/**
 * Backend de la PWA "Gestor de Visitas" (DEGASA).
 *
 * Cómo publicarlo:
 *   1. Abre el MISMO proyecto de Apps Script que ya usabas (el que está pegado al documento
 *      donde se guardan las visitas).
 *   2. Pega este archivo completo (reemplaza lo que haya).
 *   3. Revisa la CONFIGURACIÓN de abajo.
 *
 *   4. PERMISOS DE DRIVE (el paso que rompe todo si se salta):
 *      Este script escribe en Drive; antes solo leía Sheets. Apps Script NO amplía los
 *      permisos solo porque cambie el código: los toma del manifiesto. Volver a autorizar
 *      sin tocarlo te vuelve a dar exactamente el mismo permiso insuficiente, y la subida
 *      falla con "No cuentas con el permiso para llamar a DriveApp.Folder.createFile".
 *
 *      a) ⚙ Configuración del proyecto → marca "Mostrar el archivo de manifiesto
 *         appsscript.json en el editor".
 *      b) Abre appsscript.json y asegúrate de que "oauthScopes" incluya:
 *              "https://www.googleapis.com/auth/spreadsheets"
 *              "https://www.googleapis.com/auth/drive.file"
 *         (hay una copia lista en apps-script/appsscript.json; si tu manifiesto ya tiene
 *          zona horaria u otras claves, solo AGREGA oauthScopes, no lo reemplaces entero).
 *
 *         "drive.file" = el script solo alcanza los archivos que él mismo crea, no el resto
 *         de tu Drive. Por eso NO puede escribir en una carpeta que hayas hecho a mano.
 *
 *      c) Guarda, selecciona la función "autorizar" y dale Ejecutar. Debe pedirte permisos
 *         DE NUEVO y mencionar Google Drive. En el registro tiene que decir
 *         "✅ Escritura en Drive OK" y "✅ Todo listo".
 *
 *      d) UNA SOLA VEZ: el registro de "autorizar" trae la URL de la carpeta que creó
 *         ("Evidencias Visitas"). Ábrela y MUÉVELA dentro de tu carpeta "Evidencias".
 *         El id no cambia, así que el script la sigue alcanzando, y a partir de ahí todo
 *         queda archivado así:
 *
 *              Evidencias/                        <- tu carpeta
 *                  Evidencias Visitas/            <- la del script, ya movida
 *                      100000 HOSPITAL X/         <- una por cliente, automáticas
 *                          foto.jpg
 *                      100001 CLINICA Y/
 *                          acta.pdf
 *
 *         Déjala en Mi unidad. Si la mueves a una unidad COMPARTIDA el script puede perder
 *         el acceso y crear otra carpeta.
 *      d) Si NO te vuelve a pedir permisos, Google está reusando el token viejo: entra a
 *         https://myaccount.google.com/permissions, quita el acceso de este proyecto y
 *         repite el paso (c).
 *
 *   5. PERMISO DE CONEXIÓN EXTERNA (el mismo problema que el de Drive, pero con otro permiso):
 *      Desde que el login verifica el id_token con Google y ahora también consulta Supabase
 *      para saber quién es admin, el script necesita "script.external_request". Si ves el
 *      error "Los permisos especificados no son suficientes para llamar a UrlFetchApp.fetch",
 *      es este paso el que falta — y NO se arregla corriendo "autorizar" ni
 *      "revisarConfiguracion": ninguna de las dos toca UrlFetchApp, así que ejecutarlas no
 *      pide este permiso aunque ya esté en el manifiesto.
 *
 *      a) Confirma que "oauthScopes" en appsscript.json incluya también:
 *              "https://www.googleapis.com/auth/script.external_request"
 *      b) Selecciona la función "probarConexionExterna" (no otra) y dale Ejecutar. Esa sí
 *         llama a UrlFetchApp, así que ahora SÍ te va a pedir el permiso nuevo. Acepta.
 *      c) El registro debe decir "✅ Conexión externa OK".
 *      d) Igual que con Drive: si no te vuelve a pedir permisos, quita el acceso en
 *         https://myaccount.google.com/permissions y repite (b).
 *
 *   6. Implementar → Gestionar implementaciones → editar la existente (icono del lápiz) →
 *      Versión: Nueva → Implementar.
 *        - Ejecutar como: Yo
 *        - Quién tiene acceso: CUALQUIER PERSONA   <-- indispensable, si no la PWA recibe 401
 *      Hay que crear versión NUEVA: la implementación sirve la versión con la que se publicó,
 *      así que guardar el código no basta.
 *      Editar la implementación existente CONSERVA la URL /exec que la PWA ya tiene. Si creas
 *      una implementación NUEVA, la URL cambia y hay que actualizar GOOGLE_SCRIPT_URL en
 *      js/sync.js.
 *
 * Dos documentos, como en la versión anterior:
 *   - Catálogos (Clientes / Materiales / Educadores): se LEEN de SHEET_DB_ID.
 *   - Visitas: se ESCRIBEN en el documento al que está pegado este script.
 *
 * Modelo de captura: cuatro pestañas nuevas.
 *   VISITAS (padre)                -> una fila por cada (visita x sector), con check-in/out.
 *   ACTIVIDADES (hija)             -> una fila por actividad, ligada al padre por id_padre.
 *   MATERIALES_CAPTURADOS (nieta)  -> una fila por material, ligada a la actividad por id_actividad.
 *   EVENTOS                        -> bitácora auditable, una fila por evento de negocio.
 *
 * Todas las escrituras son UPSERT por id: la PWA reenvía la misma visita cada vez que se
 * edita (se agenda, se ejecuta, se completa), así que insertar a ciegas duplicaría filas.
 * Por eso ya no se usa appendRow ni getActiveSheet() como antes.
 */

// ---------- CONFIGURACIÓN ----------

// Documento con los catálogos. Es OTRO archivo distinto al de las visitas.
const SHEET_DB_ID = '1g_vhnyt14oCrn8t21qPN-Jjs3r37ox1nhLAcXFjCoxk';

// Documento donde se escriben las visitas.
// '' = el documento al que está pegado este script (el comportamiento de antes).
// Si algún día el script deja de estar pegado a una hoja, pon aquí su ID.
const SHEET_VISITAS_ID = '1_HjRYIje0_yNMK3s3ACAxMG0rgOjHeSaWpJBX4u8Duc';

// Catálogos: pestaña y nombre de la columna a leer (si no se encuentra, se usa la col. A).
const HOJA_CLIENTES = 'Clientes';
const COL_CLIENTE = 'N° Cliente y Razon Social';

// Los sectores NO tienen pestaña propia: salen de los materiales, deduplicados.
const HOJA_MATERIALES = 'Materiales';
const COL_SECTOR = 'Descr. Sector';

// Educadores: col. A = nombre, col. B = correo.
const HOJA_EDUCADORES = 'Educadores';

// Pestañas de captura. Se crean solas con sus encabezados si no existen.
const HOJA_VISITAS = 'Visitas';
const HOJA_ACTIVIDADES = 'Actividades';
const HOJA_MATERIALES_CAPTURA = 'Materiales_Capturados';
const HOJA_EVENTOS = 'Eventos';
const HOJA_COMENTARIOS = 'Comentarios';
const HOJA_REVISIONES = 'Revisiones';

// Catálogo de materiales que lee el buscador de la app (filtrado por sector).
const COL_MATERIAL = 'Material y Nombre';

// Carpeta raíz de las evidencias. Dentro, el script crea una subcarpeta por cliente.
//
// DÉJALO VACÍO. Con el permiso "drive.file" el script solo alcanza los archivos que él mismo
// crea: si pones aquí el id de una carpeta hecha a mano (como "Evidencias") no podrá abrirla.
// La crea sola la primera vez; luego TÚ la mueves dentro de "Evidencias" y listo (ver el
// paso 4d de arriba).
//
// Solo tiene sentido llenarlo si vuelves al permiso "drive" completo.
const CARPETA_EVIDENCIAS_ID = '1cMtdFG2lNFYa_Q3HqdqFGmrHV_DIRDbq';

// Nombre de la carpeta que crea el script la primera vez.
const NOMBRE_CARPETA_EVIDENCIAS = 'Evidencias Visitas';

// Donde se guarda el id de esa carpeta, para no depender de buscarla por nombre.
const PROP_CARPETA = 'CARPETA_EVIDENCIAS_ID';

// Prefijo de las propiedades que recuerdan la subcarpeta de cada cliente.
const PROP_CLIENTE = 'CARPETA_CLIENTE_';

// Catálogos nuevos. Si las pestañas no existen, la PWA usa sus valores por defecto.
const HOJA_TIPOS = 'TiposActividad';
const HOJA_ORIGENES = 'Origenes';
const HOJA_ADMINS = 'Admins';
const HOJA_AREAS = 'Areas';
const HOJA_UNIDADES = 'Unidades';
const HOJA_TIPOS_EVIDENCIA = 'TiposEvidencia';

// Sectores que Administración decidió NO ofrecer. Se guarda la lista de EXCLUIDOS y no la de
// activos a propósito: los sectores salen de la hoja de Materiales, que cambia sola cuando
// Comercial da de alta producto. Guardando los activos, cada sector nuevo nacería invisible
// hasta que alguien se acordara de encenderlo; guardando los ocultos, nace disponible.
const HOJA_SECTORES_OCULTOS = 'SectoresOcultos';

// Un renglón por (tipo, campo): qué pide cada tipo de actividad. Es la tabla que arma los
// formularios de la PWA. Se guarda así —y no como JSON en una celda— para que siga siendo
// legible y editable a mano desde la hoja, como el resto de los catálogos.
const HOJA_CAMPOS = 'CamposActividad';

// ---------- IDENTIDAD (Google Sign-In) ----------
//
// La PWA manda el id_token que le dio Google Identity Services en cada escritura. Confiar en
// el correo que MANDA EL CLIENTE sería aceptar la palabra de quien sea: cualquiera con las
// herramientas de desarrollador puede escribir el JSON que quiera. Este script llama a Google
// para que verifique la firma y devuelva los datos ya validados — es la app la que no confía,
// no el usuario.

// El mismo Client ID configurado en js/auth.js. Si no coincide con el "aud" del token, alguien
// mandó un token de OTRA aplicación.
const CLIENT_ID = '698264876096-35bqu62bnsfb7v8tnph6m8p7pr7v56r9.apps.googleusercontent.com';

// Solo cuentas de este dominio pueden escribir. Déjalo vacío ('') para aceptar cualquier
// cuenta de Google verificada (no recomendado fuera de pruebas).
const DOMINIO_PERMITIDO = 'degasa.com';

// El rol de administrador vive en Supabase (tabla pdt_admins, vista solo a través de este RPC
// que expone nada más un booleano por correo). El resto de la sincronización —visitas,
// actividades, materiales, eventos, catálogos— se queda igual, en Sheets.
const SUPABASE_URL = 'https://fiplfsuhsqibzrpvjvbx.supabase.co';

/**
 * Clave de SERVICIO de Supabase. NO se escribe aquí: vive en las propiedades del proyecto.
 *
 *   Configuración del proyecto → Propiedades del script → Agregar
 *   Propiedad: SUPABASE_SERVICE_KEY
 *   Valor:     la "service_role secret" del panel de Supabase (Settings → API)
 *
 * Va en el servidor y no en la PWA porque el service_role SALTA las políticas de seguridad
 * por fila. Si viajara en el bundle de la app, cualquiera podría leer las visitas de
 * cualquier educador. Apps Script sí puede guardarla: nadie ve su código.
 *
 * Si la propiedad no está, el espejo simplemente no se escribe y la app sigue funcionando
 * igual que antes contra Sheets. El espejo es un extra, no un requisito.
 */
const PROP_SUPABASE_KEY = 'SUPABASE_SERVICE_KEY';

function claveServicioSupabase() {
    return PropertiesService.getScriptProperties().getProperty(PROP_SUPABASE_KEY) || '';
}

/**
 * Llama a una función de Postgres. Devuelve el JSON o null si algo falló.
 *
 * NUNCA lanza: el espejo no puede tumbar una sincronización. Si Supabase no responde, la
 * visita ya quedó en Sheets —que es la fuente operativa— y el espejo se pone al día en el
 * siguiente envío, porque la PWA reenvía toda visita que siga marcada como no sincronizada.
 */
function supabaseRPC(funcion, carga) {
    var clave = claveServicioSupabase();
    if (!clave) return null;

    try {
        var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + funcion, {
            method: 'post',
            contentType: 'application/json',
            headers: { apikey: clave, Authorization: 'Bearer ' + clave },
            payload: JSON.stringify(carga),
            muteHttpExceptions: true
        });
        if (resp.getResponseCode() !== 200) {
            Logger.log('Supabase %s respondió %s: %s',
                       funcion, resp.getResponseCode(), resp.getContentText());
            return null;
        }
        return JSON.parse(resp.getContentText());
    } catch (err) {
        Logger.log('Supabase %s falló: %s', funcion, err);
        return null;
    }
}

/**
 * Como `supabaseRPC`, pero DEVUELVE EL ERROR en vez de tragárselo.
 *
 * `supabaseRPC` calla a propósito: la visita ya quedó en Sheets, así que un Supabase caído no
 * puede tumbar una captura y el espejo se pone al día en el siguiente envío. Ese razonamiento
 * depende por completo de que exista una copia en la hoja.
 *
 * Los roles no tienen esa copia: viven SOLO en Postgres, porque una hoja no puede sostener
 * herencia entre roles ni impedir que se conceda una capacidad inexistente. Sin red debajo,
 * callar el fallo sería lo peor que se puede hacer — el administrador vería «guardado», nada
 * habría cambiado, y el registro de permisos diría una cosa mientras la aplicación hace otra.
 *
 * Además, aquí el mensaje de Postgres ES la respuesta útil: «ese cambio dejaría la instalación
 * sin ningún administrador» es exactamente lo que hay que enseñar en pantalla, y `supabaseRPC`
 * lo convertiría en un `null` mudo.
 *
 * Devuelve { ok, datos, error }.
 */
function supabaseRPCEstricto(funcion, carga) {
    var clave = claveServicioSupabase();
    if (!clave) {
        return { ok: false, error: 'Supabase no está configurado en este script (falta '
                                 + PROP_SUPABASE_KEY + ').' };
    }

    try {
        var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + funcion, {
            method: 'post',
            contentType: 'application/json',
            headers: { apikey: clave, Authorization: 'Bearer ' + clave },
            payload: JSON.stringify(carga),
            muteHttpExceptions: true
        });

        var texto = resp.getContentText();
        if (resp.getResponseCode() !== 200) {
            // Postgres manda su `raise exception` en `message`. Es un texto escrito para que
            // lo lea una persona, así que se pasa tal cual en vez de resumirlo.
            var detalle = texto;
            try { detalle = JSON.parse(texto).message || texto; } catch (e) {}
            return { ok: false, error: detalle };
        }
        return { ok: true, datos: JSON.parse(texto) };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpcGxmc3Voc3FpYnpycHZqdmJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyODAyNjgsImV4cCI6MjA4OTg1NjI2OH0.YG3Fk8XJ_n9PGIYUHtoiy-MJNuWqJTsFBwooKnt1X5s';

/**
 * Columnas de captura — modelo v4.
 *
 * OJO si vienes de la versión anterior (v3): cambiaron otra vez. Ya no hay `solicitado_por`
 * (no existe en v4), y entran check-in/check-out con GPS, dirección aproximada y permanencia.
 * `Actividades` pierde el texto libre y `materiales`/`folio`/`gerente`: el detalle ahora es
 * tipo + área visitada + contacto, y los materiales viven en su propia pestaña.
 *
 * Las pestañas viejas NO se migran solas —tienen otro orden de columnas— así que hay que
 * renombrarlas a "*_anterior" y dejar que el script cree las nuevas. El error que verás te lo
 * dice con nombre y apellido.
 */
const ENCABEZADOS_VISITAS = [
    'id_padre', 'id_visita', 'educador', 'correo', 'cliente', 'hospital',
    'dia', 'hora_inicio', 'hora_fin', 'sector', 'objetivo', 'origen',
    'estado', 'motivo_cancelacion',
    'checkin_momento', 'checkin_lat', 'checkin_lng', 'checkin_precision_m', 'checkin_direccion',
    'checkin_usuario', 'checkin_dispositivo', 'checkin_sin_ubicacion',
    'checkout_momento', 'checkout_lat', 'checkout_lng', 'checkout_precision_m', 'checkout_direccion',
    'checkout_usuario', 'checkout_sin_ubicacion',
    'permanencia_min', 'reagendas', 'actualizado',
    // Se agregan AL FINAL, nunca junto a la columna con la que se leen. `obtenerHoja` exige
    // que las columnas ya existentes coincidan en nombre Y posición: meter una en medio haría
    // tronar la sincronización de todas las hojas que ya están en producción.
    'solicitado_por', 'sector_guardado_momento', 'sector_guardado_usuario'
];

const ENCABEZADOS_ACTIVIDADES = [
    'id_actividad', 'id_padre', 'id_visita', 'sector', 'tipo', 'area_visitada',
    'contacto_nombre', 'contacto_cargo', 'contacto_servicio',
    'evidencia_url', 'evidencia_estado', 'creada', 'actualizado',
    // El sello de guardado. La PWA solo manda actividades selladas, así que estas tres nunca
    // deberían llegar vacías; si alguna lo está, esa fila viene de datos migrados.
    'guardada_momento', 'guardada_usuario', 'guardada_dispositivo'
];

const ENCABEZADOS_MATERIALES_CAPTURA = [
    'id_material', 'id_actividad', 'id_padre', 'id_visita', 'sector',
    'material', 'cantidad', 'unidad', 'origen', 'actualizado'
];

// Un comentario es inmutable: se inserta y no se vuelve a tocar. Las columnas guardan a qué
// se refiere (ámbito + id) y también cliente/hospital, para poder responder "¿qué se ha dicho
// de este hospital?" sin recorrer el árbol completo de visitas.
const ENCABEZADOS_COMENTARIOS = [
    'id', 'momento', 'ambito', 'id_ambito', 'id_visita',
    'cliente', 'hospital', 'usuario', 'usuario_correo', 'texto', 'actualizado'
];

// Auditoría de revisiones. Se escribe también en Sheets —no solo en Supabase— porque la
// hoja sigue siendo la capa operativa: quien audita hoy lo hace ahí.
const ENCABEZADOS_REVISIONES = [
    'id', 'momento', 'flujo', 'ambito', 'id_ambito', 'id_visita',
    'educador_correo', 'resultado', 'observaciones',
    'revisor', 'revisor_correo', 'actualizado'
];

const ENCABEZADOS_EVENTOS = [
    'id', 'tipo', 'momento', 'id_visita', 'cliente', 'hospital',
    'educador', 'educador_correo', 'dispositivo', 'datos', 'actualizado'
];

// ---------- ENTRADA HTTP ----------

function doGet() {
    try {
        var db = SpreadsheetApp.openById(SHEET_DB_ID);
        return json({
            educadores: leerEducadores(db),
            sectores: leerSectores(db),
            clientes: leerClientes(db),
            // Si estas pestañas no existen todavía, van vacías y la PWA usa sus valores
            // por defecto: la app funciona desde el primer día, sin configurar nada.
            tipos_actividad: leerTipos(),
            origenes: leerOrigenes(db),
            areas: leerAreas(db),
            unidades: leerUnidades(db),
            tipos_evidencia: leerTiposEvidencia(db),
            sectores_ocultos: leerSectoresOcultos(db),
            admins: leerAdmins(db),
            materiales: leerMateriales(db)
        });
    } catch (err) {
        return json({ status: 'error', message: String(err) });
    }
}

// Todas las escrituras requieren identidad verificada. Antes esto era anónimo por diseño
// (el webapp es "CUALQUIER PERSONA" para que la PWA no necesite un OAuth propio); ahora la
// identidad viaja en el body en vez de en el webapp, y este script la valida él mismo.
var ACCIONES_CON_IDENTIDAD = ['guardarVisitas', 'subirEvidencia', 'guardarEventos',
                              'guardarCatalogosAdmin', 'guardarComentarios',
                              'leerVisitasEquipo', 'guardarRevisiones', 'leerRevisiones',
                              'leerRBAC', 'guardarRoles', 'guardarUsuarios'];

function doPost(e) {
    // La PWA manda Content-Type: text/plain para evitar el preflight OPTIONS,
    // que Apps Script no sabe responder. Por eso el body llega crudo aquí.
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        var body = JSON.parse(e.postData.contents);

        var identidad = null;
        if (ACCIONES_CON_IDENTIDAD.indexOf(body.action) !== -1) {
            identidad = verificarIdentidad(body.id_token);
            if (!identidad.ok) return json({ status: 'error', message: identidad.error });
        }

        switch (body.action) {
            case 'guardarVisitas':
                return json(guardarVisitas(body.visitas || [], identidad));
            case 'subirEvidencia':
                return json(subirEvidencia(body));
            case 'guardarEventos':
                return json(guardarEventos(body.eventos || [], identidad));
            case 'leerVisitasEquipo':
                return json(leerVisitasEquipo(body, identidad));
            case 'guardarRevisiones':
                return json(guardarRevisiones(body.revisiones || [], identidad));
            case 'leerRevisiones':
                return json(leerRevisiones(identidad));
            case 'guardarComentarios':
                return json(guardarComentarios(body.comentarios || [], identidad));
            case 'guardarCatalogosAdmin':
                return json(guardarCatalogosAdmin(body, identidad));
            case 'leerRBAC':
                return json(leerRBAC(identidad));
            case 'guardarRoles':
                return json(guardarRoles(body, identidad));
            case 'guardarUsuarios':
                return json(guardarUsuarios(body, identidad));
            default:
                return json({ status: 'error', message: 'action desconocida: ' + body.action });
        }
    } catch (err) {
        return json({ status: 'error', message: String(err) });
    } finally {
        lock.releaseLock();
    }
}

/**
 * Le pide a Google que verifique el id_token: firma, expiración y a quién pertenece.
 * Es más simple que validar la firma RS256 a mano (Apps Script no trae una librería de
 * criptografía lista para eso) y es el propio método que documenta Google para volúmenes
 * bajos como este. Nunca deja pasar nada sin marcar 'ok: true' explícitamente.
 */
function verificarIdentidad(idToken) {
    if (!idToken) return { ok: false, error: 'Sesión no encontrada. Vuelve a iniciar sesión.' };

    var resp;
    try {
        resp = UrlFetchApp.fetch(
            'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
            { muteHttpExceptions: true }
        );
    } catch (err) {
        return { ok: false, error: 'No se pudo verificar la sesión: ' + err };
    }

    if (resp.getResponseCode() !== 200) {
        return { ok: false, error: 'Tu sesión expiró. Vuelve a iniciar sesión.' };
    }

    var datos = JSON.parse(resp.getContentText());
    if (datos.aud !== CLIENT_ID) return { ok: false, error: 'Token de otra aplicación.' };
    if (String(datos.email_verified) !== 'true') {
        return { ok: false, error: 'Tu correo no está verificado por Google.' };
    }

    var correo = String(datos.email || '').toLowerCase();
    var dominio = correo.slice(correo.indexOf('@') + 1);
    if (DOMINIO_PERMITIDO && dominio !== DOMINIO_PERMITIDO) {
        return { ok: false, error: 'Solo cuentas @' + DOMINIO_PERMITIDO + ' pueden usar esta app.' };
    }

    return { ok: true, correo: correo, nombre: datos.name || correo };
}

function json(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// ---------- CATÁLOGOS ----------
// Se leen del documento SHEET_DB_ID, no del de las visitas.

/** Valores únicos y no vacíos de una columna buscada por su encabezado. */
function leerColumnaUnica(db, nombreHoja, nombreColumna) {
    var hoja = db.getSheetByName(nombreHoja);
    if (!hoja) return [];

    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return [];

    var col = datos[0].indexOf(nombreColumna);
    if (col === -1) col = 0; // por si el encabezado cambió de texto

    var vistos = {};
    var salida = [];

    for (var i = 1; i < datos.length; i++) {
        var valor = String(datos[i][col]).trim();
        // El catálogo de clientes trae repetidos; duplicarlos en el datalist no sirve de nada.
        if (valor !== '' && !vistos[valor]) {
            vistos[valor] = true;
            salida.push(valor);
        }
    }
    return salida;
}

function leerClientes(db) {
    return leerColumnaUnica(db, HOJA_CLIENTES, COL_CLIENTE);
}

/** Los sectores son las líneas de producto de "Materiales", sin repetir. */
function leerSectores(db) {
    return leerColumnaUnica(db, HOJA_MATERIALES, COL_SECTOR);
}

/**
 * Catálogo de materiales para el buscador de la app, filtrado por sector.
 * Misma pestaña que `leerSectores` (HOJA_MATERIALES = 'Materiales'), pero aquí se conserva
 * cada fila —no se deduplica— porque cada una es un material distinto.
 */
function leerMateriales(db) {
    var hoja = db.getSheetByName(HOJA_MATERIALES);
    if (!hoja) return [];

    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return [];

    var iMaterial = datos[0].indexOf(COL_MATERIAL);
    var iSector = datos[0].indexOf(COL_SECTOR);
    if (iMaterial === -1 || iSector === -1) return [];

    var salida = [];
    for (var i = 1; i < datos.length; i++) {
        var material = String(datos[i][iMaterial]).trim();
        if (material === '') continue;
        salida.push({ material: material, sector: String(datos[i][iSector]).trim() });
    }
    return salida;
}

/**
 * Tipos de actividad CON SUS REGLAS. No es una lista de textos: cada fila declara qué campos
 * exige, y con eso la app arma el formulario de campo.
 *
 * Pestaña "TiposActividad":
 *   tipo | evidencia | materiales | folio | gerente     (sí/no, x, true, 1… todo cuenta)
 *
 * Se cachea: guardarVisitas la consulta una vez por actividad, y abrir el documento cada
 * vez haría la sincronización lentísima.
 */
var _tiposCache = null;

function leerTipos() {
    if (_tiposCache) return _tiposCache;

    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    var hoja = db.getSheetByName(HOJA_TIPOS);
    if (!hoja || hoja.getLastRow() < 2) return (_tiposCache = []);

    var campos = leerCamposActividad(db);

    var datos = hoja.getDataRange().getValues();
    var col = function (nombre) { return datos[0].indexOf(nombre); };
    var iTipo = col('tipo') === -1 ? 0 : col('tipo');
    var iEvid = col('evidencia'), iMat = col('materiales'), iFol = col('folio'), iGer = col('gerente');

    _tiposCache = [];
    for (var i = 1; i < datos.length; i++) {
        var nombre = String(datos[i][iTipo]).trim();
        if (!nombre) continue;
        _tiposCache.push({
            nombre: nombre,
            evidencia: siNo(datos[i][iEvid], true),   // por defecto SÍ pide evidencia
            materiales: siNo(datos[i][iMat], false),
            folio: siNo(datos[i][iFol], false),
            gerente: siNo(datos[i][iGer], false),
            campos: campos[nombre] || {}
        });
    }
    return _tiposCache;
}

/** Acepta lo que la gente escribe de verdad en una hoja: sí, x, TRUE, 1, ✔… */
function siNo(valor, porDefecto) {
    if (valor === undefined || valor === null || valor === '') return porDefecto;
    if (valor === true) return true;
    if (valor === false) return false;
    var t = String(valor).trim().toLowerCase();
    return ['si', 'sí', 'x', 'true', 'verdadero', '1', 'y', 'yes', '✔', '✓'].indexOf(t) !== -1;
}

function leerOrigenes(db) {
    return leerColumnaUnica(db, HOJA_ORIGENES, 'origen');
}

function leerAreas(db) {
    return leerColumnaUnica(db, HOJA_AREAS, 'area');
}

function leerUnidades(db) {
    return leerColumnaUnica(db, HOJA_UNIDADES, 'unidad');
}

function leerTiposEvidencia(db) {
    return leerColumnaUnica(db, HOJA_TIPOS_EVIDENCIA, 'tipo_evidencia');
}

function leerSectoresOcultos(db) {
    return leerColumnaUnica(db, HOJA_SECTORES_OCULTOS, 'sector');
}

/**
 * Configuración de campos: { 'Capacitación': { area_visitada: 'obligatorio', ... }, ... }
 *
 * Lo que no esté aquí la PWA lo resuelve con sus defaults, así que una pestaña vacía o
 * inexistente NO deja los formularios sin campos: los deja como venían.
 */
function leerCamposActividad(db) {
    var hoja = db.getSheetByName(HOJA_CAMPOS);
    if (!hoja || hoja.getLastRow() < 2) return {};

    var datos = hoja.getDataRange().getValues();
    var col = function (nombre) { return datos[0].indexOf(nombre); };
    var iTipo = col('tipo'), iCampo = col('campo'), iModo = col('modo');
    if (iTipo === -1 || iCampo === -1 || iModo === -1) return {};

    var salida = {};
    for (var i = 1; i < datos.length; i++) {
        var tipo = String(datos[i][iTipo]).trim();
        var campo = String(datos[i][iCampo]).trim();
        var modo = String(datos[i][iModo]).trim().toLowerCase();
        if (!tipo || !campo || !modo) continue;
        if (!salida[tipo]) salida[tipo] = {};
        salida[tipo][campo] = modo;
    }
    return salida;
}

/** Correos con acceso al módulo de administración. */
function leerAdmins(db) {
    return leerColumnaUnica(db, HOJA_ADMINS, 'correo').map(function (c) {
        return c.toLowerCase();
    });
}

function leerEducadores(db) {
    var hoja = db.getSheetByName(HOJA_EDUCADORES);
    if (!hoja) return [];

    var datos = hoja.getDataRange().getValues();
    var salida = [];

    for (var i = 1; i < datos.length; i++) {
        if (String(datos[i][0]).trim() === '') continue;
        salida.push({
            nombre: String(datos[i][0]).trim(),
            correo: String(datos[i][1] || '').trim()
        });
    }
    return salida;
}

// ---------- UPSERT DE VISITAS ----------

/**
 * Recibe el árbol de visitas de la PWA (modelo v4) y lo aplana en tres pestañas: Visitas
 * (padre = visita x sector), Actividades (hija) y Materiales_Capturados (nieta).
 * Devuelve los ids procesados para que la app marque lo sincronizado.
 */
function guardarVisitas(visitas, identidad) {
    var hojaVisitas = obtenerHoja(HOJA_VISITAS, ENCABEZADOS_VISITAS);
    var hojaActividades = obtenerHoja(HOJA_ACTIVIDADES, ENCABEZADOS_ACTIVIDADES);
    var hojaMateriales = obtenerHoja(HOJA_MATERIALES_CAPTURA, ENCABEZADOS_MATERIALES_CAPTURA);

    var filasPadre = [];
    var filasHija = [];
    var filasMateriales = [];
    var ahora = new Date();

    visitas.forEach(function (visita) {
        // El estado ya no se deriva: es un dato que manda la app (programada/en-proceso/
        // finalizada/cancelada). La hoja registra lo que pasó, no lo recalcula.
        var estado = visita.estado || 'programada';
        var checkIn = visita.check_in || {};
        var checkOut = visita.check_out || {};
        var permanencia = permanenciaMinutos(checkIn, checkOut);

        (visita.sectores || []).forEach(function (sector) {
            var idPadre = visita.id + '::' + sector.id;

            filasPadre.push({
                id: idPadre,
                valores: [
                    // El correo SIEMPRE es el de la identidad verificada, nunca el que mande
                    // el cliente: es la garantía real de que "quién" no se puede falsificar
                    // editando el localStorage. El nombre sí puede venir de ahí de respaldo.
                    idPadre, visita.id, identidad.nombre || visita.educador || '', identidad.correo,
                    visita.cliente || '', visita.hospital || '',
                    visita.dia || '', visita.hora_inicio || '', visita.hora_fin || '',
                    sector.nombre || '', sector.objetivo || '', (sector.origen || []).join(', '),
                    estado, visita.motivo_cancelacion || '',
                    checkIn.momento || '', checkIn.lat != null ? checkIn.lat : '',
                    checkIn.lng != null ? checkIn.lng : '', checkIn.precision_m != null ? checkIn.precision_m : '',
                    direccionDe(checkIn), checkIn.usuario || '', checkIn.dispositivo || '',
                    checkIn.error || '',
                    checkOut.momento || '', checkOut.lat != null ? checkOut.lat : '',
                    checkOut.lng != null ? checkOut.lng : '', checkOut.precision_m != null ? checkOut.precision_m : '',
                    direccionDe(checkOut), checkOut.usuario || '', checkOut.error || '',
                    permanencia != null ? permanencia : '', (visita.reagendas || []).length, ahora,
                    sector.solicitado_por || '',
                    (sector.guardado || {}).momento || '', (sector.guardado || {}).usuario || ''
                ]
            });

            (sector.actividades || []).forEach(function (act) {
                var contacto = act.contacto || {};
                var evidencia = act.evidencia || {};
                var sello = act.guardada || {};

                filasHija.push({
                    id: act.id,
                    valores: [
                        act.id, idPadre, visita.id, sector.nombre || '',
                        act.tipo || '', act.area_visitada || '',
                        contacto.nombre || '', contacto.cargo || '', contacto.servicio || '',
                        evidencia.url || '', evidencia.estado || '',
                        act.creada || '', ahora,
                        sello.momento || '', sello.usuario || '', sello.dispositivo || ''
                    ]
                });

                (act.materiales || []).forEach(function (mat) {
                    filasMateriales.push({
                        id: mat.id,
                        valores: [
                            mat.id, act.id, idPadre, visita.id, sector.nombre || '',
                            mat.material || '', mat.cantidad || '', mat.unidad || '',
                            mat.origen || '', ahora
                        ]
                    });
                });
            });
        });
    });

    // Estas columnas se preservan: la app suele mandarlas vacías (evidencia sube después,
    // dirección se cachea aquí) y un re-sync sin esto borraría lo que ya está en la hoja.
    upsert(hojaVisitas, ENCABEZADOS_VISITAS, filasPadre, ['checkin_direccion', 'checkout_direccion']);
    upsert(hojaActividades, ENCABEZADOS_ACTIVIDADES, filasHija, ['evidencia_url', 'evidencia_estado']);
    upsert(hojaMateriales, ENCABEZADOS_MATERIALES_CAPTURA, filasMateriales, []);

    // ESPEJO. Va DESPUÉS de escribir en Sheets y a propósito: Sheets es la fuente operativa
    // y no debe depender de que Supabase esté arriba. Si el espejo falla, la visita sigue
    // marcada como no sincronizada en la PWA y se reintenta sola en el siguiente envío.
    var espejo = supabaseRPC('pdt_espejo_guardar', {
        p_correo: identidad.correo,
        p_visitas: visitas
    });

    return {
        status: 'ok',
        espejo: espejo !== null,
        ids: visitas.map(function (v) { return v.id; }),
        padres: filasPadre.length,
        actividades: filasHija.length,
        materiales: filasMateriales.length
    };
}

/** Minutos entre check-in y check-out. null si falta cualquiera de los dos momentos. */
function permanenciaMinutos(checkIn, checkOut) {
    if (!checkIn.momento || !checkOut.momento) return null;
    var ms = new Date(checkOut.momento).getTime() - new Date(checkIn.momento).getTime();
    return Math.round(ms / 60000);
}

/** Dirección aproximada de un check: la que ya trae la app, o geocodificada aquí y cacheada. */
function direccionDe(check) {
    if (check.direccion) return check.direccion;
    if (check.lat == null || check.lng == null) return '';
    return direccionAprox(check.lat, check.lng);
}

/**
 * Convierte lat/lng en una dirección legible con el servicio Maps de Apps Script.
 * Se cachea por coordenada (redondeada a ~1m) en ScriptProperties: evita gastar cuota de
 * Maps re-geocodificando la misma visita en cada sincronización.
 *
 * NUNCA lanza: si Maps falla, no hay cuota o no hay red, se devuelve '' y la sincronización
 * de visitas sigue su curso. La dirección es un dato de cortesía, no un requisito.
 */
function direccionAprox(lat, lng) {
    var clave = 'GEOCODE_' + lat.toFixed(5) + '_' + lng.toFixed(5);
    var props = PropertiesService.getScriptProperties();

    var cacheada = props.getProperty(clave);
    if (cacheada !== null) return cacheada; // incluye '' cacheado (ya se intentó y no hubo resultado)

    var direccion = '';
    try {
        var resultado = Maps.newGeocoder().reverseGeocode(lat, lng);
        if (resultado && resultado.results && resultado.results.length > 0) {
            direccion = resultado.results[0].formatted_address || '';
        }
    } catch (err) {
        console.warn('Geocodificación falló para ' + lat + ',' + lng + ': ' + err);
    }

    props.setProperty(clave, direccion);
    return direccion;
}

/** Upsert de eventos auditables. Son inmutables: esto solo hace idempotente un reenvío. */
function guardarEventos(eventos, identidad) {
    var hoja = obtenerHoja(HOJA_EVENTOS, ENCABEZADOS_EVENTOS);
    var ahora = new Date();

    var filas = eventos.map(function (ev) {
        return {
            id: ev.id,
            valores: [
                ev.id, ev.tipo || '', ev.momento || '', ev.id_visita || '',
                ev.cliente || '', ev.hospital || '',
                identidad.nombre || ev.educador || '', identidad.correo,
                ev.dispositivo || '', JSON.stringify(ev.datos || {}), ahora
            ]
        };
    });

    upsert(hoja, ENCABEZADOS_EVENTOS, filas, []);

    // ESPEJO. Después de Sheets y a propósito: la hoja es la fuente operativa y no debe
    // depender de que Supabase esté arriba. Si falla, los eventos siguen marcados como no
    // sincronizados en la PWA y se reintentan solos en el siguiente envío.
    var espejo = supabaseRPC('pdt_eventos_guardar', {
        p_educador_correo: identidad.correo,
        p_educador: identidad.nombre || '',
        p_eventos: eventos
    });

    return {
        status: 'ok',
        espejo: espejo !== null,
        ids: eventos.map(function (e) { return e.id; })
    };
}

/**
 * Reemplaza los catálogos administrables (Tipos de actividad, Orígenes, Educadores, Admins).
 * Gated por identidad: solo un correo que YA esté en la hoja "Admins" puede llamar esto. Es
 * un reemplazo completo, no un upsert por fila — son catálogos de decenas de filas como mucho,
 * y el módulo admin siempre manda la lista entera, así que un upsert parcial solo complicaría
 * borrar algo (¿cómo le dices al upsert "esta fila ya no debe existir"?).
 */
/**
 * Visitas del EQUIPO, leídas del espejo de Supabase.
 *
 * Pasa por aquí y no directo desde la PWA por una razón concreta: la app solo tiene la clave
 * anónima, que es pública —viaja en su propio JavaScript—. Con ella, cualquiera podría pedir
 * las visitas de cualquier correo. Aquí la identidad ya fue verificada contra Google, así que
 * el correo que se le pasa a Postgres es real y el recorte por jerarquía significa algo.
 */
function leerVisitasEquipo(body, identidad) {
    var datos = supabaseRPC('pdt_visitas_en_alcance', {
        p_correo: identidad.correo,
        p_desde: body.desde || null,
        p_hasta: body.hasta || null,
        p_limite: body.limite || 2000
    });

    if (datos === null) {
        return {
            status: 'ok', visitas: [], espejo: false,
            mensaje: 'El espejo no está configurado o no respondió.'
        };
    }
    return { status: 'ok', visitas: datos, espejo: true };
}

/**
 * Registra revisiones. Va a Supabase Y a Sheets: la hoja es la capa operativa y es donde
 * hoy se audita, y Supabase es lo que permite consultar por jerarquía sin repartir la hoja.
 *
 * El revisor lo impone el servidor con la identidad verificada. Lo que el cliente diga en
 * ese campo se ignora: si no, cualquiera podría firmar una aprobación a nombre de su jefe.
 */
function guardarRevisiones(revisiones, identidad) {
    if (revisiones.length === 0) return { status: 'ok', ids: [] };

    var espejo = supabaseRPC('pdt_revision_guardar', {
        p_revisor_correo: identidad.correo,
        p_revisor: identidad.nombre || '',
        p_revisiones: revisiones
    });

    var hoja = obtenerHoja(HOJA_REVISIONES, ENCABEZADOS_REVISIONES);
    var ahora = new Date();

    // Los ids ya escritos: un reenvío tras falla de red no debe duplicar la auditoría.
    var existentes = {};
    if (hoja.getLastRow() > 1) {
        var previos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < previos.length; i++) existentes[String(previos[i][0])] = true;
    }

    var filas = [];
    revisiones.forEach(function (r) {
        if (!r || !r.id || existentes[String(r.id)]) return;
        filas.push([
            r.id, r.momento || '', r.flujo || '', r.ambito || '', r.id_ambito || '',
            r.id_visita || '', r.educador_correo || '', r.resultado || '',
            r.observaciones || '',
            identidad.nombre || '', identidad.correo, ahora
        ]);
    });

    if (filas.length > 0) {
        hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, ENCABEZADOS_REVISIONES.length)
            .setValues(filas);
    }

    return {
        status: 'ok',
        espejo: espejo !== null,
        ids: revisiones.map(function (r) { return r.id; }),
        insertadas: filas.length
    };
}

/** Flujos activos y revisiones que este usuario puede ver, en una sola ida. */
function leerRevisiones(identidad) {
    var flujos = supabaseRPC('pdt_flujos_activos', {});
    var revisiones = supabaseRPC('pdt_revisiones_en_alcance', {
        p_correo: identidad.correo, p_limite: 5000
    });

    if (flujos === null && revisiones === null) {
        return { status: 'ok', flujos: [], revisiones: [], espejo: false };
    }
    return {
        status: 'ok',
        flujos: flujos || [],
        revisiones: revisiones || [],
        espejo: true
    };
}

/**
 * Comentarios. Se INSERTAN, nunca se hace upsert: un comentario que se puede reescribir deja
 * de servir para reconstruir una conversación. El id sirve para no duplicar si el mismo lote
 * se reenvía tras una falla de red.
 */
function guardarComentarios(comentarios, identidad) {
    if (comentarios.length === 0) return { status: 'ok', ids: [] };

    var hoja = obtenerHoja(HOJA_COMENTARIOS, ENCABEZADOS_COMENTARIOS);
    var ahora = new Date();

    // Los ids que ya están en la hoja: un reenvío no debe escribir dos veces lo mismo.
    var existentes = {};
    if (hoja.getLastRow() > 1) {
        var previos = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
        for (var i = 0; i < previos.length; i++) existentes[String(previos[i][0])] = true;
    }

    var filas = [];
    comentarios.forEach(function (c) {
        if (!c || !c.id || existentes[String(c.id)]) return;
        filas.push([
            c.id, c.momento || '', c.ambito || '', c.id_ambito || '', c.id_visita || '',
            c.cliente || '', c.hospital || '',
            // El autor SIEMPRE es la identidad verificada, nunca la que mande el cliente.
            identidad.nombre || c.usuario || '', identidad.correo,
            c.texto || '', ahora
        ]);
    });

    if (filas.length > 0) {
        hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, ENCABEZADOS_COMENTARIOS.length)
            .setValues(filas);
    }

    // ESPEJO, igual que los eventos: después de la hoja y sin poder tumbarla.
    var espejo = supabaseRPC('pdt_comentarios_guardar', {
        p_usuario_correo: identidad.correo,
        p_usuario: identidad.nombre || '',
        p_comentarios: comentarios
    });

    return {
        status: 'ok',
        espejo: espejo !== null,
        ids: comentarios.map(function (c) { return c.id; }),
        insertados: filas.length
    };
}

function guardarCatalogosAdmin(body, identidad) {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    if (!esAdmin(db, identidad.correo)) {
        return { status: 'error', message: 'Tu cuenta (' + identidad.correo + ') no tiene permisos de administrador.' };
    }

    if (Array.isArray(body.tipos_actividad)) {
        reemplazarHoja(db, HOJA_TIPOS, ['tipo', 'evidencia', 'materiales', 'folio', 'gerente'],
            body.tipos_actividad.map(function (t) {
                return [t.nombre || '', t.evidencia ? 'si' : 'no', t.materiales ? 'si' : 'no', '', ''];
            }));

        // La matriz de campos se reescribe entera junto con los tipos: si un tipo se borró,
        // sus renglones de campos tienen que irse con él o quedarían huérfanos configurando
        // un tipo que ya no existe.
        var filasCampos = [];
        body.tipos_actividad.forEach(function (t) {
            var campos = t.campos || {};
            Object.keys(campos).forEach(function (campo) {
                if (!t.nombre || !campos[campo]) return;
                filasCampos.push([t.nombre, campo, campos[campo]]);
            });
        });
        reemplazarHoja(db, HOJA_CAMPOS, ['tipo', 'campo', 'modo'], filasCampos);

        _tiposCache = null; // se cachea por request; esto invalida la de la próxima llamada
    }
    if (Array.isArray(body.origenes)) {
        reemplazarHoja(db, HOJA_ORIGENES, ['origen'], body.origenes.map(function (o) { return [o]; }));
    }
    if (Array.isArray(body.areas)) {
        reemplazarHoja(db, HOJA_AREAS, ['area'], body.areas.map(function (a) { return [a]; }));
    }
    if (Array.isArray(body.unidades)) {
        reemplazarHoja(db, HOJA_UNIDADES, ['unidad'], body.unidades.map(function (u) { return [u]; }));
    }
    if (Array.isArray(body.tipos_evidencia)) {
        reemplazarHoja(db, HOJA_TIPOS_EVIDENCIA, ['tipo_evidencia'],
            body.tipos_evidencia.map(function (t) { return [t]; }));
    }
    if (Array.isArray(body.sectores_ocultos)) {
        reemplazarHoja(db, HOJA_SECTORES_OCULTOS, ['sector'],
            body.sectores_ocultos.map(function (x) { return [x]; }));
    }
    if (Array.isArray(body.educadores)) {
        reemplazarHoja(db, HOJA_EDUCADORES, ['nombre', 'correo'],
            body.educadores.map(function (e) { return [e.nombre || '', e.correo || '']; }));
    }
    if (Array.isArray(body.admins)) {
        reemplazarHoja(db, HOJA_ADMINS, ['correo'], body.admins.map(function (a) { return [a]; }));
    }

    // ESPEJO. Solo se mandan las secciones que vinieron en el envío, con la misma condición
    // que usa cada `reemplazarHoja` de arriba: si un despliegue viejo de la PWA no manda una,
    // el espejo conserva la que ya tenía en vez de vaciarla en silencio.
    var secciones = {};
    ['tipos_actividad', 'origenes', 'areas', 'unidades', 'tipos_evidencia',
     'sectores_ocultos', 'educadores', 'admins'].forEach(function (clave) {
        if (Array.isArray(body[clave])) secciones[clave] = body[clave];
    });

    var espejo = null;
    if (Object.keys(secciones).length > 0) {
        espejo = supabaseRPC('pdt_catalogos_guardar', {
            p_publicado_por: identidad.correo,
            p_catalogos: secciones
        });
    }

    return { status: 'ok', espejo: espejo !== null };
}

/** Vacía la pestaña y la vuelve a escribir completa, con encabezados. */
function reemplazarHoja(libro, nombre, encabezados, filas) {
    var hoja = libro.getSheetByName(nombre);
    if (!hoja) hoja = libro.insertSheet(nombre);
    else hoja.clear();

    hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    if (filas.length > 0) hoja.getRange(2, 1, filas.length, encabezados.length).setValues(filas);
}

/* ══════════════════ Roles, capacidades y usuarios ══════════════════
 *
 * A diferencia de todo lo demás en este script, esto NO se espeja desde Sheets: los roles
 * viven solo en Postgres. No es una excepción por comodidad, es que una hoja no puede sostener
 * lo que este modelo necesita —herencia entre roles, integridad referencial contra el catálogo
 * de capacidades, negarse a borrar un rol que alguien usa— y mantener media copia en una
 * pestaña editable a mano acabaría en dos verdades distintas sobre quién puede qué.
 *
 * Por eso estas tres acciones usan `supabaseRPCEstricto`: sin copia en la hoja, un fallo
 * silencioso no tiene de dónde recuperarse.
 *
 * Todo pasa por aquí y no directo desde la PWA por lo mismo que `leerVisitasEquipo`: la app
 * solo tiene la clave anónima, que es pública. Con ella cualquiera podría concederse el rol
 * que quisiera, y la lectura expondría el organigrama completo a cualquier visitante.
 */

/** Lo que necesita la pantalla de administración: roles, catálogo de capacidades y usuarios. */
function leerRBAC(identidad) {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    if (!esAdmin(db, identidad.correo)) {
        return { status: 'error', message: 'Tu cuenta (' + identidad.correo + ') no tiene permisos de administrador.' };
    }

    var roles = supabaseRPCEstricto('pdt_roles_admin', {});
    if (!roles.ok) return { status: 'error', message: roles.error };

    var capacidades = supabaseRPCEstricto('pdt_capacidades_admin', {});
    if (!capacidades.ok) return { status: 'error', message: capacidades.error };

    var usuarios = supabaseRPCEstricto('pdt_usuarios_admin', {});
    if (!usuarios.ok) return { status: 'error', message: usuarios.error };

    return {
        status: 'ok',
        roles: roles.datos || [],
        capacidades: capacidades.datos || [],
        usuarios: usuarios.datos || []
    };
}

/**
 * Guarda roles y borra los que se pidieron borrar.
 *
 * Carga: { roles: [ {clave, nombre, descripcion, orden, activo, hereda_de, capacidades[]} ],
 *          eliminar: ["clave"] }
 *
 * NO es atómico entre roles: cada uno es su propia llamada. Se para en el primero que falle y
 * devuelve qué alcanzó a guardar, en vez de fingir que no pasó nada. Un guardado parcial que
 * se puede ver y reintentar es más manejable que un «error» opaco tras el cual la mitad de los
 * cambios sí están puestos.
 *
 * El actor sale SIEMPRE de la identidad verificada. Postgres vuelve a comprobar que puede
 * administrar; que aquí ya se haya comprobado no lo hace redundante, lo hace defensa en dos
 * capas de la única operación que puede repartir permisos.
 */
function guardarRoles(body, identidad) {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    if (!esAdmin(db, identidad.correo)) {
        return { status: 'error', message: 'Tu cuenta (' + identidad.correo + ') no tiene permisos de administrador.' };
    }

    var guardados = [];
    var borrados = [];

    var roles = body.roles || [];
    for (var i = 0; i < roles.length; i++) {
        var r = supabaseRPCEstricto('pdt_rol_guardar', {
            p_actor: identidad.correo,
            p_rol: roles[i]
        });
        if (!r.ok) {
            return { status: 'error', message: r.error, guardados: guardados, borrados: borrados };
        }
        guardados.push(roles[i].clave);
    }

    // Los borrados van al final: si un rol se reasignó en este mismo envío, el reasignado ya
    // está puesto cuando le toca el turno al que se va, y Postgres deja de ver usuarios en él.
    var eliminar = body.eliminar || [];
    for (var j = 0; j < eliminar.length; j++) {
        var d = supabaseRPCEstricto('pdt_rol_eliminar', {
            p_actor: identidad.correo,
            p_clave: eliminar[j]
        });
        if (!d.ok) {
            return { status: 'error', message: d.error, guardados: guardados, borrados: borrados };
        }
        borrados.push(eliminar[j]);
    }

    return { status: 'ok', guardados: guardados, borrados: borrados };
}

/**
 * Guarda usuarios —con su conjunto de roles— y la jerarquía de quién ve a quién.
 *
 * Carga: { usuarios: [ {correo, nombre, activo, roles[]} ],
 *          jerarquia: [ {jefe, subordinados: []} ] }
 *
 * Los usuarios van antes que la jerarquía: un jefe nuevo tiene que existir como usuario antes
 * de que se le cuelgue gente debajo.
 */
function guardarUsuarios(body, identidad) {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    if (!esAdmin(db, identidad.correo)) {
        return { status: 'error', message: 'Tu cuenta (' + identidad.correo + ') no tiene permisos de administrador.' };
    }

    var guardados = [];

    var usuarios = body.usuarios || [];
    for (var i = 0; i < usuarios.length; i++) {
        var u = supabaseRPCEstricto('pdt_usuario_guardar', {
            p_actor: identidad.correo,
            p_usuario: usuarios[i]
        });
        if (!u.ok) {
            return { status: 'error', message: u.error, guardados: guardados };
        }
        guardados.push(usuarios[i].correo);
    }

    var jerarquia = body.jerarquia || [];
    for (var j = 0; j < jerarquia.length; j++) {
        var h = supabaseRPCEstricto('pdt_jerarquia_guardar', {
            p_actor: identidad.correo,
            p_jefe: jerarquia[j].jefe,
            p_subordinados: jerarquia[j].subordinados || []
        });
        if (!h.ok) {
            return { status: 'error', message: h.error, guardados: guardados };
        }
    }

    return { status: 'ok', guardados: guardados };
}

/**
 * Admin por la hoja "Admins" (histórico) O por Supabase (fuente nueva, la que se administra
 * desde ahí en vez de editando la hoja). Cualquiera de las dos basta — así los admins que ya
 * estaban dados de alta en Sheets no pierden acceso el día que Supabase esté caído.
 */
function esAdmin(db, correo) {
    if (leerAdmins(db).indexOf(String(correo || '').toLowerCase()) !== -1) return true;
    return esAdminSupabase(correo);
}

/** Nunca lanza: si Supabase no responde, este lado del OR simplemente da 'no'. */
function esAdminSupabase(correo) {
    if (!correo) return false;
    try {
        var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/pdt_es_admin', {
            method: 'post',
            contentType: 'application/json',
            headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
            payload: JSON.stringify({ p_correo: correo }),
            muteHttpExceptions: true
        });
        if (resp.getResponseCode() !== 200) return false;
        return resp.getContentText() === 'true';
    } catch (err) {
        Logger.log('esAdminSupabase falló: %s', err);
        return false;
    }
}

/**
 * Inserta o actualiza filas buscando por la columna A (id).
 * columnasPreservadas: nombres cuyo valor existente NO se pisa si llega vacío.
 */
function upsert(hoja, encabezados, filas, columnasPreservadas) {
    if (filas.length === 0) return;

    var indiceFila = mapaDeIds(hoja);
    var nuevas = [];

    var indicesPreservados = (columnasPreservadas || []).map(function (nombre) {
        return encabezados.indexOf(nombre);
    });

    filas.forEach(function (fila) {
        var numeroFila = indiceFila[fila.id];

        if (numeroFila) {
            var rango = hoja.getRange(numeroFila, 1, 1, encabezados.length);
            var actuales = rango.getValues()[0];

            indicesPreservados.forEach(function (i) {
                if (i >= 0 && !fila.valores[i] && actuales[i]) fila.valores[i] = actuales[i];
            });

            rango.setValues([fila.valores]);
        } else {
            nuevas.push(fila.valores);
        }
    });

    if (nuevas.length > 0) {
        hoja.getRange(hoja.getLastRow() + 1, 1, nuevas.length, encabezados.length)
            .setValues(nuevas);
    }
}

/** id -> número de fila. Una sola lectura en bloque; leer fila por fila es lentísimo. */
function mapaDeIds(hoja) {
    var mapa = {};
    if (hoja.getLastRow() < 2) return mapa;

    var ids = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1).getValues();
    ids.forEach(function (f, i) {
        var id = String(f[0]).trim();
        if (id) mapa[id] = i + 2;
    });
    return mapa;
}

/** Documento donde viven las visitas (el que tiene pegado este script, salvo config). */
function libroVisitas() {
    if (SHEET_VISITAS_ID) return SpreadsheetApp.openById(SHEET_VISITAS_ID);

    var ss = SpreadsheetApp.getActive();
    if (!ss) {
        throw new Error(
            'Este script no está pegado a ninguna hoja de cálculo. ' +
            'Pon el ID del documento de visitas en SHEET_VISITAS_ID.'
        );
    }
    return ss;
}

function obtenerHoja(nombre, encabezados) {
    var ss = libroVisitas();
    var hoja = ss.getSheetByName(nombre);

    if (!hoja) {
        hoja = ss.insertSheet(nombre);
        hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
        hoja.setFrozenRows(1);
        return hoja;
    }

    // Hoja vacía preexistente: se le ponen los encabezados y listo.
    if (hoja.getLastRow() === 0) {
        hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
        hoja.setFrozenRows(1);
        return hoja;
    }

    var anchoActual = hoja.getLastColumn();
    var actuales = hoja.getRange(1, 1, 1, Math.max(anchoActual, 1)).getValues()[0];

    // Las columnas que ya existen tienen que coincidir en NOMBRE y POSICIÓN. Si no,
    // escribir aquí metería datos en la columna equivocada: mejor romper con un mensaje
    // que diga exactamente qué hacer.
    for (var i = 0; i < Math.min(actuales.length, encabezados.length); i++) {
        if (String(actuales[i]).trim() !== encabezados[i]) {
            throw new Error(
                'La pestaña "' + nombre + '" tiene otras columnas: en la posición ' + (i + 1) +
                ' se esperaba "' + encabezados[i] + '" y hay "' + actuales[i] + '". ' +
                'Esto pasa al venir de la versión anterior, donde la columna "fecha" era una sola. ' +
                'Renómbrala a "' + nombre + '_anterior" y vuelve a sincronizar: el script creará ' +
                'la pestaña nueva con el formato correcto y tus datos viejos quedan intactos al lado.'
            );
        }
    }

    // Coincide hasta donde llega, pero le faltan columnas del final: se AGREGAN en vez de
    // tronar. Así, añadir un campo más adelante no obliga a rehacer la hoja.
    if (actuales.length < encabezados.length) {
        var nuevas = encabezados.slice(actuales.length);
        hoja.getRange(1, actuales.length + 1, 1, nuevas.length)
            .setValues([nuevas]).setFontWeight('bold');
    }
    return hoja;
}

// ---------- EVIDENCIAS ----------

/**
 * Guarda un archivo (imagen o PDF) en Drive y escribe su URL en la fila hija.
 * Va en su propia petición: las evidencias se suben cuando hay señal, que puede ser
 * días después de registrar la actividad.
 */
function subirEvidencia(body) {
    if (!body.id_actividad) return { status: 'error', message: 'falta id_actividad' };
    if (!body.datos) return { status: 'error', message: 'falta el archivo' };

    var blob = Utilities.newBlob(
        Utilities.base64Decode(body.datos),
        body.mimeType || 'application/octet-stream',
        body.nombre || (body.id_actividad + '.bin')
    );

    var archivo = carpetaDeCliente(body.cliente).createFile(blob);

    // Muchos dominios de Workspace bloquean compartir "cualquiera con el enlace". Si pasa,
    // el archivo igual queda guardado y visible dentro del dominio: no vale la pena tirar
    // la subida por esto (la PWA ya borró su copia local al recibir el ok).
    try {
        archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (err) {
        console.warn('No se pudo abrir el enlace público, queda restringido al dominio: ' + err);
    }

    var url = archivo.getUrl();

    var hoja = obtenerHoja(HOJA_ACTIVIDADES, ENCABEZADOS_ACTIVIDADES);
    var fila = mapaDeIds(hoja)[body.id_actividad];
    var columna = ENCABEZADOS_ACTIVIDADES.indexOf('evidencia_url') + 1;

    if (fila) {
        hoja.getRange(fila, columna).setValue(url);
    }
    // Si la fila aún no existe (la visita no se ha sincronizado), no pasa nada:
    // la app guarda la URL y la manda en el próximo upsert.

    return { status: 'ok', id_actividad: body.id_actividad, url: url, fila_actualizada: !!fila };
}

/**
 * Carpeta raíz de evidencias.
 *
 * Con el permiso "drive.file" el script solo alcanza lo que él mismo creó, así que NO se puede
 * buscar por nombre en el Drive (getFoldersByName no vería nada y crearía una carpeta nueva en
 * cada subida). Se crea una vez y se guarda su id.
 */
function carpetaRaizEvidencias() {
    var props = PropertiesService.getScriptProperties();
    var id = CARPETA_EVIDENCIAS_ID || props.getProperty(PROP_CARPETA);

    if (id) {
        try {
            return DriveApp.getFolderById(id);
        } catch (err) {
            if (CARPETA_EVIDENCIAS_ID) {
                throw new Error(
                    'No se puede abrir la carpeta ' + CARPETA_EVIDENCIAS_ID + '. Con el permiso ' +
                    '"drive.file" el script solo alcanza carpetas que creó él mismo. Deja ' +
                    'CARPETA_EVIDENCIAS_ID vacío y deja que la cree; luego muévela dentro de ' +
                    'tu carpeta "Evidencias". Detalle: ' + err
                );
            }
            // La carpeta recordada se borró o se movió a una unidad compartida: se recrea.
            props.deleteProperty(PROP_CARPETA);
        }
    }

    var carpeta = DriveApp.createFolder(NOMBRE_CARPETA_EVIDENCIAS);
    props.setProperty(PROP_CARPETA, carpeta.getId());
    return carpeta;
}

/**
 * Subcarpeta por cliente, dentro de la raíz. Su id también se recuerda: sin eso habría que
 * listar, y con drive.file eso no es de fiar.
 */
function carpetaDeCliente(cliente) {
    var raiz = carpetaRaizEvidencias();

    var nombre = String(cliente || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!nombre) nombre = 'Sin cliente';

    var props = PropertiesService.getScriptProperties();
    var clave = PROP_CLIENTE + nombre;
    var id = props.getProperty(clave);

    if (id) {
        try {
            return DriveApp.getFolderById(id);
        } catch (err) {
            props.deleteProperty(clave); // se borró o se movió: se recrea abajo
        }
    }

    // Red de seguridad por si se perdieron las propiedades: la raíz sí la creó el script,
    // así que listar SUS hijas suele funcionar aun con drive.file. Si no, se crea y ya.
    try {
        var existentes = raiz.getFoldersByName(nombre);
        if (existentes.hasNext()) {
            var encontrada = existentes.next();
            props.setProperty(clave, encontrada.getId());
            return encontrada;
        }
    } catch (err) {
        // sin permiso para listar: se crea directo
    }

    var carpeta = raiz.createFolder(nombre);
    props.setProperty(clave, carpeta.getId());
    return carpeta;
}

// ---------- HERRAMIENTAS DEL EDITOR ----------
// Estas dos no las llama la PWA: se corren a mano desde el editor de Apps Script.

/**
 * Ejecuta esta función UNA vez desde el editor para aceptar los permisos de Drive.
 * Sin esto, la app publicada falla al subir evidencias aunque el código esté bien.
 *
 * Hace de verdad la operación que falla en campo (crear un archivo), porque un permiso de
 * Drive de SOLO LECTURA alcanza para encontrar la carpeta pero no para escribir en ella:
 * si solo se listara, esto pasaría y la subida real seguiría rota.
 */
function autorizar() {
    var libro = libroVisitas();
    Logger.log('Visitas en: "%s"', libro.getName());

    var raiz = carpetaRaizEvidencias();
    Logger.log('Carpeta raíz: "%s"', raiz.getName());
    Logger.log('  url: %s', raiz.getUrl());
    Logger.log('  👉 Muévela DENTRO de tu carpeta "Evidencias". Solo una vez: el id no cambia');
    Logger.log('     y el script no pierde el acceso. Déjala en Mi unidad, no en una unidad');
    Logger.log('     compartida.');

    var carpeta = carpetaDeCliente('PRUEBA DE PERMISOS');
    Logger.log('Subcarpeta de cliente: "%s" (se crea una por cliente)', carpeta.getName());

    var prueba = carpeta.createFile(
        Utilities.newBlob('prueba de permisos', 'text/plain', 'prueba-permisos.txt')
    );
    Logger.log('✅ Escritura en Drive OK (archivo de prueba creado).');

    try {
        prueba.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        Logger.log('✅ Enlace público OK.');
    } catch (err) {
        Logger.log('⚠ El dominio no permite enlaces públicos; las evidencias quedarán ' +
                   'visibles solo dentro del dominio. La subida igual funciona.');
    }

    // Limpiar es cortesía, no parte de lo que la PWA necesita: subir solo usa createFile +
    // setSharing + getUrl, y esos ya pasaron. En unidades compartidas setTrashed suele fallar
    // aunque escribir sí funcione, y no vale la pena reprobar por eso.
    try {
        prueba.setTrashed(true);
        carpeta.setTrashed(true);
        PropertiesService.getScriptProperties().deleteProperty(PROP_CLIENTE + 'PRUEBA DE PERMISOS');
    } catch (err) {
        Logger.log('⚠ No se pudo borrar lo de prueba (%s). Bórralo a mano: %s',
                   err.message, carpeta.getUrl());
    }

    Logger.log('✅ Todo listo. Ya puedes crear la NUEVA VERSIÓN de la implementación.');
}

/**
 * Corre ESTA función (no "autorizar" ni "revisarConfiguracion") para activar el permiso de
 * conexión externa. Apps Script solo pide un permiso cuando la ejecución REALMENTE lo usa;
 * ni "autorizar" (solo toca Drive) ni "revisarConfiguracion" (solo lee Sheets) llaman a
 * UrlFetchApp, así que ejecutarlas nunca dispara el consentimiento de este permiso, aunque
 * ya esté listado en el manifiesto. Ver el paso 4b de arriba.
 */
function probarConexionExterna() {
    var resp = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/pdt_es_admin', {
        method: 'post',
        contentType: 'application/json',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
        payload: JSON.stringify({ p_correo: 'nadie@degasa.com' }),
        muteHttpExceptions: true
    });
    Logger.log('Código HTTP: %s', resp.getResponseCode());
    Logger.log('Respuesta: %s', resp.getContentText());
    if (resp.getResponseCode() === 200) {
        Logger.log('✅ Conexión externa OK. Ya puedes crear la NUEVA VERSIÓN de la implementación.');
    } else {
        Logger.log('⚠ Se pudo conectar (el permiso ya quedó autorizado) pero Supabase no ' +
                   'respondió 200 — revisa la URL/clave si esto no es solo una prueba.');
    }
}

/**
 * Diagnóstico: revisa que los catálogos se lean bien y avisa si alguna pestaña de captura
 * choca con una que ya exista. No escribe nada.
 */
function revisarConfiguracion() {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    Logger.log('Catálogos desde: "%s"', db.getName());
    Logger.log('  clientes:   %s', leerClientes(db).length);
    Logger.log('  sectores:   %s  -> %s', leerSectores(db).length, leerSectores(db).join(', '));
    Logger.log('  educadores: %s', leerEducadores(db).length);
    Logger.log('  materiales: %s', leerMateriales(db).length);

    var libro = libroVisitas();
    Logger.log('Visitas hacia: "%s"', libro.getName());

    [
        [HOJA_VISITAS, ENCABEZADOS_VISITAS], [HOJA_ACTIVIDADES, ENCABEZADOS_ACTIVIDADES],
        [HOJA_MATERIALES_CAPTURA, ENCABEZADOS_MATERIALES_CAPTURA], [HOJA_EVENTOS, ENCABEZADOS_EVENTOS]
    ].forEach(function (par) {
            var hoja = libro.getSheetByName(par[0]);
            if (!hoja) {
                Logger.log('  "%s": no existe, se creará sola. OK.', par[0]);
                return;
            }
            try {
                obtenerHoja(par[0], par[1]);
                Logger.log('  "%s": ya existe con el formato correcto. OK.', par[0]);
            } catch (err) {
                Logger.log('  "%s": ⚠ %s', par[0], err.message);
            }
        });
}
