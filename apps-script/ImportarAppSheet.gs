/**
 * Importar AppSheet → hojas de revisión → Supabase.
 *
 * AppSheet sigue en uso mientras los educadores migran poco a poco. Sus datos viven en hojas con
 * otro modelo (un renglón por visita y otro por sector, actividades y materiales sueltos, nombres
 * de sector truncados a 20 caracteres, estados propios). Este archivo los TRAE, los TRANSFORMA al
 * modelo de la app y los deja en pestañas "AS_*" de la hoja donde la app ya guarda sus registros,
 * para que alguien los REVISE antes de subirlos a Supabase. Nada llega a Supabase sin aprobarse.
 *
 *   1. appsheetTransformar()        lee AppSheet, transforma y escribe/actualiza las pestañas AS_*.
 *                                   Puede correr solo cada hora (appsheetInstalarTrigger).
 *   2. (persona)                    revisa las pestañas AS_*, corrige lo que haga falta y marca la
 *                                   columna `import_estado` de AS_Visitas como `aprobada`
 *                                   (o `descartada`).
 *   3. appsheetSubirAprobadas()     sube a Supabase solo lo aprobado, con la MISMA función con la
 *                                   que guarda la app (`pdt_espejo_guardar`), así que se ve igual
 *                                   que si se hubiera capturado en la app: calendario, cálculos,
 *                                   revisiones. Además lo encola para las pestañas normales.
 *
 * ── Migración poco a poco ───────────────────────────────────────────────────────────────
 *
 * Pestaña `AS_Corte` (correo | importar_hasta): de cada educador que ya capturó en la app solo se
 * importa lo anterior a su fecha de corte; sin renglón se importa todo. Así nunca se duplica una
 * visita capturada en las dos aplicaciones.
 *
 * ── Qué se conserva ─────────────────────────────────────────────────────────────────────
 *
 * Cada renglón trae TODAS las columnas de origen en `src_json`, y las pestañas AS_* no se borran
 * entre corridas: lo aprobado o descartado no se vuelve a tocar, y lo que cambió en AppSheet
 * después de revisarlo vuelve a `pendiente` con una nota.
 *
 * Las funciones `as*` de "transformación" son PURAS (no tocan hojas): se prueban en
 * tests/importar-appsheet.test.ts cargando este archivo tal cual.
 */

// ---------- CONFIGURACIÓN ----------

// Hojas de AppSheet. Las pestañas se buscan por NOMBRE en ambos libros, así que si una pestaña
// vive en el otro libro no hay que tocar nada más.
//
// Cada una se configura con una propiedad del script (Configuración del proyecto → Propiedades del
// script), donde se puede pegar el ENLACE completo de la hoja o solo su id:
//     APPSHEET_ID_PLAN          la hoja con 'Plan de trabajo' y 'PT_Sectores'
//     APPSHEET_ID_ACTIVIDADES   la hoja con 'Actividades_Reg' y 'Actividades_Materiales'
// Si la propiedad no existe se usa el valor de aquí. `appsheetVerificarAcceso()` comprueba que el
// script pueda abrir ambas y lista sus pestañas.
const AS_ID_PLAN = '';
const AS_ID_ACTIVIDADES = '1LlV4MNeq_m1VzTyeiL2__vpB1oceGBWhO5tWgupf1WI';

/** El id de una hoja a partir de lo que se pegó: un enlace completo ('…/d/<id>/edit?gid=0') o el id. */
function asExtraerId(valor) {
    var t = String(valor === null || valor === undefined ? '' : valor).trim();
    var m = t.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : t;
}

function asIdDe(propiedad, porDefecto) {
    var id = asExtraerId(PropertiesService.getScriptProperties().getProperty(propiedad) || porDefecto);
    if (!id) {
        throw new Error('Falta la hoja de AppSheet: crea la propiedad del script ' + propiedad +
                        ' y pega el enlace de la hoja (o su id).');
    }
    return id;
}

const AS_HOJA_PLAN = 'Plan de trabajo';
const AS_HOJA_SECTORES = 'PT_Sectores';
const AS_HOJA_ACTIVIDADES = 'Actividades_Reg';
const AS_HOJA_MATERIALES = 'Actividades_Materiales';

// México no tiene horario de verano desde 2022: el desfase es fijo todo el año.
const AS_DESFASE = '-06:00';
const AS_ZONA = 'America/Mexico_City';

const AS_CONTROL = ['import_estado', 'import_notas', 'import_hash', 'import_transformado', 'import_subido'];

// Estados de importación. Solo `aprobada` sube.
//   pendiente        recién traída, por revisar
//   con_error        le falta algo que la app exige (correo, fecha…): corregir o descartar
//   sin_visita       actividad cuya visita no se encontró en el plan
//   omitida_corte    el educador ya capturó en la app desde su fecha de corte: no se importa
//   aprobada         la persona la revisó: se sube en la siguiente corrida de appsheetSubirAprobadas
//   subida           ya está en Supabase
//   descartada       la persona decidió no importarla
const AS_ESTADOS_QUE_SE_REFRESCAN = ['pendiente', 'con_error', 'sin_visita', 'omitida_corte', 'aprobada', 'subida'];

const AS_COLUMNAS = {
    visitas: {
        hoja: 'AS_Visitas', id: 'id_visita',
        columnas: ['id_visita', 'educador', 'educador_correo', 'cliente', 'hospital', 'dia', 'hora_inicio', 'hora_fin',
                   'estado', 'motivo_cancelacion', 'check_in_momento', 'check_in_lat', 'check_in_lng',
                   'check_out_momento', 'reagendas', 'zona', 'ejecutivo', 'notas', 'sectores', 'n_actividades',
                   'puntualidad', 'estado_revision_pt', 'efectividad', 'id_origen_appsheet', 'src_json']
    },
    sectores: {
        hoja: 'AS_Sectores', id: 'id_sector',
        columnas: ['id_sector', 'id_visita', 'nombre', 'nombre_original', 'objetivo', 'origen', 'solicitado_por', 'src_json']
    },
    actividades: {
        hoja: 'AS_Actividades', id: 'id_actividad',
        columnas: ['id_actividad', 'id_sector', 'id_visita', 'tipo', 'tipo_original', 'area_visitada', 'area_original',
                   'fecha', 'fecha_documento', 'guardada_momento', 'guardada_usuario', 'evidencia_estado',
                   'evidencia_url', 'evidencia_ruta', 'evidencia_nombre', 'folio', 'comentarios',
                   'estado_actividad_appsheet', 'src_json']
    },
    materiales: {
        hoja: 'AS_Materiales', id: 'id_material',
        columnas: ['id_material', 'id_actividad', 'id_visita', 'material', 'cantidad', 'unidad', 'origen', 'src_json']
    }
};

// ============================================================================================
//  TRANSFORMACIÓN (pura)
// ============================================================================================

/** Texto sin acentos, en mayúsculas y con espacios normalizados: la forma de COMPARAR nombres. */
function asClaveTexto(t) {
    return String(t === null || t === undefined ? '' : t)
        .replace(/�/g, '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase().replace(/\s+/g, ' ').trim();
}

/** 'Estado revisión PT' → 'estado_revision_pt': la forma de COMPARAR encabezados. */
function asClaveColumna(t) {
    return asClaveTexto(t).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function asTexto(v) {
    if (v === null || v === undefined) return '';
    return String(v).trim();
}

/** Una hoja (matriz con encabezados) → objetos con llaves normalizadas, sin renglones vacíos. */
function asFilasAObjetos(valores) {
    if (!valores || valores.length < 2) return [];
    var encabezados = valores[0].map(function (h) { return String(h); });
    var claves = encabezados.map(asClaveColumna);
    var salida = [];

    for (var i = 1; i < valores.length; i++) {
        var fila = valores[i];
        var vacia = true;
        for (var j = 0; j < fila.length; j++) { if (fila[j] !== '' && fila[j] !== null && fila[j] !== undefined) { vacia = false; break; } }
        if (vacia) continue;

        var o = {};
        for (var k = 0; k < claves.length; k++) { if (claves[k] && !(claves[k] in o)) o[claves[k]] = fila[k]; }
        // El renglón de origen completo, tal cual, para no perder ninguna columna.
        var crudo = {};
        for (var c = 0; c < encabezados.length; c++) {
            if (fila[c] !== '' && fila[c] !== null && fila[c] !== undefined) crudo[encabezados[c].trim()] = asJsonSeguro(fila[c]);
        }
        o.__crudo = crudo;
        salida.push(o);
    }
    return salida;
}

function asJsonSeguro(v) {
    if (Object.prototype.toString.call(v) === '[object Date]') return v.toISOString();
    return v;
}

/** Quita del `src_json` lo que no aporta (campos vacíos ya se omiten arriba). */
function asSrcJson(o) {
    return JSON.stringify(o.__crudo || {});
}

function asDosDigitos(n) { return (n < 10 ? '0' : '') + n; }

function asEsDate(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime()); }

/**
 * Fecha como 'YYYY-MM-DD'. Acepta lo que realmente trae una hoja: un Date, un texto
 * ('2026-02-12', '2026-02-12 00:00:00', '12/02/2026') o un número de serie (Sheets/Excel: días
 * desde 1899-12-30, que es como llegan las fechas escritas como entero).
 * `ctx.formatear(fecha, patron)` convierte un Date con la zona del libro (Utilities.formatDate).
 */
function asFecha(v, ctx) {
    if (v === null || v === undefined || v === '') return '';

    if (asEsDate(v)) {
        var f = ctx && ctx.formatear ? ctx.formatear(v, 'yyyy-MM-dd')
              : v.getFullYear() + '-' + asDosDigitos(v.getMonth() + 1) + '-' + asDosDigitos(v.getDate());
        return f;
    }
    if (typeof v === 'number') {
        // Fuera de este rango no es una fecha: es otro número que alguien escribió en la celda.
        if (v < 20000 || v > 80000) return '';
        var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
        return d.getUTCFullYear() + '-' + asDosDigitos(d.getUTCMonth() + 1) + '-' + asDosDigitos(d.getUTCDate());
    }
    var t = String(v).trim();
    var m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // dd/mm/aaaa (así se muestran en la app)
    if (m) return m[3] + '-' + asDosDigitos(+m[2]) + '-' + asDosDigitos(+m[1]);
    if (/^\d{5}$/.test(t)) return asFecha(Number(t), ctx);
    return '';
}

/** Hora como 'HH:MM'. Acepta un Date (celda de hora), '11:40:00', '11:40' o una fracción de día. */
function asHora(v, ctx) {
    if (v === null || v === undefined || v === '') return '';
    if (asEsDate(v)) {
        return ctx && ctx.formatear ? ctx.formatear(v, 'HH:mm')
            : asDosDigitos(v.getHours()) + ':' + asDosDigitos(v.getMinutes());
    }
    if (typeof v === 'number') {
        if (v < 0 || v >= 1) return '';
        var min = Math.round(v * 1440);
        return asDosDigitos(Math.floor(min / 60) % 24) + ':' + asDosDigitos(min % 60);
    }
    var m = String(v).trim().match(/(\d{1,2}):(\d{2})/);
    return m ? asDosDigitos(+m[1]) + ':' + m[2] : '';
}

function asSumarMinutos(hora, minutos) {
    var m = String(hora).match(/^(\d{2}):(\d{2})$/);
    if (!m) return '';
    var total = (+m[1] * 60 + +m[2] + minutos) % 1440;
    return asDosDigitos(Math.floor(total / 60)) + ':' + asDosDigitos(total % 60);
}

/** Un instante ISO con el desfase de México, a partir de fecha y hora de pared. */
function asMomento(fecha, hora) {
    if (!fecha) return '';
    return fecha + 'T' + (hora || '12:00') + ':00' + AS_DESFASE;
}

/** "19.351351, -99.170256" → { lat, lng } o null. */
function asUbicacion(v) {
    var m = String(v || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    var lat = Number(m[1]), lng = Number(m[2]);
    return (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) ? { lat: lat, lng: lng } : null;
}

function asNormalizarZona(z) {
    var t = asTexto(z);
    return /^\d+$/.test(t) ? ('000' + t).slice(-Math.max(3, t.length)) : t;
}

/** "BI , I&D , Gerencia de Marca" → ['BI', 'I&D', 'Gerencia de Marca'] */
function asLista(v) {
    return asTexto(v).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
}

/** Mismo criterio que `problemaDeOrigen` de la app: solo números → N dígitos; si no → M caracteres. */
function asProblemaDeOrigen(valor, reglas) {
    var v = asTexto(valor);
    if (!v) return '';
    var minDigitos = (reglas && reglas.origen_min_digitos) || 6;
    var minCaracteres = (reglas && reglas.origen_min_caracteres) || 3;
    if (/^\d+$/.test(v)) return v.length >= minDigitos ? '' : 'Folio de menos de ' + minDigitos + ' dígitos';
    return v.replace(/\s+/g, '').length >= minCaracteres ? '' : 'Origen de menos de ' + minCaracteres + ' caracteres';
}

/**
 * Resuelve un nombre de AppSheet contra el catálogo de la app.
 *
 *   1. alias que la persona dejó en AS_Alias (manda siempre)
 *   2. coincidencia exacta con el catálogo (sin acentos ni mayúsculas)
 *   3. prefijo ÚNICO por si algún nombre viene cortado (AppSheet y el catálogo de la app comparten
 *      los sectores de 20 caracteres, como "ALGODÓN Y APLICADORE", así que casi siempre cae en 2)
 *   4. nada → se conserva el original y se avisa
 * Devuelve { valor, ok, motivo }.
 */
function asResolverNombre(original, catalogo, aliasDelTipo) {
    var raw = asTexto(original);
    if (!raw) return { valor: '', ok: false, motivo: 'vacío' };
    var clave = asClaveTexto(raw);

    var alias = aliasDelTipo && aliasDelTipo[clave];
    if (alias) return { valor: alias, ok: true, motivo: 'alias' };

    var porClave = {};
    (catalogo || []).forEach(function (n) { porClave[asClaveTexto(n)] = n; });
    if (porClave[clave]) return { valor: porClave[clave], ok: true, motivo: 'exacto' };

    if (clave.length >= 8) {
        var candidatos = (catalogo || []).filter(function (n) { return asClaveTexto(n).indexOf(clave) === 0; });
        if (candidatos.length === 1) return { valor: candidatos[0], ok: true, motivo: 'truncado' };
        if (candidatos.length > 1) return { valor: raw, ok: false, motivo: 'ambiguo' };
    }
    return { valor: raw, ok: false, motivo: 'desconocido' };
}

/** El área de AppSheet ("Usuaria / Especialidad") contra las del catálogo de la app. */
function asResolverArea(original, catalogo, aliasDelTipo) {
    var r = asResolverNombre(original, catalogo, aliasDelTipo);
    if (r.ok || !asTexto(original)) return r;
    var clave = asClaveTexto(original);
    var buscada = clave.indexOf('USUARIA') !== -1 ? 'USUARIA' : (clave === 'OTRA' ? 'OTRA' : '');
    if (buscada) {
        var hallada = (catalogo || []).filter(function (n) { return asClaveTexto(n).indexOf(buscada) !== -1; });
        if (hallada.length === 1) return { valor: hallada[0], ok: true, motivo: 'heuristica' };
    }
    return r;
}

function asAgregarNota(actual, nueva) {
    var a = asTexto(actual);
    return a ? (a.indexOf(nueva) !== -1 ? a : a + ' | ' + nueva) : nueva;
}

function asHash(texto) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, texto, Utilities.Charset.UTF_8);
    return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/**
 * La transformación completa. Entradas: objetos de cada hoja de AppSheet. Salida: los renglones
 * de las cuatro pestañas AS_*, los problemas encontrados y los nombres que no se pudieron resolver.
 *
 * ctx = {
 *   catalogo: { sectores[], tipos[], areas[] },  alias: { sector:{}, tipo:{}, area:{} },
 *   zonaDe(cliente), ejecutivoDe(zona),          educadorPorNombre: { CLAVE: correo },
 *   cortes: { correo: 'YYYY-MM-DD' },            reglas: { origen_min_digitos, origen_min_caracteres },
 *   formatear(date, patron)
 * }
 */
function asTransformar(entrada, ctx) {
    var problemas = [];
    var faltantes = {};            // 'tipo|ORIGINAL' → { tipo, original }
    function prob(tabla, id, tipo, detalle) { problemas.push({ tabla: tabla, id: id, tipo: tipo, detalle: detalle }); }
    function faltante(tipo, original) {
        if (!asTexto(original)) return;      // un vacío no es un nombre que haya que traducir
        faltantes[tipo + '|' + asClaveTexto(original)] = { tipo: tipo, original: asTexto(original) };
    }

    var plan = entrada.plan || [], filasSector = entrada.sectores || [];
    var acts = entrada.actividades || [], mats = entrada.materiales || [];
    // La conciliación: de cuánto había en AppSheet, cuánto entró y POR QUÉ salió lo que no entró. Cada
    // renglón de origen termina en exactamente una de estas cuentas.
    var resumen = {
        origen_plan: plan.length, origen_sectores: filasSector.length,
        origen_actividades: acts.length, origen_materiales: mats.length,
        plan_sin_id: 0, reagendadas_unidas: 0,
        sectores_sin_visita: 0, sectores_repetidos_en_visita: 0, sectores_sinteticos: 0,
        actividades_sin_id: 0, materiales_vacios: 0, materiales_sin_actividad: 0
    };

    // ---------- el plan: visitas, y qué pasó con las reagendadas ----------
    var porId = {}, hijos = {};
    plan.forEach(function (r) { var id = asTexto(r.id_plan_de_trabajo); if (id) porId[id] = r; });
    plan.forEach(function (r) {
        var id = asTexto(r.id_plan_de_trabajo), o = asTexto(r.id_origen);
        if (id && o && porId[o]) (hijos[o] = hijos[o] || []).push(id);
    });
    var estadoPlan = function (id) { return asClaveTexto(porId[id] && porId[id].status); };
    var reagendadaConHijo = function (id) { return estadoPlan(id) === 'REAGENDADO' && (hijos[id] || []).length > 0; };
    function destinoFinal(id) {
        var vistos = {};
        while (id && reagendadaConHijo(id) && !vistos[id]) { vistos[id] = 1; id = hijos[id][hijos[id].length - 1]; }
        return id;
    }
    function cuantasReagendas(id) {
        var n = 0, o = asTexto(porId[id].id_origen), vistos = {};
        while (o && porId[o] && !vistos[o]) {
            vistos[o] = 1;
            if (estadoPlan(o) === 'REAGENDADO') n++;
            o = asTexto(porId[o].id_origen);
        }
        return n;
    }

    var visitas = [], visitaPorId = {}, sectoresOut = [], actividadesOut = [], materialesOut = [];

    plan.forEach(function (r) {
        var idOrigen = asTexto(r.id_plan_de_trabajo);
        if (!idOrigen) { resumen.plan_sin_id++; return; }

        // Una visita reagendada ya no es una visita: es la historia de la que la sustituyó.
        if (reagendadaConHijo(idOrigen)) { resumen.reagendadas_unidas++; return; }

        var notas = [], bloqueante = false;
        var st = estadoPlan(idOrigen);
        var estado = { COMPLETO: 'finalizada', PENDIENTE: 'programada', CANCELADO: 'cancelada', REAGENDADO: 'cancelada' }[st];
        var motivoCancelacion = '';
        if (st === 'REAGENDADO') {
            motivoCancelacion = asTexto(r.mot_reagendado) || 'Reagendada en AppSheet sin nueva fecha';
            notas.push('Reagendada en AppSheet sin una visita nueva: se importa como cancelada');
        } else if (st === 'CANCELADO') {
            motivoCancelacion = asTexto(r.mot_reagendado) || asTexto(r.comentarios) || 'Cancelada en AppSheet';
        }
        if (!estado) { estado = 'programada'; notas.push('Estado "' + asTexto(r.status) + '" desconocido: se importa como programada'); }

        var dia = asFecha(r.fecha_de_visita, ctx);
        if (!dia) { bloqueante = true; notas.push('Sin fecha de visita'); }

        var nombre = asTexto(r.educador_pt);
        var correo = asTexto(r.correo_educador_pt).toLowerCase() || (ctx.educadorPorNombre || {})[asClaveTexto(nombre)] || '';
        if (!correo) { bloqueante = true; notas.push('Sin correo del educador'); }

        var cliente = asTexto(r.no_cliente_y_razon_social) || (asTexto(r.no_cliente) + ' ' + asTexto(r.razon_social)).trim();
        if (!cliente) { bloqueante = true; notas.push('Sin cliente'); }

        var horaInicio = asHora(r.hora_de_visita, ctx);
        if (!horaInicio) { horaInicio = '09:00'; notas.push('Sin hora de visita: se puso 09:00'); }
        var horaFin = asHora(r.hora_de_salida_prevista, ctx);
        if (!horaFin) {
            var minutos = parseInt(asTexto(r.tiempo_asignado), 10);
            horaFin = asSumarMinutos(horaInicio, minutos > 0 ? minutos : 60);
        }

        // Llegada y salida reales: es lo que hace "finalizada" a una visita.
        var checkIn = null, checkOut = null;
        var horaLlegada = asHora(r.hora_de_llegada, ctx);
        if (horaLlegada) {
            var ub = asUbicacion(r.ubicacion);
            checkIn = {
                momento: asMomento(asFecha(r.fecha_de_llegada, ctx) || dia, horaLlegada),
                lat: ub ? ub.lat : '', lng: ub ? ub.lng : ''
            };
        }
        var horaSalida = asHora(r.hora_de_salida, ctx);
        if (horaSalida) checkOut = { momento: asMomento(asFecha(r.fecha_de_salida, ctx) || dia, horaSalida) };

        if (estado === 'programada' && checkIn && checkOut) estado = 'finalizada';

        // Una visita con llegada y SIN salida está "abierta" para la app, y mientras haya una abierta
        // el educador no puede iniciar otra. En AppSheet hay cientos de visitas viejas así (llegó,
        // nunca marcó salida): importarlas tal cual bloquearía a esa persona en la app nueva. Solo
        // una de HOY se queda abierta; el resto se importa sin su llegada, con nota.
        if (checkIn && !checkOut && estado !== 'cancelada') {
            if (ctx.hoy && dia === ctx.hoy && estado === 'programada') {
                estado = 'en-proceso';
            } else {
                notas.push('Llegada registrada (' + asHora(r.hora_de_llegada, ctx) + ') sin hora de salida: se importa sin check-in para no dejar una visita abierta');
                checkIn = null;
            }
        }
        if (estado === 'finalizada' && (!checkIn || !checkOut)) {
            notas.push('Marcada como completa en AppSheet pero sin hora de llegada o de salida');
        }

        var zona = asNormalizarZona(ctx.zonaDe ? ctx.zonaDe(cliente) : '');
        var ejecutivo = ctx.ejecutivoDe && zona ? ctx.ejecutivoDe(zona) : '';

        var corte = (ctx.cortes || {})[correo];
        var estadoImport = bloqueante ? 'con_error' : 'pendiente';
        if (corte && dia && dia > corte) estadoImport = 'omitida_corte';

        var visita = {
            id_visita: 'as-' + idOrigen,
            educador: nombre, educador_correo: correo, cliente: cliente,
            hospital: asTexto(r.hospital_visitado), dia: dia, hora_inicio: horaInicio, hora_fin: horaFin,
            estado: estado, motivo_cancelacion: motivoCancelacion,
            check_in_momento: checkIn ? checkIn.momento : '', check_in_lat: checkIn ? checkIn.lat : '',
            check_in_lng: checkIn ? checkIn.lng : '',
            check_out_momento: checkOut ? checkOut.momento : '',
            reagendas: cuantasReagendas(idOrigen),
            zona: zona, ejecutivo: ejecutivo, notas: asTexto(r.comentarios),
            sectores: '', n_actividades: 0,
            puntualidad: asTexto(r.puntualidad),
            estado_revision_pt: asTexto(r.estado_revision_pt),
            efectividad: asTexto(r.estado_revision_efectividad),
            id_origen_appsheet: idOrigen,
            src_json: asSrcJson(r),
            import_estado: estadoImport, import_notas: notas.join(' | ')
        };
        visitas.push(visita);
        visitaPorId[idOrigen] = visita;
        if (notas.length && estadoImport !== 'omitida_corte') prob('AS_Visitas', visita.id_visita, 'visita', notas.join('; '));
    });

    // La visita real a la que pertenece un id del plan (la de hoy si se reagendó).
    function visitaDe(idPlan) { return visitaPorId[destinoFinal(asTexto(idPlan))] || null; }

    // ---------- sectores ----------
    var sectoresPorVisita = {};          // id plan → { CLAVE_NOMBRE → sector }
    var sectorRemap = {};                // id de sector en AppSheet → sector final
    var sectorRowPorId = {};
    filasSector.forEach(function (r) { sectorRowPorId[asTexto(r.id_pt_sectores)] = r; });

    function agregarSector(visita, idSector, nombreOriginal, fuente) {
        var idPlan = visita.id_origen_appsheet;
        var res = asResolverNombre(nombreOriginal, ctx.catalogo.sectores, (ctx.alias || {}).sector);
        if (!res.ok) faltante('sector', nombreOriginal);

        var claveNombre = asClaveTexto(res.valor);
        var grupo = (sectoresPorVisita[idPlan] = sectoresPorVisita[idPlan] || {});
        if (grupo[claveNombre]) { if (fuente) resumen.sectores_repetidos_en_visita++; return grupo[claveNombre]; }   // el mismo sector dos veces: uno solo

        var notas = [];
        if (!res.ok && asTexto(nombreOriginal)) notas.push('Sector no reconocido: "' + asTexto(nombreOriginal) + '" (' + res.motivo + ')');
        else if (res.motivo === 'truncado') notas.push('Sector completado: "' + asTexto(nombreOriginal) + '"');

        var objetivo = asTexto(fuente && fuente.objetivo) || asTexto(porId[idPlan] && porId[idPlan].objetivo);
        var origen = asLista((fuente && fuente.origen_de_actividad) || (porId[idPlan] && porId[idPlan].origen_de_actividad));
        var solicitado = asTexto(fuente && fuente.solicitante) || asTexto(porId[idPlan] && porId[idPlan].solicitante);

        if (!asTexto(nombreOriginal)) notas.push('Sector sin nombre');
        var s = {
            id_sector: idSector, id_visita: visita.id_visita,
            nombre: res.valor, nombre_original: asTexto(nombreOriginal),
            objetivo: objetivo, origen: origen.join(', '), solicitado_por: solicitado,
            src_json: fuente ? asSrcJson(fuente) : '{}',
            import_estado: visita.import_estado, import_notas: notas.join(' | ')
        };
        grupo[claveNombre] = s;
        sectoresOut.push(s);
        if (!fuente) resumen.sectores_sinteticos++;
        if (notas.length && !res.ok) prob('AS_Sectores', idSector, 'sector', notas.join('; '));
        return s;
    }

    filasSector.forEach(function (r) {
        var idSec = asTexto(r.id_pt_sectores);
        var visita = visitaDe(r.id_pt);
        if (!visita) {
            resumen.sectores_sin_visita++;
            prob('AS_Sectores', 'as-' + idSec, 'sin_visita', 'Sector de una visita que no está en el plan (' + asTexto(r.id_pt) + ')');
            return;
        }
        var s = agregarSector(visita, 'as-' + idSec, r.sector, r);
        sectorRemap[idSec] = s;
    });

    // Una visita sin sectores en PT_Sectores: se arma con lo que dice "Sectores Revisados".
    visitas.forEach(function (v) {
        var idPlan = v.id_origen_appsheet;
        if (sectoresPorVisita[idPlan] && Object.keys(sectoresPorVisita[idPlan]).length) return;
        var nombres = asLista(porId[idPlan].sectores_revisados);
        nombres.forEach(function (n, i) { agregarSector(v, 'as-' + idPlan + '-s' + (i + 1), n, null); });
        if (!nombres.length && v.import_estado !== 'omitida_corte') {
            v.import_notas = asAgregarNota(v.import_notas, 'Visita sin sectores');
            prob('AS_Visitas', v.id_visita, 'visita', 'Sin sectores');
        }
    });
    visitas.forEach(function (v) {
        v.sectores = sectoresOut.filter(function (s) { return s.id_visita === v.id_visita; })
            .map(function (s) { return s.nombre; }).join(', ');
    });

    // ---------- actividades ----------
    var actividadPorId = {};
    acts.forEach(function (r) {
        var idAct = asTexto(r.id_act);
        if (!idAct) { resumen.actividades_sin_id++; return; }
        var notas = [];

        // Visita y sector de la actividad: por el sector si se encuentra; si no, por la visita inicial.
        var filaSector = sectorRowPorId[asTexto(r.id_pt_ref)];
        var sector = sectorRemap[asTexto(r.id_pt_ref)] || null;
        var visita = sector ? visitaPorIdVisita(sector.id_visita) : null;
        function visitaPorIdVisita(idVis) { return visitas.filter(function (v) { return v.id_visita === idVis; })[0] || null; }
        if (!visita) visita = visitaDe(r.id_pt_inicial_ref);

        var idVisita = visita ? visita.id_visita : '';
        if (visita && !sector) {
            // Sin sector enlazado: el de AppSheet por nombre, o el primero de la visita.
            var delSector = asClaveTexto(asResolverNombre(r.sector_act_reg, ctx.catalogo.sectores, (ctx.alias || {}).sector).valor);
            var candidatos = sectoresOut.filter(function (s) { return s.id_visita === idVisita; });
            sector = candidatos.filter(function (s) { return asClaveTexto(s.nombre) === delSector; })[0] || candidatos[0] || null;
            notas.push('Sector enlazado por nombre');
        }
        var estadoImport = !visita ? 'sin_visita' : visita.import_estado;
        if (!visita) {
            notas.push('No se encontró la visita en el plan (' + asTexto(r.id_pt_inicial_ref) + ')');
            prob('AS_Actividades', 'as-' + idAct, 'sin_visita', notas[0]);
        } else if (!sector) {
            notas.push('La visita no tiene sectores');
        }

        var tipo = asResolverNombre(r.tipo_de_actividad, ctx.catalogo.tipos, (ctx.alias || {}).tipo);
        if (!tipo.ok) {
            faltante('tipo', r.tipo_de_actividad);
            notas.push(asTexto(r.tipo_de_actividad) ? 'Tipo no reconocido: "' + asTexto(r.tipo_de_actividad) + '"' : 'Sin tipo de actividad');
        }
        var area = asResolverArea(r.area_visitada, ctx.catalogo.areas, (ctx.alias || {}).area);
        if (asTexto(r.area_visitada) && !area.ok) { faltante('area', r.area_visitada); notas.push('Área no reconocida: "' + asTexto(r.area_visitada) + '"'); }

        var fecha = asFecha(r.fecha, ctx) || (visita ? visita.dia : '');
        var fechaDoc = asFecha(r.fecha_documento, ctx);
        if (r.fecha_documento !== '' && r.fecha_documento !== null && r.fecha_documento !== undefined && !fechaDoc) {
            notas.push('Fecha del documento no válida: ' + asTexto(r.fecha_documento));
        }

        // Evidencia. Si AppSheet ya tiene el archivo (columna `Evidencia` con su ruta en la carpeta de
        // AppSheet) la evidencia NO está pendiente: se marca como subida aunque no haya un enlace
        // que abrir, para no inflar la deuda de evidencias de cientos de actividades ya resueltas.
        // Con enlace (URL o id de Drive) además se podrá ver desde la app.
        var url = asTexto(r.evidencia_url);
        var driveId = asTexto(r.evidencia_drive_id);
        if (!url && driveId) url = 'https://drive.google.com/file/d/' + driveId + '/view';
        var ruta = asTexto(r.evidencia);
        var evidenciaEstado = (url || ruta) ? 'subida' : 'pendiente';
        if (ruta && !url) notas.push('Evidencia en AppSheet sin enlace de Drive: se marca subida, pero no se podrá ver desde la app');

        var a = {
            id_actividad: 'as-' + idAct, id_sector: sector ? sector.id_sector : '', id_visita: idVisita,
            tipo: tipo.valor, tipo_original: asTexto(r.tipo_de_actividad),
            area_visitada: area.valor, area_original: asTexto(r.area_visitada),
            fecha: fecha, fecha_documento: fechaDoc,
            guardada_momento: asMomento(fecha, '12:00'),
            guardada_usuario: visita ? visita.educador : asTexto(r.educador),
            evidencia_estado: evidenciaEstado, evidencia_url: url, evidencia_ruta: ruta,
            evidencia_nombre: asTexto(r.nombre_archivo),
            folio: asTexto(r.folio), comentarios: asTexto(r.comentarios),
            estado_actividad_appsheet: asTexto(r.estado_actividad),
            src_json: asSrcJson(r),
            import_estado: estadoImport, import_notas: notas.join(' | ')
        };
        actividadesOut.push(a);
        actividadPorId[idAct] = a;
    });

    actividadesOut.forEach(function (a) {
        var v = visitas.filter(function (x) { return x.id_visita === a.id_visita; })[0];
        if (v) v.n_actividades++;
    });

    // ---------- materiales ----------
    mats.forEach(function (r) {
        var idMat = asTexto(r.id_act_mat), idAct = asTexto(r.id_act_ref);
        var act = actividadPorId[idAct];
        var nombre = asTexto(r.material_y_descripcion) || asTexto(r.materiales) || asTexto(r.descripcion);
        var cantidadTexto = asTexto(r.cantidad), unidad = asTexto(r.um), origen = asTexto(r.folio);

        // AppSheet crea un renglón por sector aunque no se haya entregado nada: no es un material.
        if (!nombre && !cantidadTexto && !unidad && !origen) { resumen.materiales_vacios++; return; }
        if (!act) {
            resumen.materiales_sin_actividad++;
            prob('AS_Materiales', 'as-' + idMat, 'sin_actividad', 'Material de una actividad que no existe (' + idAct + ')');
            return;
        }

        var notas = [];
        if (!nombre) notas.push('Material sin nombre');
        var cantidad = cantidadTexto === '' ? '' : Number(String(cantidadTexto).replace(',', '.'));
        if (cantidad !== '' && isNaN(cantidad)) { notas.push('Cantidad no numérica: "' + cantidadTexto + '"'); cantidad = ''; }
        var pOrigen = asProblemaDeOrigen(origen, ctx.reglas);
        if (pOrigen) notas.push(pOrigen + ': "' + origen + '"');

        materialesOut.push({
            id_material: 'as-' + idMat, id_actividad: act.id_actividad, id_visita: act.id_visita,
            material: nombre, cantidad: cantidad, unidad: unidad, origen: origen,
            src_json: asSrcJson(r),
            import_estado: act.import_estado, import_notas: notas.join(' | ')
        });
        if (notas.length) prob('AS_Materiales', 'as-' + idMat, 'material', notas.join('; '));
    });

    resumen.visitas = visitas.length;
    resumen.sectores = sectoresOut.length;
    resumen.actividades = actividadesOut.length;
    resumen.materiales = materialesOut.length;
    resumen.problemas = problemas.length;
    resumen.actividades_sin_visita = actividadesOut.filter(function (a) { return a.import_estado === 'sin_visita'; }).length;

    // Debe cuadrar: si no, hay un camino que pierde renglones sin decirlo.
    resumen.cuadra_plan = resumen.origen_plan === resumen.visitas + resumen.reagendadas_unidas + resumen.plan_sin_id;
    resumen.cuadra_sectores = resumen.origen_sectores ===
        resumen.sectores - resumen.sectores_sinteticos + resumen.sectores_sin_visita + resumen.sectores_repetidos_en_visita;
    resumen.cuadra_actividades = resumen.origen_actividades === resumen.actividades + resumen.actividades_sin_id;
    resumen.cuadra_materiales = resumen.origen_materiales ===
        resumen.materiales + resumen.materiales_vacios + resumen.materiales_sin_actividad;

    return {
        visitas: visitas, sectores: sectoresOut, actividades: actividadesOut, materiales: materialesOut,
        problemas: problemas, faltantes: Object.keys(faltantes).map(function (k) { return faltantes[k]; }),
        resumen: resumen
    };
}

/**
 * Fusiona lo recién transformado con lo que ya hay en una pestaña AS_*, SIN pisar el trabajo de
 * la persona: lo que no cambió en AppSheet se queda exactamente como está (con sus correcciones y
 * su estado), y lo descartado nunca se toca. Lo que SÍ cambió en AppSheet se refresca y vuelve a
 * `pendiente` con una nota, aunque estuviera aprobado o subido: hay que revisarlo otra vez.
 */
function asFusionarTabla(def, existentes, nuevas, ahoraTexto) {
    var porId = {};
    existentes.forEach(function (e) { porId[asTexto(e[def.id])] = e; });
    var vistos = {}, salida = [];
    var cuenta = { nuevas: 0, actualizadas: 0, sin_cambio: 0, descartadas_intactas: 0 };

    nuevas.forEach(function (n) {
        var id = asTexto(n[def.id]);
        vistos[id] = true;
        n.import_hash = asHash(JSON.stringify(def.columnas.map(function (c) { return n[c]; })));
        var ex = porId[id];

        if (!ex) {
            n.import_transformado = ahoraTexto;
            n.import_subido = '';
            salida.push(n);
            cuenta.nuevas++;
            return;
        }
        if (asTexto(ex.import_hash) === n.import_hash) { salida.push(ex); cuenta.sin_cambio++; return; }
        if (asTexto(ex.import_estado) === 'descartada') { salida.push(ex); cuenta.descartadas_intactas++; return; }

        var antes = asTexto(ex.import_estado);
        if (antes === 'aprobada' || antes === 'subida') {
            n.import_estado = 'pendiente';
            n.import_notas = asAgregarNota(n.import_notas, 'Cambió en AppSheet (estaba ' + antes + '): revisar de nuevo');
        }
        n.import_transformado = ahoraTexto;
        n.import_subido = antes === 'subida' ? asTexto(ex.import_subido) : '';
        salida.push(n);
        cuenta.actualizadas++;
    });

    // Lo que ya no viene de AppSheet (lo borraron allá) se conserva: no se pierde en silencio.
    existentes.forEach(function (e) { if (!vistos[asTexto(e[def.id])]) salida.push(e); });
    return { filas: salida, cuenta: cuenta };
}

/**
 * Arma, desde las pestañas AS_*, las visitas con el MISMO árbol que manda la app
 * (visita → sectores → actividades → materiales). Solo las visitas `aprobada`; lo `descartada`
 * de cada nivel se deja fuera. Lo que la persona corrigió en las pestañas es lo que sube.
 */
function asArmarVisitas(tablas) {
    var num = function (v) { var n = Number(String(v).replace(',', '.')); return v === '' || v === null || v === undefined || isNaN(n) ? null : n; };
    var porVisita = function (filas) {
        var m = {};
        filas.forEach(function (f) {
            if (asTexto(f.import_estado) === 'descartada' || asTexto(f.import_estado) === 'sin_visita') return;
            (m[asTexto(f.id_visita)] = m[asTexto(f.id_visita)] || []).push(f);
        });
        return m;
    };
    var sectoresDe = porVisita(tablas.sectores), actividadesDe = porVisita(tablas.actividades), materialesDe = porVisita(tablas.materiales);
    var salida = [];

    tablas.visitas.filter(function (v) { return asTexto(v.import_estado) === 'aprobada'; }).forEach(function (v) {
        var idVis = asTexto(v.id_visita);
        var sello = { momento: asTexto(v.check_in_momento) || asMomento(asTexto(v.dia), asTexto(v.hora_inicio)), usuario: asTexto(v.educador) };

        var sectores = (sectoresDe[idVis] || []).map(function (s) {
            var actividades = (actividadesDe[idVis] || []).filter(function (a) { return asTexto(a.id_sector) === asTexto(s.id_sector); }).map(function (a) {
                var evidencia = { estado: asTexto(a.evidencia_estado) || 'pendiente' };
                if (asTexto(a.evidencia_url)) evidencia.url = asTexto(a.evidencia_url);
                return {
                    id: asTexto(a.id_actividad), tipo: asTexto(a.tipo), area_visitada: asTexto(a.area_visitada),
                    creada: asTexto(a.guardada_momento),
                    fecha_documento: asTexto(a.fecha_documento) || undefined,
                    contacto: {},
                    evidencia: evidencia,
                    guardada: { momento: asTexto(a.guardada_momento), usuario: asTexto(a.guardada_usuario) || sello.usuario },
                    materiales: (materialesDe[idVis] || []).filter(function (m) { return asTexto(m.id_actividad) === asTexto(a.id_actividad); }).map(function (m) {
                        return { id: asTexto(m.id_material), material: asTexto(m.material), cantidad: num(m.cantidad), unidad: asTexto(m.unidad), origen: asTexto(m.origen) };
                    })
                };
            });
            return {
                id: asTexto(s.id_sector), nombre: asTexto(s.nombre), objetivo: asTexto(s.objetivo),
                origen: asLista(s.origen), solicitado_por: asTexto(s.solicitado_por), programado: true,
                guardado: sello, actividades: actividades
            };
        });

        var reagendas = [];
        for (var i = 0; i < (num(v.reagendas) || 0); i++) reagendas.push({ id: idVis + '-r' + (i + 1) });

        var visita = {
            id: idVis, educador: asTexto(v.educador), educador_correo: asTexto(v.educador_correo).toLowerCase(),
            tipo: 'cliente', cliente: asTexto(v.cliente), hospital: asTexto(v.hospital),
            zona: asTexto(v.zona) || undefined, ejecutivo: asTexto(v.ejecutivo) || undefined, notas: asTexto(v.notas) || undefined,
            dia: asTexto(v.dia), hora_inicio: asTexto(v.hora_inicio), hora_fin: asTexto(v.hora_fin),
            estado: asTexto(v.estado), motivo_cancelacion: asTexto(v.motivo_cancelacion) || undefined,
            reagendas: reagendas, sectores: sectores, guardada: sello
        };
        if (asTexto(v.check_in_momento)) visita.check_in = { momento: asTexto(v.check_in_momento), lat: num(v.check_in_lat), lng: num(v.check_in_lng) };
        if (asTexto(v.check_out_momento)) visita.check_out = { momento: asTexto(v.check_out_momento) };
        salida.push(visita);
    });
    return salida;
}

// ============================================================================================
//  HOJAS (entrada/salida)
// ============================================================================================

/** La hoja donde la app guarda sus registros (la misma que usa el resto de Codigo.gs). */
function asLibroVisitas() {
    return libroVisitas();
}

function asLibrosDeOrigen() {
    return [
        SpreadsheetApp.openById(asIdDe('APPSHEET_ID_PLAN', AS_ID_PLAN)),
        SpreadsheetApp.openById(asIdDe('APPSHEET_ID_ACTIVIDADES', AS_ID_ACTIVIDADES))
    ];
}

/**
 * Comprueba que el script puede abrir las hojas de AppSheet y lista sus pestañas. Córrela primero:
 * si falla, casi siempre es que la hoja no está compartida con la cuenta que ejecuta el script.
 */
function appsheetVerificarAcceso() {
    [['APPSHEET_ID_PLAN', AS_ID_PLAN], ['APPSHEET_ID_ACTIVIDADES', AS_ID_ACTIVIDADES]].forEach(function (par) {
        var id = '';
        try {
            id = asIdDe(par[0], par[1]);
            var libro = SpreadsheetApp.openById(id);
            Logger.log('OK  ' + libro.getName() + ' [' + id + ']: ' +
                       libro.getSheets().map(function (h) { return h.getName() + ' (' + h.getLastRow() + ')'; }).join(', '));
        } catch (err) {
            Logger.log('NO SE PUEDE ABRIR ' + par[0] + (id ? ' (' + id + ')' : '') + ': ' + err +
                       ' — Revisa la propiedad del script ' + par[0] + ' (puedes pegar el enlace completo) ' +
                       'y que la hoja esté compartida con esta cuenta.');
        }
    });
    [AS_HOJA_PLAN, AS_HOJA_SECTORES, AS_HOJA_ACTIVIDADES, AS_HOJA_MATERIALES].forEach(function (nombre) {
        try { asBuscarHoja(nombre, asLibrosDeOrigen()); Logger.log('Pestaña encontrada: ' + nombre); }
        catch (err) { Logger.log(String(err)); }
    });
}

/** La pestaña de AppSheet por nombre, buscándola en los libros de origen. */
function asBuscarHoja(nombre, libros) {
    for (var i = 0; i < libros.length; i++) {
        var hoja = libros[i].getSheetByName(nombre);
        if (hoja) return hoja;
    }
    throw new Error('No se encontró la pestaña "' + nombre + '" en las hojas de AppSheet. ' +
                    'Comprueba que estén compartidas con la cuenta que ejecuta este script.');
}

function asLeerObjetos(hoja) {
    var datos = hoja.getDataRange().getValues();
    return asFilasAObjetos(datos);
}

/** Una pestaña AS_*: la crea con sus encabezados y formato de TEXTO (para que Sheets no
 *  convierta "2026-02-12" en fecha ni "00123" en número). */
function asHojaStaging(def, ss) {
    var cabecera = def.columnas.concat(AS_CONTROL);
    var hoja = ss.getSheetByName(def.hoja);
    if (!hoja) {
        hoja = ss.insertSheet(def.hoja);
        hoja.getRange(1, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold');
        hoja.setFrozenRows(1);
        hoja.getRange(1, 1, hoja.getMaxRows(), cabecera.length).setNumberFormat('@');
    }
    return hoja;
}

function asLeerStaging(def, hoja) {
    var datos = hoja.getDataRange().getValues();
    if (datos.length < 2) return [];
    var cabecera = datos[0].map(String);
    return datos.slice(1).filter(function (f) { return asTexto(f[cabecera.indexOf(def.id)]) !== ''; }).map(function (fila) {
        var o = {};
        cabecera.forEach(function (c, i) { o[c] = fila[i] === null || fila[i] === undefined ? '' : fila[i]; });
        return o;
    });
}

function asEscribirStaging(def, hoja, filas) {
    var cabecera = def.columnas.concat(AS_CONTROL);
    hoja.getRange(2, 1, Math.max(hoja.getMaxRows() - 1, 1), cabecera.length).clearContent();
    if (!filas.length) return;
    if (hoja.getMaxRows() < filas.length + 1) hoja.insertRowsAfter(hoja.getMaxRows(), filas.length + 1 - hoja.getMaxRows());
    var valores = filas.map(function (f) {
        return cabecera.map(function (c) { var v = f[c]; return v === null || v === undefined ? '' : v; });
    });
    var rango = hoja.getRange(2, 1, valores.length, cabecera.length);
    rango.setNumberFormat('@');
    rango.setValues(valores);
}

/** Pestaña de configuración sencilla (clave/valor por renglón), creada vacía si no existe. */
function asHojaConfig(ss, nombre, cabecera, ejemplo) {
    var hoja = ss.getSheetByName(nombre);
    if (!hoja) {
        hoja = ss.insertSheet(nombre);
        hoja.getRange(1, 1, 1, cabecera.length).setValues([cabecera]).setFontWeight('bold');
        hoja.setFrozenRows(1);
        hoja.getRange(1, 1, hoja.getMaxRows(), cabecera.length).setNumberFormat('@');
        if (ejemplo) hoja.getRange(2, 1, 1, ejemplo.length).setValues([ejemplo]).setFontStyle('italic');
    }
    return hoja;
}

function asLeerCortes(ss) {
    var hoja = asHojaConfig(ss, 'AS_Corte', ['correo', 'importar_hasta', 'nota'],
        ['correo@degasa.com', '2026-10-31', 'EJEMPLO — borra este renglón. Solo se importa hasta esa fecha (inclusive)']);
    var cortes = {};
    asFilasAObjetos(hoja.getDataRange().getValues()).forEach(function (r) {
        var correo = asTexto(r.correo).toLowerCase(), hasta = asFecha(r.importar_hasta, { formatear: function (d, p) { return Utilities.formatDate(d, AS_ZONA, p); } });
        if (correo && hasta && correo !== 'correo@degasa.com') cortes[correo] = hasta;
    });
    return cortes;
}

function asLeerAlias(ss) {
    var hoja = asHojaConfig(ss, 'AS_Alias', ['tipo', 'original', 'valor'], null);
    var alias = { sector: {}, tipo: {}, area: {} };
    asFilasAObjetos(hoja.getDataRange().getValues()).forEach(function (r) {
        var tipo = asTexto(r.tipo).toLowerCase(), original = asClaveTexto(r.original), valor = asTexto(r.valor);
        if (alias[tipo] && original && valor) alias[tipo][original] = valor;
    });
    return alias;
}

/** Agrega a AS_Alias los nombres que no se pudieron resolver, con `valor` vacío, para que la
 *  persona escriba a qué corresponden; la siguiente corrida los usa. */
function asPedirAlias(ss, faltantes) {
    if (!faltantes.length) return;
    var hoja = asHojaConfig(ss, 'AS_Alias', ['tipo', 'original', 'valor'], null);
    var existentes = {};
    asFilasAObjetos(hoja.getDataRange().getValues()).forEach(function (r) { existentes[asTexto(r.tipo).toLowerCase() + '|' + asClaveTexto(r.original)] = true; });
    var nuevos = faltantes.filter(function (f) { return !existentes[f.tipo + '|' + asClaveTexto(f.original)]; })
        .map(function (f) { return [f.tipo, f.original, '']; });
    if (nuevos.length) hoja.getRange(hoja.getLastRow() + 1, 1, nuevos.length, 3).setNumberFormat('@').setValues(nuevos);
}

function asEscribirProblemas(ss, problemas, resumen) {
    var hoja = ss.getSheetByName('AS_Problemas') || ss.insertSheet('AS_Problemas');
    hoja.clear();
    var cab = ['tabla', 'id', 'tipo', 'detalle'];
    hoja.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    hoja.setFrozenRows(1);
    if (problemas.length) {
        hoja.getRange(2, 1, problemas.length, cab.length)
            .setValues(problemas.map(function (p) { return [p.tabla, p.id, p.tipo, p.detalle]; }));
    }

    var res = ss.getSheetByName('AS_Resumen') || ss.insertSheet('AS_Resumen');
    res.clear();
    var filas = [['dato', 'valor'], ['última transformación', new Date()]];
    Object.keys(resumen).forEach(function (k) { filas.push([k, resumen[k]]); });
    res.getRange(1, 1, filas.length, 2).setValues(filas);
    res.getRange(1, 1, 1, 2).setFontWeight('bold');
}

function asContextoDeCatalogos(db, ss) {
    var educadores = {};
    leerEducadores(db).forEach(function (e) { if (e.correo) educadores[asClaveTexto(e.nombre)] = e.correo.toLowerCase(); });

    var zonas = leerClientesZona(db), ejecutivos = leerEjecutivos(db);
    var porNumero = {};
    Object.keys(zonas).forEach(function (c) { porNumero[asTexto(c).split(' ')[0]] = zonas[c]; });
    var ejecutivosNorm = {};
    Object.keys(ejecutivos).forEach(function (z) { ejecutivosNorm[asNormalizarZona(z)] = ejecutivos[z]; });

    var tz = ss.getSpreadsheetTimeZone() || AS_ZONA;
    return {
        catalogo: {
            sectores: leerSectores(db),
            tipos: leerTipos().map(function (t) { return t.nombre; }),
            areas: leerAreas(db)
        },
        alias: asLeerAlias(ss),
        educadorPorNombre: educadores,
        zonaDe: function (cliente) { return zonas[cliente] || porNumero[asTexto(cliente).split(' ')[0]] || ''; },
        ejecutivoDe: function (zona) { return ejecutivosNorm[asNormalizarZona(zona)] || ''; },
        cortes: asLeerCortes(ss),
        reglas: leerReglasCaptura(db) || { origen_min_digitos: 6, origen_min_caracteres: 3 },
        hoy: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'),
        formatear: function (fecha, patron) { return Utilities.formatDate(fecha, tz, patron); }
    };
}

// ============================================================================================
//  ENTRADAS (se ejecutan desde el editor de Apps Script o por trigger)
// ============================================================================================

/**
 * Paso 1: trae AppSheet, transforma y deja todo en las pestañas AS_* para revisarlo.
 * No toca Supabase. Es seguro correrla las veces que haga falta.
 */
function appsheetTransformar() {
    var candado = LockService.getScriptLock();
    if (!candado.tryLock(60000)) { Logger.log('appsheetTransformar: otra corrida en curso'); return; }

    try {
        var ss = asLibroVisitas();
        var db = SpreadsheetApp.openById(SHEET_DB_ID);
        var libros = asLibrosDeOrigen();

        var ctx = asContextoDeCatalogos(db, ss);
        var entrada = {
            plan: asLeerObjetos(asBuscarHoja(AS_HOJA_PLAN, libros)),
            sectores: asLeerObjetos(asBuscarHoja(AS_HOJA_SECTORES, libros)),
            actividades: asLeerObjetos(asBuscarHoja(AS_HOJA_ACTIVIDADES, libros)),
            materiales: asLeerObjetos(asBuscarHoja(AS_HOJA_MATERIALES, libros))
        };

        var resultado = asTransformar(entrada, ctx);
        var ahora = Utilities.formatDate(new Date(), AS_ZONA, "yyyy-MM-dd'T'HH:mm:ss");
        var resumen = resultado.resumen;

        ['visitas', 'sectores', 'actividades', 'materiales'].forEach(function (clave) {
            var def = AS_COLUMNAS[clave];
            var hoja = asHojaStaging(def, ss);
            var fusion = asFusionarTabla(def, asLeerStaging(def, hoja), resultado[clave], ahora);
            asEscribirStaging(def, hoja, fusion.filas);
            Object.keys(fusion.cuenta).forEach(function (k) { resumen[clave + '_' + k] = fusion.cuenta[k]; });
        });

        asPedirAlias(ss, resultado.faltantes);
        asEscribirProblemas(ss, resultado.problemas, resumen);
        Logger.log('AppSheet transformado: ' + JSON.stringify(resumen));
    } finally {
        candado.releaseLock();
    }
}

/**
 * Paso 3: sube a Supabase solo lo que la persona marcó `aprobada` en AS_Visitas.
 *
 * Usa `pdt_appsheet_importar`, que guarda con la misma función que la app (`pdt_espejo_guardar`):
 * lo importado se comporta como lo capturado en la app, y de paso se encola para las pestañas
 * normales. Una visita que alguien ya editó en la app después de importarse no se pisa.
 */
function appsheetSubirAprobadas() {
    var candado = LockService.getScriptLock();
    if (!candado.tryLock(60000)) { Logger.log('appsheetSubirAprobadas: otra corrida en curso'); return; }

    try {
        var ss = asLibroVisitas();
        var hojas = {}, tablas = {};
        ['visitas', 'sectores', 'actividades', 'materiales'].forEach(function (clave) {
            hojas[clave] = asHojaStaging(AS_COLUMNAS[clave], ss);
            tablas[clave] = asLeerStaging(AS_COLUMNAS[clave], hojas[clave]);
        });

        var visitas = asArmarVisitas(tablas);
        if (!visitas.length) { Logger.log('No hay visitas aprobadas por subir.'); return; }

        var subidas = {}, omitidas = [], errores = [];
        var LOTE = 15;
        for (var i = 0; i < visitas.length; i += LOTE) {
            var lote = visitas.slice(i, i + LOTE);
            var r = supabaseRPCEstricto('pdt_appsheet_importar', { p_visitas: lote });
            if (!r.ok) { errores.push(r.error); break; }        // se corta: no seguir contra un error
            (r.datos.omitidas || []).forEach(function (o) { omitidas.push(o); });
            (r.datos.importadas || []).forEach(function (id) { subidas[id] = true; });
        }

        var ahora = Utilities.formatDate(new Date(), AS_ZONA, "yyyy-MM-dd'T'HH:mm:ss");
        // Lo subido pasa a `subida`; lo omitido se anota para que la persona lo vea.
        var omitidasPorId = {};
        omitidas.forEach(function (o) { omitidasPorId[o.id] = o.motivo; });

        ['visitas', 'sectores', 'actividades', 'materiales'].forEach(function (clave) {
            var def = AS_COLUMNAS[clave];
            tablas[clave].forEach(function (f) {
                var idVis = asTexto(f.id_visita);
                if (subidas[idVis] && asTexto(f.import_estado) !== 'descartada' && asTexto(f.import_estado) !== 'sin_visita') {
                    f.import_estado = 'subida'; f.import_subido = ahora;
                } else if (omitidasPorId[idVis] && clave === 'visitas') {
                    f.import_notas = asAgregarNota(f.import_notas, 'No se subió: ' + omitidasPorId[idVis]);
                }
            });
            asEscribirStaging(def, hojas[clave], tablas[clave]);
        });

        Logger.log('Subidas: ' + Object.keys(subidas).length + ' · omitidas: ' + omitidas.length + ' · errores: ' + errores.join('; '));
        if (errores.length) throw new Error('Supabase rechazó el lote: ' + errores[0]);
    } finally {
        candado.releaseLock();
    }
}

/**
 * Atajo: marca `aprobada` toda visita `pendiente` que no trae ninguna nota de problema.
 * Úsalo SOLO después de haber revisado la pestaña; lo que tenga notas se queda para revisión.
 */
function appsheetAprobarLasLimpias() {
    var ss = asLibroVisitas();
    var def = AS_COLUMNAS.visitas;
    var hoja = asHojaStaging(def, ss);
    var filas = asLeerStaging(def, hoja);
    var n = 0;
    filas.forEach(function (f) {
        if (asTexto(f.import_estado) === 'pendiente' && asTexto(f.import_notas) === '') { f.import_estado = 'aprobada'; n++; }
    });
    asEscribirStaging(def, hoja, filas);
    Logger.log('Marcadas como aprobadas: ' + n);
}

/** Corre appsheetTransformar cada hora (solo transforma: subir siempre lo decide una persona). */
function appsheetInstalarTrigger() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
        if (t.getHandlerFunction() === 'appsheetTransformar') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('appsheetTransformar').timeBased().everyHours(1).create();
    Logger.log('Trigger instalado: appsheetTransformar cada hora.');
}
