-- Revierte por completo la semilla de `20260719e_semilla_demo.sql`.
--
-- Importante: esto NO toca el dataset demo original (visitas `v-demo-*` de ana.demo/beto.demo/
-- caro.demo bajo gerente.demo@degasa.com) — ese ya existía antes de esta ronda y no es de aquí.
-- Solo borra lo que este trabajo agregó encima: las dos relaciones de jerarquía nuevas y los
-- comentarios de prueba.

begin;

delete from pdt_comentarios where id in ('demo-c1', 'demo-c2', 'demo-c3', 'demo-c4', 'demo-c5', 'demo-c6');

delete from pdt_jerarquia
    where (jefe = 'vcomas@degasa.com' and subordinado in ('ana.demo@demo.degasa.com', 'caro.demo@demo.degasa.com'))
       or (jefe = 'analista.demo@demo.degasa.com' and subordinado in ('beto.demo@demo.degasa.com', 'caro.demo@demo.degasa.com'));

commit;
