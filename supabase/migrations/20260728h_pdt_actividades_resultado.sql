-- Plan de Trabajo — campo "Resultado" en pdt_actividades.
--
-- ⚠ Proyecto COMPARTIDO con otras aplicaciones. Todo lleva prefijo `pdt_` y es ADITIVO.
--
-- El histórico viejo ("Registro Actividades") trae un Resultado (Positiva/Negativa/No Aplica)
-- por actividad que la captura en vivo no pedía. Se agrega la columna, nullable, para no
-- perder ese dato al integrar el histórico como actividades reales; queda disponible para
-- captura en vivo a futuro también, aunque hoy nada la llene salvo la carga histórica.
alter table pdt_actividades add column if not exists resultado text;
