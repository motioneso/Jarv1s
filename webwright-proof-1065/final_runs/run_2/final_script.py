"""PR #1065 live UAT — host-truth (issue #993). See ../../plan.md for critical points."""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5176"
EMAIL = "uat1065.owner@example.com"
LOG_PATH = "final_script_log.txt"
SCREENSHOT_DIR = "screenshots"

log_lines = []


def log(line):
    print(line)
    log_lines.append(line)


def shot(page, name):
    path = f"{SCREENSHOT_DIR}/{name}.png"
    page.screenshot(path=path)
    log(f"screenshot: {path}")


with sync_playwright() as p:
    browser = p.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})

    log("step 1 action: navigate to fresh app, create owner account via real signup UI")
    page.goto(BASE, wait_until="load")
    page.get_by_label("Name").fill("UAT Owner")
    page.get_by_label("Email", exact=True).fill(EMAIL)
    page.get_by_label("Password", exact=True).fill("Password123!")
    shot(page, "final_execution_1_signup_form")
    page.locator("form.auth-form button[type=submit]").click()
    page.wait_for_timeout(2000)
    shot(page, "final_execution_2_onboarding_wizard")

    log("step 2 action: skip onboarding wizard via Skip setup -> Skip anyway")
    page.get_by_role("button", name="Skip setup").click()
    page.wait_for_timeout(500)
    shot(page, "final_execution_3_skip_confirm_dialog")
    page.get_by_role("button", name="Skip anyway").click()
    page.wait_for_timeout(1000)
    shot(page, "final_execution_4_app_home")

    log("step 3 action: open user menu, navigate to Settings & permissions")
    page.locator(".jds-usermenu__trigger").click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Settings & permissions").click()
    page.wait_for_timeout(800)
    shot(page, "final_execution_5_settings_page")

    log("step 4 action: switch Settings mode to Admin, open Advanced host setup")
    page.get_by_label("Settings mode").get_by_role("button", name="Admin").click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Advanced host setup").click()
    page.wait_for_timeout(1000)
    shot(page, "final_execution_6_host_pane_before_install")
    body_before = page.locator("body").inner_text()
    log(f"host pane text before install: {body_before[:400]!r}")

    log("step 5 action: click Install Herdr, capture in-progress state")
    install_button = page.get_by_role("button", name="Install Herdr")
    with page.expect_response(lambda r: "/host/install" in r.url) as resp_info:
        install_button.click()
        page.wait_for_timeout(150)
        shot(page, "final_execution_7_install_in_progress")
    resp = resp_info.value
    resp_status = resp.status
    resp_body_text = resp.text()
    log(f"install response status: {resp_status}")
    log(f"install response body (network, full, for secret-leak check): {resp_body_text}")

    page.wait_for_timeout(1500)
    shot(page, "final_execution_8_host_pane_after_install")
    body_after = page.locator("body").inner_text()
    log(f"host pane text after install (full): {body_after}")

    log("step 6 action: run Check system health for final host-health summary")
    with page.expect_response(lambda r: "/host/diagnostics" in r.url) as diag_info:
        page.get_by_role("button", name="Check system health").click()
        page.wait_for_timeout(1500)
    diag_resp = diag_info.value
    diag_status = diag_resp.status
    diag_body_text = diag_resp.text()
    log(f"diagnostics response status: {diag_status}")
    log(f"diagnostics response body (network, full, for secret-leak check): {diag_body_text}")
    shot(page, "final_execution_9_health_summary")
    body_health = page.locator("body").inner_text()
    log(f"health summary text (full): {body_health}")

    log("step 7 action: scan all network response bodies + DOM text for secrets/raw errors")
    haystacks = {
        "install_response": resp_body_text,
        "diagnostics_response": diag_body_text,
        "host_pane_after_dom": body_after,
        "health_summary_dom": body_health,
    }
    banned_markers = [
        "/home/", "/root/", "Traceback", "stdout", "stderr", "at Object.",
        "at Module.", ".sh:", "sha256sum", "BEGIN PRIVATE KEY", "password",
        "Bearer ", "secret", "/tmp/", "node_modules",
    ]
    # The feature's own UI copy legitimately says "No secrets, env values, or
    # paths." as reassurance text on the health-check control. Strip that
    # known-benign phrase before scanning so it can't mask a real leak
    # elsewhere, without flagging the reassurance copy itself as a leak.
    SAFE_PHRASE = "no secrets, env values, or paths."

    leaks = []
    for source, text in haystacks.items():
        scan_text = text.lower().replace(SAFE_PHRASE, "")
        for marker in banned_markers:
            if marker.lower() in scan_text:
                leaks.append(f"{source} contains banned marker {marker!r}")
    if leaks:
        log("SECRET_SCAN: FAIL")
        for leak in leaks:
            log(f"  - {leak}")
    else:
        log("SECRET_SCAN: PASS (no path/stdout/secret markers found in any response body or DOM text)")

    result = {
        "install_response_status": resp_status,
        "install_response_body": resp_body_text,
        "diagnostics_response_status": diag_status,
        "diagnostics_response_body": diag_body_text,
        "secret_scan_leaks": leaks,
    }
    log("FINAL_DATUM: " + json.dumps(result))

    browser.close()

with open(LOG_PATH, "w") as f:
    f.write("\n".join(log_lines) + "\n")
