"""
Exact-head live UAT for PR #1118 (commit 00c43878c6ffada902f3955962f3f9101dc6e14b),
post-#1117 integration. Exercises a REAL owner-signup flow (not the seeded-login path
used by tests/uat/specs/1112-today-masthead-oneline.uat.spec.ts, which is a read-only
acceptance reference for this run, not executed) against a fresh bare #1000-harness
instance, all the way to the Today page, verifying:
  - #1112: greeting + dateline share one masthead line at desktop 1280x1800
  - #1117: masthead stacks (readable, no horizontal overflow) at narrow 390x844
  - a final desktop sanity pass afterward

Sanitized data only. No real PII.
"""
import os
import sys
from datetime import datetime, timezone

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get("JARVIS_UAT_BASE_URL", "http://127.0.0.1:20001")
RUN_DIR = os.path.dirname(os.path.abspath(__file__))
SCREENSHOTS_DIR = os.path.join(RUN_DIR, "screenshots")
LOG_PATH = os.path.join(RUN_DIR, "final_script_log.txt")

DESKTOP_VIEWPORT = {"width": 1280, "height": 1800}
NARROW_VIEWPORT = {"width": 390, "height": 844}

SANITIZED_NAME = "UAT Tester"
SANITIZED_EMAIL = f"uat-1118-{int(datetime.now(timezone.utc).timestamp())}@example.test"
SANITIZED_PASSWORD = "UatTest#12345678"

_log_lines = []


def log(msg: str) -> None:
    print(msg)
    _log_lines.append(msg)


def flush_log() -> None:
    with open(LOG_PATH, "w") as f:
        f.write("\n".join(_log_lines) + "\n")


def screenshot(page, name: str) -> str:
    path = os.path.join(SCREENSHOTS_DIR, name)
    page.screenshot(path=path)
    return path


def main() -> int:
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    _log_lines.clear()
    log(f"step 0 params: base_url={BASE_URL} email={SANITIZED_EMAIL}")

    with sync_playwright() as p:
        browser = p.firefox.launch(headless=True)
        page = browser.new_page(viewport=DESKTOP_VIEWPORT)

        # --- CP1: bare instance -> signup form appears (needsBootstrap=true) ---
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")
        form = page.locator("form.auth-form")
        expect(form).to_be_visible()
        create_btn = form.get_by_role("button", name="Create account")
        expect(create_btn).to_be_visible()
        screenshot(page, "final_execution_1_signup_form.png")
        log(
            "step 1 action: navigated to bare instance root; CP1 evidence — "
            "form.auth-form visible with 'Create account' submit (needsBootstrap sign-up default)"
        )

        # --- CP2: real owner signup -> onboarding wizard -> skip -> Today ---
        page.get_by_label("Name", exact=True).fill(SANITIZED_NAME)
        page.get_by_label("Email", exact=True).fill(SANITIZED_EMAIL)
        page.get_by_label("Password", exact=True).fill(SANITIZED_PASSWORD)
        create_btn.click()
        page.wait_for_load_state("networkidle")
        log(f"step 2 action: submitted sanitized owner signup ({SANITIZED_NAME} / {SANITIZED_EMAIL})")

        skip_setup = page.get_by_role("button", name="Skip setup")
        expect(skip_setup).to_be_visible(timeout=15000)
        screenshot(page, "final_execution_2_onboarding_wizard.png")
        skip_setup.click()
        log("step 3 action: onboarding wizard appeared; clicked 'Skip setup'")

        skip_anyway = page.get_by_role("button", name="Skip anyway")
        expect(skip_anyway).to_be_visible(timeout=10000)
        screenshot(page, "final_execution_3_skip_confirm.png")
        skip_anyway.click()
        log("step 4 action: confirmation dialog appeared; clicked 'Skip anyway'")

        usermenu = page.locator(".jds-usermenu__trigger")
        expect(usermenu).to_be_visible(timeout=15000)
        screenshot(page, "final_execution_4_appshell_reached.png")
        log(
            "step 5 action: reached AppShell — CP2 evidence — "
            ".jds-usermenu__trigger visible after onboarding skip"
        )

        # --- CP3: authenticated Today page loads with masthead elements ---
        masthead = page.locator(".cmd-masthead")
        greeting = page.locator(".cmd-eyebrow")
        dateline = page.locator(".cmd-dateline")
        expect(masthead).to_be_visible()
        expect(greeting).to_be_visible()
        expect(dateline).to_be_visible()
        screenshot(page, "final_execution_5_today_desktop.png")
        log(
            "step 6 action: CP3 evidence — Today masthead/.cmd-eyebrow/.cmd-dateline all visible "
            "at desktop 1280x1800"
        )

        # --- CP4: desktop 1280x1800 — greeting + dateline share one masthead line ---
        greeting_box = greeting.bounding_box()
        dateline_box = dateline.bounding_box()
        if not greeting_box or not dateline_box:
            log("step 7 FAIL: could not read bounding boxes for .cmd-eyebrow / .cmd-dateline")
            flush_log()
            browser.close()
            return 1
        dy = abs(greeting_box["y"] - dateline_box["y"])
        cp4_pass = dy <= 2 and greeting_box["y"] > 0
        screenshot(page, "final_execution_6_cp4_oneline_desktop.png")
        log(
            f"step 7 action: CP4 evidence — greeting.y={greeting_box['y']:.2f} "
            f"dateline.y={dateline_box['y']:.2f} |dy|={dy:.2f} (tolerance<=2) -> "
            f"{'PASS' if cp4_pass else 'FAIL'}"
        )
        if not cp4_pass:
            flush_log()
            browser.close()
            return 1

        # --- CP5: narrow 390x844 — #1117 responsive stacked masthead, no horizontal overflow ---
        page.set_viewport_size(NARROW_VIEWPORT)
        page.wait_for_timeout(300)  # allow CSS reflow/media-query transition to settle
        expect(greeting).to_be_visible()
        expect(dateline).to_be_visible()
        row_flex_direction = page.locator(".cmd-masthead__row").evaluate(
            "el => getComputedStyle(el).flexDirection"
        )
        scroll_width = page.evaluate("document.documentElement.scrollWidth")
        client_width = page.evaluate("document.documentElement.clientWidth")
        no_overflow = scroll_width <= NARROW_VIEWPORT["width"]
        greeting_box_n = greeting.bounding_box()
        dateline_box_n = dateline.bounding_box()
        stacked = (
            greeting_box_n
            and dateline_box_n
            and dateline_box_n["y"] > greeting_box_n["y"] + greeting_box_n["height"] - 4
        )
        cp5_pass = row_flex_direction == "column" and no_overflow and stacked
        screenshot(page, "final_execution_7_cp5_narrow_stacked.png")
        log(
            f"step 8 action: CP5 evidence — narrow 390x844 flex-direction={row_flex_direction} "
            f"scrollWidth={scroll_width} clientWidth={client_width} no_overflow={no_overflow} "
            f"stacked(dateline below greeting)={stacked} -> {'PASS' if cp5_pass else 'FAIL'}"
        )
        if not cp5_pass:
            flush_log()
            browser.close()
            return 1

        # --- CP6: back to desktop 1280x1800 — one-line masthead + no overflow still holds ---
        page.set_viewport_size(DESKTOP_VIEWPORT)
        page.wait_for_timeout(300)
        greeting_box_2 = greeting.bounding_box()
        dateline_box_2 = dateline.bounding_box()
        dy2 = abs(greeting_box_2["y"] - dateline_box_2["y"]) if greeting_box_2 and dateline_box_2 else None
        scroll_width_2 = page.evaluate("document.documentElement.scrollWidth")
        no_overflow_2 = scroll_width_2 <= DESKTOP_VIEWPORT["width"]
        cp6_pass = dy2 is not None and dy2 <= 2 and greeting_box_2["y"] > 0 and no_overflow_2
        screenshot(page, "final_execution_8_cp6_final_desktop_sanity.png")
        log(
            f"step 9 action: CP6 evidence — final desktop 1280x1800 resanity: "
            f"greeting.y={greeting_box_2['y']:.2f} dateline.y={dateline_box_2['y']:.2f} "
            f"|dy|={dy2:.2f} scrollWidth={scroll_width_2} no_overflow={no_overflow_2} -> "
            f"{'PASS' if cp6_pass else 'FAIL'}"
        )

        browser.close()

        if not cp6_pass:
            flush_log()
            return 1

        log("RESULT: all critical points (CP1-CP6) PASSED")
        flush_log()
        return 0


if __name__ == "__main__":
    sys.exit(main())
