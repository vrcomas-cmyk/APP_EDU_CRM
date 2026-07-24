-- Normaliza el formato de zona a 3 dígitos con ceros a la izquierda ("1" -> "001").
--
-- La app ya lo hace desde ahora en el único punto donde el catálogo crudo de Apps Script entra
-- (ver `normalizarZonasDelCatalogo` en js/sync.js), pero las filas que YA existían en estas tres
-- tablas se guardaron con el formato que "Gpo. vendedores"/"Zona" traía tecleado a mano en la
-- hoja de origen — sin este backfill, `pdt_visitas_en_alcance` y el panel de Territorios
-- dejarían de emparejar "002" (nuevo) contra "2" (viejo) para el mismo educador.

update pdt_zona_educador
   set zona = lpad(zona, 3, '0')
 where zona ~ '^[0-9]+$' and zona <> lpad(zona, 3, '0');

update pdt_zona_cobertura
   set zona = lpad(zona, 3, '0')
 where zona ~ '^[0-9]+$' and zona <> lpad(zona, 3, '0');

update pdt_visitas
   set zona = lpad(zona, 3, '0')
 where zona ~ '^[0-9]+$' and zona <> lpad(zona, 3, '0');
