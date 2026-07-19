-- Extiende el dataset demo YA EXISTENTE (51 visitas de ana.demo/beto.demo/caro.demo, bajo
-- gerente.demo@demo.degasa.com) en vez de crear uno paralelo: es más rico que cualquier cosa
-- que se sembrara desde cero (evidencias subidas y pendientes, canceladas, en proceso,
-- programadas, varias semanas). Aquí solo se agrega lo que faltaba para probar la Ronda 2:
--
-- 1) Solape real de jerarquía usando el correo real del usuario que prueba (vcomas@degasa.com)
--    como analista, junto a `analista.demo@demo.degasa.com` que ya existía sin asignar —
--    exactamente el escenario pedido: dos analistas, un educador en común.
--        vcomas@degasa.com          -> ana.demo, caro.demo
--        analista.demo@degasa.com   -> beto.demo, caro.demo     (se comparte a caro.demo)
--
-- 2) Comentarios (antes en cero) sobre visitas y sectores REALES ya sembrados, repartidos en
--    dos clientes con varias visitas en fechas distintas, para poder probar el histórico por
--    cliente (`historicoDeHospital`) con algo que de verdad se repite.
--
-- Reversión: `scripts/limpiar_demo.sql` borra solo lo que este archivo agrega (las dos filas
-- de jerarquía de vcomas/analista.demo y los comentarios `demo-c*`), sin tocar el dataset
-- original.

begin;

insert into pdt_jerarquia (jefe, subordinado) values
    ('vcomas@degasa.com', 'ana.demo@demo.degasa.com'),
    ('vcomas@degasa.com', 'caro.demo@demo.degasa.com'),
    ('analista.demo@demo.degasa.com', 'beto.demo@demo.degasa.com'),
    ('analista.demo@demo.degasa.com', 'caro.demo@demo.degasa.com')
on conflict do nothing;

insert into pdt_comentarios (id, ambito, id_ambito, id_visita, cliente, hospital, texto, usuario, usuario_correo, momento) values
    -- Angeles Pedregal: tres comentarios en fechas distintas, de dos educadores distintos.
    ('demo-c1', 'visita', 'v-demo-2-8', 'v-demo-2-8', '100234 HOSPITAL ANGELES PEDREGAL', 'Angeles Pedregal',
     'El jefe de piso pidió reforzar el manejo de gasas y apósitos en el siguiente ciclo.',
     'Caro Silva (demo)', 'caro.demo@demo.degasa.com', '2026-06-22 16:00:00+00'),
    ('demo-c2', 'visita', 'v-demo-0-5', 'v-demo-0-5', '100234 HOSPITAL ANGELES PEDREGAL', 'Angeles Pedregal',
     'Seguimiento a lo que dejó Caro el mes pasado: ya se ve mejora en el manejo de guantes.',
     'Ana Torres (demo)', 'ana.demo@demo.degasa.com', '2026-07-03 15:30:00+00'),
    ('demo-c3', 'sector', 'v-demo-2-3-s1', 'v-demo-2-3', '100234 HOSPITAL ANGELES PEDREGAL', 'Angeles Pedregal',
     'El sector de Gasas y Apósitos sigue pidiendo material de más gramaje; ya se lo hice saber a compras.',
     'Caro Silva (demo)', 'caro.demo@demo.degasa.com', '2026-07-07 15:45:00+00'),
    -- Hospital Español: histórico entre ana y caro sobre el mismo cliente.
    ('demo-c4', 'visita', 'v-demo-2-4', 'v-demo-2-4', '100781 HOSPITAL ESPANOL', 'Espanol',
     'Piden que la próxima visita incluya al personal de nuevo ingreso de Soluciones.',
     'Caro Silva (demo)', 'caro.demo@demo.degasa.com', '2026-07-04 15:20:00+00'),
    ('demo-c5', 'visita', 'v-demo-0-1', 'v-demo-0-1', '100781 HOSPITAL ESPANOL', 'Espanol',
     'Se incluyó al personal nuevo como pidieron la vez pasada; quedaron conformes.',
     'Ana Torres (demo)', 'ana.demo@demo.degasa.com', '2026-07-15 15:10:00+00'),
    ('demo-c6', 'visita', 'v-demo-2-14', 'v-demo-2-14', '100781 HOSPITAL ESPANOL', 'Espanol',
     'El hospital solicitó cambiar el horario habitual de visita a partir del próximo mes.',
     'Caro Silva (demo)', 'caro.demo@demo.degasa.com', '2026-07-16 15:25:00+00')
on conflict (id) do nothing;

commit;
