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
 *   5. Implementar → Gestionar implementaciones → editar la existente (icono del lápiz) →
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
 * Modelo de captura: dos pestañas nuevas.
 *   VISITAS (padre)     -> una fila por cada (visita x sector), con su objetivo.
 *   ACTIVIDADES (hija)  -> una fila por actividad, ligada al padre por id_padre.
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

// Carpeta raíz de las evidencias. Dentro, el script crea una subcarpeta por cliente.
//
// DÉJALO VACÍO. Con el permiso "drive.file" el script solo alcanza los archivos que él mismo
// crea: si pones aquí el id de tu carpeta "Evidencias" (hecha a mano) no podrá abrirla.
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

const ENCABEZADOS_VISITAS = [
    'id_padre', 'id_visita', 'educador', 'correo', 'cliente',
    'fecha', 'sector', 'objetivo', 'estado', 'actualizado'
];

const ENCABEZADOS_ACTIVIDADES = [
    'id_actividad', 'id_padre', 'id_visita', 'sector',
    'actividad', 'evidencia_url', 'creada', 'actualizado'
];

// ---------- ENTRADA HTTP ----------

function doGet() {
    try {
        var db = SpreadsheetApp.openById(SHEET_DB_ID);
        return json({
            educadores: leerEducadores(db),
            sectores: leerSectores(db),
            clientes: leerClientes(db)
        });
    } catch (err) {
        return json({ status: 'error', message: String(err) });
    }
}

function doPost(e) {
    // La PWA manda Content-Type: text/plain para evitar el preflight OPTIONS,
    // que Apps Script no sabe responder. Por eso el body llega crudo aquí.
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(30000);
        var body = JSON.parse(e.postData.contents);

        switch (body.action) {
            case 'guardarVisitas':
                return json(guardarVisitas(body.visitas || []));
            case 'subirEvidencia':
                return json(subirEvidencia(body));
            default:
                return json({ status: 'error', message: 'action desconocida: ' + body.action });
        }
    } catch (err) {
        return json({ status: 'error', message: String(err) });
    } finally {
        lock.releaseLock();
    }
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
 * Recibe el árbol de visitas de la PWA y lo aplana en las dos pestañas.
 * Devuelve los ids procesados para que la app marque lo sincronizado.
 */
function guardarVisitas(visitas) {
    var hojaVisitas = obtenerHoja(HOJA_VISITAS, ENCABEZADOS_VISITAS);
    var hojaActividades = obtenerHoja(HOJA_ACTIVIDADES, ENCABEZADOS_ACTIVIDADES);

    var filasPadre = [];
    var filasHija = [];
    var ahora = new Date();

    visitas.forEach(function (visita) {
        (visita.sectores || []).forEach(function (sector) {
            var idPadre = visita.id + '::' + sector.id;

            filasPadre.push({
                id: idPadre,
                valores: [
                    idPadre, visita.id, visita.educador || '', visita.educador_correo || '',
                    visita.cliente || '', visita.fecha || '', sector.nombre || '',
                    sector.objetivo || '', visita.estado || 'agendada', ahora
                ]
            });

            (sector.actividades || []).forEach(function (act) {
                filasHija.push({
                    id: act.id,
                    valores: [
                        act.id, idPadre, visita.id, sector.nombre || '',
                        act.texto || '', (act.evidencia && act.evidencia.url) || '',
                        act.creada || '', ahora
                    ]
                });
            });
        });
    });

    // La columna de evidencia se preserva: la app suele mandarla vacía porque la foto
    // se sube después, y sin esto un re-sync borraría la URL que ya está en la hoja.
    upsert(hojaVisitas, ENCABEZADOS_VISITAS, filasPadre, []);
    upsert(hojaActividades, ENCABEZADOS_ACTIVIDADES, filasHija, ['evidencia_url']);

    return {
        status: 'ok',
        ids: visitas.map(function (v) { return v.id; }),
        padres: filasPadre.length,
        actividades: filasHija.length
    };
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

    // Si ya existía con OTRO formato (p.ej. la hoja plana de la versión anterior), escribir
    // aquí metería datos en columnas equivocadas. Mejor romper con un mensaje claro.
    var actuales = hoja.getRange(1, 1, 1, encabezados.length).getValues()[0];
    for (var i = 0; i < encabezados.length; i++) {
        if (String(actuales[i]).trim() !== encabezados[i]) {
            throw new Error(
                'La pestaña "' + nombre + '" existe pero tiene otras columnas (se esperaba "' +
                encabezados[i] + '" en la posición ' + (i + 1) + ' y hay "' + actuales[i] + '"). ' +
                'Renómbrala (por ejemplo a "' + nombre + '_anterior") y vuelve a sincronizar: ' +
                'el script creará la pestaña nueva con el formato correcto.'
            );
        }
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
 * Diagnóstico: revisa que los catálogos se lean bien y avisa si alguna pestaña de captura
 * choca con una que ya exista. No escribe nada.
 */
function revisarConfiguracion() {
    var db = SpreadsheetApp.openById(SHEET_DB_ID);
    Logger.log('Catálogos desde: "%s"', db.getName());
    Logger.log('  clientes:   %s', leerClientes(db).length);
    Logger.log('  sectores:   %s  -> %s', leerSectores(db).length, leerSectores(db).join(', '));
    Logger.log('  educadores: %s', leerEducadores(db).length);

    var libro = libroVisitas();
    Logger.log('Visitas hacia: "%s"', libro.getName());

    [[HOJA_VISITAS, ENCABEZADOS_VISITAS], [HOJA_ACTIVIDADES, ENCABEZADOS_ACTIVIDADES]]
        .forEach(function (par) {
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
