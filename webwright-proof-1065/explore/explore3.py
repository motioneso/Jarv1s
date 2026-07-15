from playwright.sync_api import sync_playwright

BASE = "http://localhost:5176"
EMAIL = "uat1065-owner2@example.com"

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})
    page.goto(BASE, wait_until="load")
    page.wait_for_timeout(500)
    body_text = page.locator("body").inner_text()
    if "Name" not in body_text.split("Password")[0]:
        page.get_by_label("Auth mode").get_by_role("button", name="Create account").click()
    page.get_by_label("Name").fill("UAT Owner")
    page.get_by_label("Email", exact=True).fill(EMAIL)
    page.get_by_label("Password", exact=True).fill("Password123!")
    page.locator("form.auth-form button[type=submit]").click()
    page.wait_for_timeout(2000)
    print("after create:", page.locator("body").inner_text()[:300])
    page.get_by_role("button", name="Skip setup").click()
    page.wait_for_timeout(700)
    print("after skip click:", page.locator("body").inner_text()[:800])
    page.screenshot(path="explore/screenshots/04_skip_confirm.png")
    browser.close()
