/**
 * Backend de la PWA "Gestor de Visitas" (DEGASA).
 *
 * Cómo publicarlo:
 *   1. Abre el MISMO proyecto de Apps Script que ya usabas (el que está pegado al documento
 *      donde se guardan las visitas).
 *   2. Pega este archivo completo (reemplaza lo que haya).
 *   3. Revisa la CONFIGURACIÓN de abajo.
 *   4. IMPORTANTE, se olvida siempre: este script ahora usa Drive (antes solo Sheets), así
 *      que pide permisos nuevos. Selecciona la función "autorizar" en el editor y dale
 *      Ejecutar UNA vez para aceptarlos. Si no lo haces, la app publicada falla al subir
 *      evidencias aunque el código esté bien.
 *   5. Implementar → Gestionar implementaciones → editar la existente (icono del lápiz) →
 *      Versión: Nueva → Implementar.
 *        - Ejecutar como: Yo
 *        - Quién tiene acceso: CUALQUIER PERSONA   <-- indispensable, si no la PWA recibe 401
 *      Editar la implementación existente CONSERVA la URL /exec que la PWA ya tiene.
 *      Si creas una implementación NUEVA, la URL cambia y hay que actualizar
 *      GOOGLE_SCRIPT_URL en js/sync.js.
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
const SHEET_VISITAS_ID = '';

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

// Carpeta de Drive donde caen las evidencias. Déjalo en '' y se crea/reutiliza
// una carpeta llamada "Evidencias Visitas" en tu Drive raíz.
const CARPETA_EVIDENCIAS_ID = '';

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

    var archivo = carpetaEvidencias().createFile(blob);

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

function carpetaEvidencias() {
    if (CARPETA_EVIDENCIAS_ID) return DriveApp.getFolderById(CARPETA_EVIDENCIAS_ID);

    var existentes = DriveApp.getFoldersByName('Evidencias Visitas');
    return existentes.hasNext() ? existentes.next() : DriveApp.createFolder('Evidencias Visitas');
}

// ---------- HERRAMIENTAS DEL EDITOR ----------
// Estas dos no las llama la PWA: se corren a mano desde el editor de Apps Script.

/**
 * Ejecuta esta función UNA vez desde el editor para aceptar los permisos de Drive.
 * Sin esto, la app publicada falla al subir evidencias aunque el código esté bien.
 */
function autorizar() {
    var libro = libroVisitas();
    var carpeta = carpetaEvidencias();
    Logger.log('Visitas en: "%s"', libro.getName());
    Logger.log('Evidencias en: "%s"', carpeta.getName());
    Logger.log('Permisos aceptados. Ya puedes crear la nueva versión de la implementación.');
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
