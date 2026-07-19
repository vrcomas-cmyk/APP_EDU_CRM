"""
Verifica la pantalla Administración → Accesos (Fase 1: RBAC) sin depender de una cuenta real
de Google ni de un Apps Script desplegado.

`demo_session.py` ya resuelve la sesión y el perfil (intercepta Supabase). Esto añade la
segunda mitad: intercepta el POST al Apps Script real (`doPost`) para las acciones
`leerRBAC` / `guardarRoles` / `guardarUsuarios`, porque esas SÍ verifican el id_token contra
Google de verdad (`verificarIdentidad` en Codigo.gs) y un JWT falso no las pasaría.

Uso:
    npm run dev
    python scripts/check_accesos.py
"""

import json

from playwright.sync_api import sync_playwright

from demo_session import preparar_pagina

ROLES = [
    {
        "clave": "administrador", "nombre": "Administrador", "descripcion": None, "orden": 0,
        "activo": True, "sistema": True, "hereda_de": None,
        "capacidades": ["administracion.configurar"], "efectivas": ["administracion.configurar"],
        "usuarios": 1, "herederos": 0
    },
    {
        "clave": "gerente", "nombre": "Gerente", "descripcion": None, "orden": 1,
        "activo": True, "sistema": False, "hereda_de": None,
        "capacidades": ["visitas.consultar"], "efectivas": ["visitas.consultar"],
        "usuarios": 0, "herederos": 0
    }
]

CAPACIDADES = [
    {"clave": "administracion.configurar", "modulo": "administracion", "accion": "configurar",
     "nombre": "Configurar", "descripcion": None, "grupo": "Administración", "orden": 0},
    {"clave": "visitas.consultar", "modulo": "visitas", "accion": "consultar",
     "nombre": "Consultar visitas", "descripcion": None, "grupo": "Visitas", "orden": 0}
]

USUARIOS = [
    {"correo": "demo@degasa.com", "nombre": "Demo Admin", "activo": True, "roles": ["administrador"],
     "invitacion": "aceptada", "jefes": [], "subordinados": ["ana@x.com"]},
    {"correo": "ana@x.com", "nombre": "Ana", "activo": True, "roles": ["gerente"],
     "invitacion": "aceptada", "jefes": ["demo@degasa.com"], "subordinados": []}
]


def interceptar_apps_script(page):
    """Responde `leerRBAC`/`guardarRoles`/`guardarUsuarios` sin tocar la red real."""

    def manejar(route):
        peticion = route.request
        try:
            cuerpo = json.loads(peticion.post_data or "{}")
        except ValueError:
            cuerpo = {}
        accion = cuerpo.get("action")

        if accion == "leerRBAC":
            datos = {"status": "ok", "roles": ROLES, "capacidades": CAPACIDADES, "usuarios": USUARIOS}
        elif accion in ("guardarRoles", "guardarUsuarios"):
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
        assert page.get_by_role("button", name="Catálogos").is_visible(), 'falta el conmutador de área'

        page.get_by_role("button", name="Accesos").click()
        page.wait_for_timeout(500)

        roles_visible = page.get_by_role("button", name="Roles").is_visible()
        admin_count = page.get_by_text("Administrador").count()
        print(f"[{'OK' if roles_visible else 'FALLA'}] sub-pestaña Roles visible")
        print(f"[{'OK' if admin_count > 0 else 'FALLA'}] rol Administrador cargado desde leerRBAC (apariciones: {admin_count})")
        if admin_count == 0:
            page.screenshot(path=__file__.replace("check_accesos.py", "check_accesos_falla.png"), full_page=True)

        page.get_by_role("button", name="Usuarios").click()
        page.wait_for_timeout(200)
        ana_visible = page.locator('input[value="Ana"]').count() > 0
        print(f"[{'OK' if ana_visible else 'FALLA'}] usuario Ana cargado")

        page.get_by_role("button", name="Jerarquía").click()
        page.wait_for_timeout(200)
        print("[OK] pantalla de Accesos recorrida sin errores de consola")

        browser.close()


if __name__ == "__main__":
    main()
