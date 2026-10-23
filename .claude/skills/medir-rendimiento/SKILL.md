---
name: medir-rendimiento
description: Mide en Chrome (solo lectura) si la app Plan de Trabajo bloquea el hilo principal tras sincronizar — tareas largas, JSON.parse repetidos y peticiones lentas. Úsala cuando el usuario diga que la app va lenta, los filtros no reaccionan o se escribe con retraso, y antes/después de cualquier cambio de rendimiento.
---

# Medir rendimiento de la app (sin escribir datos)

Línea base 23/10/2026 (producción, antes de optimizar): tras cada sync (cada 60 s) 8–10 tareas
largas de 240–880 ms (2–4 s bloqueados) y ~2.800 `JSON.parse` de 1,3 MB en 87 s.

## Requisitos
- Herramientas de Claude in Chrome (`mcp__claude-in-chrome__*`; cárgalas con ToolSearch en una sola
  llamada) y una pestaña NUEVA en la URL de la app con la sesión ya iniciada. Nunca inicies sesión
  por la persona: si pide login, detente y avísale.
- Solo lectura: no pulses botones, no dispares `pdt:sincronizar` (sube datos), no edites nada.

## Pasos
1. `navigate` a la app y confirma con una captura que hay sesión.
2. Instala los medidores con `javascript_tool` (una sola vez por carga de página):
   ```js
   (() => {
     const m = window.__med = { t0: performance.now(), long: [], fetch: [] };
     new PerformanceObserver(l => l.getEntries().forEach(e =>
       m.long.push({ at: Math.round(e.startTime - m.t0), ms: Math.round(e.duration) })))
       .observe({ entryTypes: ['longtask'] });
     const of = window.fetch;
     window.fetch = function (...a) {
       const u = String(a[0]?.url || a[0]), s = performance.now();
       return of.apply(this, a).then(r => { m.fetch.push({ at: Math.round(s - m.t0),
         ms: Math.round(performance.now() - s), u: u.replace(/https?:\/\/[^/]+/, '').slice(0, 70), st: r.status }); return r; });
     };
     const p = JSON.parse, s = window.__jp = { n: 0, ms: 0, big: 0, bigMs: 0 };
     JSON.parse = function (t, r) { const a = performance.now(), x = p.call(this, t, r), d = performance.now() - a;
       s.n++; s.ms += d; if (typeof t === 'string' && t.length > 200000) { s.big++; s.bigMs += d; } return x; };
     return 'ok';
   })()
   ```
3. Deja pasar al menos **un ciclo de sync completo (~65 s)**. Cada llamada de `javascript_tool`
   corta a los 45 s: usa esperas de ≤40 s (`await new Promise(r => setTimeout(r, 40000))`) en dos
   llamadas seguidas, no una de 130 s.
4. Lee el resultado:
   ```js
   const m = window.__med, s = window.__jp;
   ({ seg: Math.round((performance.now() - m.t0) / 1000), longtasks: m.long, fetch: m.fetch,
      jsonParse: { llamadas: s.n, msTotal: Math.round(s.ms), grandes: s.big, msGrandes: Math.round(s.bigMs) } })
   ```
5. Compara con los umbrales y con la línea base. Las tareas largas se agrupan justo después de las
   peticiones `pdt_visitas_equipo_sesion` / `pdt_avisos_mios_sesion`: eso es la sync.

## Umbrales de aceptación (por ciclo de 60 s)
- Ninguna tarea larga > 200 ms después de una sync (ideal: 0 tareas largas).
- Menos de 100 `JSON.parse` de más de 200 KB por minuto (ideal: 0–2).
- Peticiones a Supabase < 1 s; a Apps Script informar aparte (hoy ~3,5–4 s por minuto).

## Qué mirar si falla
- Muchos `JSON.parse` grandes → algún lector de `localStorage` sin caché (`js/storage.js`
  `leerCatalogo`, `js/auth.js` `sesionActual`, `js/simulacion.js` `leer`).
- Tareas largas sin `JSON.parse` → repintados completos: `refrescarVistas()` en
  `src/app/montarVistas.tsx` re-renderiza todo el Shell; revisa los `useMemo` con `[version]`.
- Supabase: consultas lentas con `pg_stat_statements` (proyecto de producción
  `fiplfsuhsqibzrpvjvbx`, el de `.env`; `APP_EDU_CRM` es el de pruebas).
