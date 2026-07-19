/*
 * Resultados configurables por flujo de revisión.
 *
 * ── El problema ──────────────────────────────────────────────────────────────────────
 *
 * `pdt_revisiones.resultado` tenía un CHECK con tres valores fijos: aprobado, rechazado y
 * requiere corrección. Sirve para "¿pasa o no pasa?", que es la pregunta de una evidencia.
 *
 * No sirve para calificar. "¿Fue efectiva la visita?" no se responde con "aprobado", y
 * "¿se justifica el retraso?" tampoco: son escalas propias que hoy había que disfrazar de
 * aprobación. Y cada criterio nuevo que quisiera su propio vocabulario exigía una migración
 * de esquema, que es justo lo que `pdt_flujos_revision` existe para evitar —su comentario
 * dice que agregar un flujo no requiere tocar la aplicación—.
 *
 * ── El cambio ────────────────────────────────────────────────────────────────────────
 *
 * Cada flujo declara sus veredictos, igual que cada tipo de actividad declara sus campos.
 * El CHECK global desaparece y la validación pasa a ser contra el flujo: "efectiva" es un
 * resultado válido en calidad de visita y no significa nada en evidencias.
 *
 * Los flujos que ya existen NO se tocan: `resultados` queda en null y tanto el cliente como
 * la validación caen en los tres de siempre. Es lo que permite desplegar esto sin coordinar
 * con un despliegue de la app.
 */

-- ---------- los veredictos son datos del flujo ----------

alter table pdt_flujos_revision
    add column if not exists resultados jsonb;

comment on column pdt_flujos_revision.resultados is
    'Veredictos que admite este flujo. Null = los tres por defecto (aprobado / rechazado / '
    'requiere corrección). Cada uno: { valor, etiqueta, accion, tono, estilo, '
    'exige_observaciones, acepta, cierra }. `acepta` es "el trabajo se da por bueno" y '
    '`cierra` es "la revisión terminó": son ejes distintos, rechazado cierra sin aceptar.';

/*
 * Forma mínima exigible. No se valida cada campo —eso vive en la app, que es quien los
 * dibuja— pero sí que sea una lista no vacía con `valor` y `etiqueta`: un flujo con
 * `resultados: []` dejaría la bandeja sin un solo botón y sin forma de saber por qué.
 */
alter table pdt_flujos_revision
    drop constraint if exists pdt_flujos_resultados_forma;

alter table pdt_flujos_revision
    add constraint pdt_flujos_resultados_forma check (
        resultados is null
        or (
            jsonb_typeof(resultados) = 'array'
            and jsonb_array_length(resultados) > 0
            and not exists (
                select 1
                from jsonb_array_elements(resultados) r
                where coalesce(r->>'valor', '') = ''
                   or coalesce(r->>'etiqueta', '') = ''
            )
        )
    );

-- ---------- el resultado deja de tener una lista global ----------

/*
 * Se sustituye el CHECK cerrado por uno de forma. Qué valores son válidos lo decide el flujo
 * al que pertenece la revisión, y comprobarlo aquí exigiría un subselect por fila en una
 * tabla que crece sin límite.
 *
 * Lo que sí se mantiene es que no esté vacío: una revisión sin veredicto no afirma nada y
 * ensuciaría el histórico, que es lo único que no se puede reescribir después.
 */
alter table pdt_revisiones
    drop constraint if exists pdt_revisiones_resultado_check;

alter table pdt_revisiones
    add constraint pdt_revisiones_resultado_no_vacio
        check (length(trim(resultado)) > 0);

-- ---------- el cliente necesita recibirlos ----------

create or replace function pdt_flujos_activos()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'clave', clave, 'nombre', nombre, 'descripcion', descripcion,
        'ambito', ambito, 'permiso', permiso, 'orden', orden,
        -- Va tal cual, null incluido: el cliente distingue "sin configurar" —y usa los tres
        -- de siempre— de "configurado", y esa distinción se perdería mandando '[]'.
        'resultados', resultados
    ) order by orden, clave), '[]'::jsonb)
    from pdt_flujos_revision where activo
$$;

-- ---------- ejemplo: calificar la visita deja de ser aprobar/rechazar ----------

/*
 * Se aplica solo a `calidad_visita`, y solo si nadie lo configuró ya.
 *
 * Es el caso que motivó todo esto: la pregunta real no es "¿apruebas esta visita?" sino
 * "¿fue efectiva?". Con el vocabulario viejo, un gerente que la considerara floja tenía que
 * elegir entre "rechazado" —que suena a fraude— y aprobarla igual.
 *
 * «Parcial» acepta y cierra: la visita cuenta, y el matiz queda escrito en las observaciones
 * para la conversación con el educador. «No efectiva» no acepta pero cierra: es un juicio
 * emitido, no una tarea devuelta; devolverla no tendría sentido porque la visita ya ocurrió
 * y no se puede rehacer.
 */
update pdt_flujos_revision
set resultados = '[
    {"valor":"efectiva","etiqueta":"Efectiva","accion":"✓ Efectiva",
     "tono":"completa","estilo":"principal","acepta":true,"cierra":true},

    {"valor":"parcial","etiqueta":"Parcialmente efectiva","accion":"~ Parcial",
     "tono":"faltan-evidencias","estilo":"txt","exige_observaciones":true,
     "acepta":true,"cierra":true},

    {"valor":"no_efectiva","etiqueta":"No efectiva","accion":"✕ No efectiva",
     "tono":"sin-registrar","estilo":"peligro","exige_observaciones":true,
     "acepta":false,"cierra":true}
]'::jsonb
where clave = 'calidad_visita' and resultados is null;

/*
 * Y la puntualidad, que tampoco es aprobar: es decidir si la tardanza tiene justificación.
 *
 * «Pendiente de explicar» no cierra: devuelve el elemento a la cola porque de verdad falta
 * algo que solo el educador puede aportar.
 */
update pdt_flujos_revision
set resultados = '[
    {"valor":"justificado","etiqueta":"Retraso justificado","accion":"✓ Justificado",
     "tono":"completa","estilo":"principal","acepta":true,"cierra":true},

    {"valor":"sin_justificar","etiqueta":"Sin justificación","accion":"✕ Sin justificar",
     "tono":"sin-registrar","estilo":"peligro","exige_observaciones":true,
     "acepta":false,"cierra":true},

    {"valor":"por_explicar","etiqueta":"Pendiente de explicar","accion":"↺ Pedir explicación",
     "tono":"faltan-evidencias","estilo":"txt","exige_observaciones":true,
     "acepta":false,"cierra":false}
]'::jsonb
where clave = 'retrasos' and resultados is null;
