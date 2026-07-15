from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5176"

with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})
    page.goto(BASE, wait_until="load")
    print("TITLE:", page.title())
    print("URL:", page.url)
    page.screenshot(path="explore/screenshots/01_landing.png")
    print(page.locator("body").inner_text()[:800])
    browser.close()
