-- El rol anon (el que usa la app con la clave pública) cortaba cualquier consulta a los 3 s y devolvía
-- 500 "canceling statement due to statement timeout" en los picos de uso. Se sube a 10 s.
-- Ya aplicada en Supabase (proyecto fiplfsuhsqibzrpvjvbx). El rol lo comparten las demás apps del proyecto.
-- Revertir: alter role anon set statement_timeout = '3s';
alter role anon set statement_timeout = '10s';
notify pgrst, 'reload config';
