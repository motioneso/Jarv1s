from playwright.sync_api import sync_playwright

BASE = "http://localhost:5176"

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(1000)
    print(page.locator("body").inner_text()[:600])
    browser.close()
