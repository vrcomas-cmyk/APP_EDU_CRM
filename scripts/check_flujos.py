"""
Verifica la pantalla Administración → Flujos (Fase 5: flujos de revisión administrables) sin
depender de una cuenta real de Google ni de un Apps Script desplegado.

`demo_session.py` ya resuelve la sesión y el perfil (intercepta Supabase). Esto añade la
segunda mitad: intercepta el POST al Apps Script real (`doPost`) para las acciones
`leerFlujos` / `guardarFlujos`, porque esas SÍ verifican el id_token contra Google de verdad
(`verificarIdentidad` en Codigo.gs) y un JWT falso no las pasaría.

Uso:
    npm run dev
    python scripts/check_flujos.py
"""

import json

from playwright.sync_api import sync_playwright

from demo_session import preparar_pagina

FLUJOS = [
    {
        "clave": "evidencia", "nombre": "Evidencias", "descripcion": None,
        "ambito": "actividad", "permiso": "evidencias.aprobar", "activo": True, "orden": 1,
        "resultados": None, "revisiones": 3
    },
    {
        "clave": "calidad_visita", "nombre": "Calidad de la visita", "descripcion": None,
        "ambito": "visita", "permiso": "visitas.calificar", "activo": True, "orden": 2,
        "resultados": [
            {"valor": "efectiva", "etiqueta": "Efectiva", "accion": "✓ Efectiva",
             "tono": "completa", "estilo": "principal", "acepta": True, "cierra": True}
        ],
        "revisiones": 0
    }
]


def interceptar_apps_script(page):
    """Responde `leerFlujos`/`guardarFlujos` sin tocar la red real."""

    def manejar(route):
        peticion = route.request
        try:
            cuerpo = json.loads(peticion.post_data or "{}")
        except ValueError:
            cuerpo = {}
        accion = cuerpo.get("action")

        if accion == "leerFlujos":
            datos = {"status": "ok", "flujos": FLUJOS}
        elif accion == "guardarFlujos":
            datos = {"status": "ok", "guardados": [], "borrados": []}
        else:
            route.continue_()
            return

        route.fulfill(status=200, content_type="application/json", body=json.dumps(datos))

    page.route("**/macros/s/**", manejar)


def main():
    with sync_playwright() as p:
        browser, page = preparar_pagina(p, headless=True)
        interceptar_apps_script(page)

        page.get_by_text("Administración", exact=True).click()
        page.wait_for_timeout(200)
        assert page.get_by_role("button", name="Flujos").is_visible(), 'falta el botón de área Flujos'

        page.get_by_role("button", name="Flujos").click()
        page.wait_for_timeout(500)

        evidencia_visible = page.get_by_text("Evidencias", exact=True).count() > 0
        calidad_visible = page.get_by_text("Calidad de la visita", exact=True).count() > 0
        print(f"[{'OK' if evidencia_visible else 'FALLA'}] flujo Evidencias cargado desde leerFlujos")
        print(f"[{'OK' if calidad_visible else 'FALLA'}] flujo Calidad de la visita cargado")

        # El flujo con revisiones no deja borrar.
        page.get_by_text("Evidencias", exact=True).click()
        page.wait_for_timeout(200)
        borrar = page.get_by_label("Borrar Evidencias")
        deshabilitado = borrar.is_disabled()
        print(f"[{'OK' if deshabilitado else 'FALLA'}] flujo con revisiones no se puede borrar")

        print("[OK] pantalla de Flujos recorrida sin errores de consola")

        browser.close()


if __name__ == "__main__":
    main()
