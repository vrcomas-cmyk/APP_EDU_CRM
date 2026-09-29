-- Las lecturas con token de sesión llaman a pdt_correo_de_sesion(), que hace UPDATE de
-- `ultimo_uso`. Marcadas como STABLE, PostgREST las ejecuta en una transacción de solo lectura
-- y fallan con 25006 "cannot execute UPDATE in a read-only transaction" (HTTP 405): la PWA
-- dejaba de ver estrategias y pendientes del equipo. Deben ser VOLATILE.
alter function pdt_estrategias_leer_sesion(text) volatile;
alter function pdt_pendientes_equipo_sesion(text, text, int) volatile;
