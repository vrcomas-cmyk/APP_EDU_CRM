# scripts/

Herramientas de prueba manual. No forman parte del build ni de la app: no las importa
`vite.config.ts`, no viajan al paquete que descarga el navegador.

## `demo_session.py`

Simula una sesión de administrador sin loguearse con Google, para poder probar la app en el
navegador (o con Playwright) sin depender de una cuenta real. No modifica ningún archivo de la
app: siembra `localStorage` con la misma forma que ya usan `js/auth.js` y `js/permisos.js`, e
intercepta la llamada a Supabase (`pdt_perfil`) para que devuelva un perfil fijo en vez de
depender del estado real de la base.

Requiere Playwright:
```
pip install playwright
playwright install chromium
```

Smoke check rápido (con el server de dev ya levantado en otra terminal):
```
npm run dev
python scripts/demo_session.py
```

Como módulo, desde otro script:
```python
from demo_session import preparar_pagina
with sync_playwright() as p:
    browser, page = preparar_pagina(p)
    # page ya tiene la app cargada y logueada
```

## `check_modulos.py`

Recorre los cuatro módulos (Calendario, Indicadores, Revisión, Administración) usando la sesión
de `demo_session.py` y comprueba que el FAB "Nueva visita" solo aparezca en Calendario.

```
npm run dev
python scripts/check_modulos.py
```

## `check_accesos.py`

Verifica Administración → Accesos (Roles, Usuarios, Jerarquía) interceptando el Apps Script real
con respuestas fijas, porque `leerRBAC`/`guardarRoles`/`guardarUsuarios` verifican identidad
Google de verdad y un JWT falso no las pasaría.

```
npm run dev
python scripts/check_accesos.py
```

## `limpiar_demo.sql`

Revierte la semilla de datos demo de `supabase/migrations/20260719e_semilla_demo.sql`: quita el
solape de jerarquía de prueba (`vcomas@degasa.com` / `analista.demo@demo.degasa.com` sobre
`ana.demo`/`beto.demo`/`caro.demo`) y los comentarios `demo-c*`. **No toca** el dataset demo
original (`v-demo-*`, `gerente.demo@degasa.com`) que ya existía antes de esta ronda de trabajo.

Ejecutar contra el proyecto Supabase (SQL editor o el MCP `execute_sql`) cuando ya no se
necesite seguir probando con este solape.
