"""
Simula una sesión sin necesidad de loguearse con Google.

No modifica ni un archivo de la app: siembra `localStorage` con la misma forma que usa
`js/auth.js` (clave `sesion`) y `js/permisos.js` (clave `pdt_perfil_cache`), e intercepta
las llamadas de red a Supabase para que devuelvan un perfil fijo. Es una técnica de prueba,
no un modo "demo" del producto — no queda nada persistido ni cableado en la app real.

Requiere el servidor de desarrollo levantado (`npm run dev`) y Playwright instalado
(`pip install playwright && playwright install chromium`).

Uso standalone (smoke check rápido):
    npm run dev &
    python scripts/demo_session.py

Uso como módulo, desde otro script de prueba:
    from demo_session import preparar_pagina
    with sync_playwright() as p:
        browser, page = preparar_pagina(p)
        ...
"""

import base64
import json
import time

from playwright.sync_api import sync_playwright

CORREO = "demo@degasa.com"
BASE_URL = "http://localhost:5173"


def jwt_falso(payload: dict) -> str:
    """Un JWT con forma válida (header.payload.firma) pero sin firmar de verdad.

    `decodificarJWT` en auth.js solo decodifica el payload para pintar la UI; nunca
    valida la firma en el cliente (la validación real ocurre en Apps Script).
    """
    def parte(obj):
        raw = json.dumps(obj).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")

    header = parte({"alg": "none", "typ": "JWT"})
    body = parte(payload)
    return f"{header}.{body}.firma-falsa"


def perfil_admin(correo: str) -> dict:
    return {
        "correo": correo,
        "nombre": "Demo Admin",
        "rol": "administrador",
        "es_admin": True,
        "permisos": [
            "visitas.crear", "visitas.consultar",
            "actividades.crear", "actividades.consultar",
            "materiales.crear", "materiales.consultar",
            "evidencias.subir", "evidencias.consultar",
            "comentarios.crear", "comentarios.leer", "comentarios.responder",
            "dashboards.personal", "dashboards.equipo",
        ],
        "alcance": [correo],
        "invitado": True,
        "invitacion_estado": "aceptada",
    }


def sembrar_sesion(page, correo: str = CORREO):
    """Deja lista una sesión con permisos de administrador, sin tocar Google."""
    token = jwt_falso({
        "name": "Demo Admin",
        "email": correo,
        "picture": "",
    })
    sesion = {
        "nombre": "Demo Admin",
        "correo": correo,
        "foto": "",
        "id_token": token,
        "obtenido": int(time.time() * 1000),
    }
    perfil = {**perfil_admin(correo), "origen": "cache"}

    page.evaluate(
        """([sesion, perfil]) => {
            localStorage.setItem('sesion', JSON.stringify(sesion));
            localStorage.setItem('pdt_perfil_cache', JSON.stringify(perfil));
        }""",
        [sesion, perfil],
    )


def interceptar_supabase(page, correo: str = CORREO):
    """El servidor real no conoce este correo: se responde antes de que la petición salga,
    así el perfil de administrador no se pisa con el de respaldo (educador) que devolvería
    Supabase para un correo no invitado."""

    def responder_perfil(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(perfil_admin(correo)),
        )

    def responder_ok(route):
        route.fulfill(status=200, content_type="application/json", body="{}")

    page.route("**/rest/v1/rpc/pdt_perfil", responder_perfil)
    page.route("**/rest/v1/rpc/pdt_aceptar_invitacion", responder_ok)


def preparar_pagina(playwright, headless: bool = True, base_url: str = BASE_URL):
    browser = playwright.chromium.launch(headless=headless)
    page = browser.new_page()

    # Necesita un origen ya cargado antes de poder tocar su localStorage.
    page.goto(base_url)
    interceptar_supabase(page)
    sembrar_sesion(page)
    page.reload()
    page.wait_for_load_state("networkidle")

    return browser, page


if __name__ == "__main__":
    with sync_playwright() as p:
        browser, page = preparar_pagina(p, headless=True)
        print("app hidden:", page.locator("#app").is_hidden())
        print("gate hidden:", page.locator("#gate").is_hidden())
        print("fab hidden:", page.locator("#fab").is_hidden())
        browser.close()
