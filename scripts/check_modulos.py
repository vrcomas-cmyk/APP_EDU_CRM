"""
Recorre los cuatro módulos con la sesión falsa de `demo_session.py` y comprueba que el FAB
"Nueva visita" solo se muestre en Calendario.

Uso:
    npm run dev &
    python scripts/check_modulos.py
"""

from playwright.sync_api import sync_playwright

from demo_session import preparar_pagina

MODULOS = ["Calendario", "Indicadores", "Revisión", "Administración"]


def main():
    with sync_playwright() as p:
        browser, page = preparar_pagina(p, headless=True)

        for nombre in MODULOS:
            page.get_by_text(nombre, exact=True).click()
            page.wait_for_timeout(300)
            oculto = page.locator("#fab").is_hidden()
            esperado = nombre != "Calendario"
            estado = "OK" if oculto == esperado else "FALLA"
            print(f"[{estado}] {nombre:16s} -> fab oculto = {oculto} (esperado {esperado})")

        page.get_by_text("Calendario", exact=True).click()
        page.wait_for_timeout(300)
        oculto = page.locator("#fab").is_hidden()
        estado = "OK" if not oculto else "FALLA"
        print(f"[{estado}] Calendario (vuelta) -> fab oculto = {oculto} (esperado False)")

        browser.close()


if __name__ == "__main__":
    main()
