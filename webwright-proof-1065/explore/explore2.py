from playwright.sync_api import sync_playwright

BASE = "http://localhost:5176"
EMAIL = "uat1065-owner@example.com"

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})
    page.goto(BASE, wait_until="load")
    page.get_by_label("Name").fill("UAT Owner")
    page.get_by_label("Email").fill(EMAIL)
    page.get_by_label("Password").fill("Password123!")
    page.screenshot(path="explore/screenshots/02_signup_filled.png")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_timeout(2500)
    print("URL after submit:", page.url)
    page.screenshot(path="explore/screenshots/03_after_signup.png")
    print(page.locator("body").inner_text()[:1500])
    browser.close()
