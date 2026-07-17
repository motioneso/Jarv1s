import asyncio
import os
import time
import uuid
from pathlib import Path

from playwright.async_api import async_playwright

RUN_DIR = Path(__file__).parent
SCREENSHOTS = RUN_DIR / "screenshots"
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
LOG = RUN_DIR / "final_script_log.txt"
LOG.write_text("")

BASE_URL = os.environ["JARVIS_UAT_BASE_URL"]

# Sanitized synthetic owner — no real PII.
UID = uuid.uuid4().hex[:8]
OWNER_NAME = "UAT Owner"
OWNER_EMAIL = f"uat-owner-{UID}@example.invalid"
OWNER_PASSWORD = "Uat-Test-Pass-1234"


def log(step, msg):
    line = f"step {step} action: {msg}\n"
    with LOG.open("a") as f:
        f.write(line)
    print(line, end="")


async def shot(page, name):
    path = SCREENSHOTS / f"{name}.png"
    await page.screenshot(path=str(path))
    return path


async def main():
    async with async_playwright() as pw:
        browser = await pw.firefox.launch(headless=True)
        # CP5 diagnosis (this session): NODE_ENV=production under the UAT compose stack
        # (tests/uat/provisioner.ts) means registerServiceWorker() (pwa/register-service-worker.ts)
        # actually registers /service-worker.js, which is known to make page.route() interception
        # unreliable in Playwright unless service workers are blocked on the context — even though
        # the SW itself passes /api/* straight through (service-worker.js:30-32).
        context = await browser.new_context(
            viewport={"width": 1280, "height": 1800}, service_workers="block"
        )
        page = await context.new_page()

        # --- CP1: fresh owner signup completes end-to-end ---
        await page.goto(BASE_URL, wait_until="domcontentloaded")
        await page.wait_for_timeout(1000)
        log(1, f"loaded {BASE_URL}, expect bare-seed signup form")
        await page.get_by_label("Name").fill(OWNER_NAME)
        await page.get_by_label("Email").fill(OWNER_EMAIL)
        await page.get_by_label("Password").fill(OWNER_PASSWORD)
        await shot(page, "final_execution_01_signup_filled")
        await page.get_by_role("button", name="Create account").click()
        await page.wait_for_timeout(2500)
        await shot(page, "final_execution_02_post_signup")
        log(1, f"CP1 post-signup URL={page.url}")

        # --- CP2: walk founder onboarding steps -> Finish -> "Go to settings" lands on /settings ---
        # NOTE: "Skip for now" (welcome-step.tsx) -> "Skip anyway" (skip-confirm.tsx) calls
        # skip.mutate(), whose onSuccess only invalidates onboarding status and falls straight
        # through to /today — it never renders FinishStep or "Go to settings" at all. Confirmed by
        # reading apps/web/src/onboarding/onboarding-wizard.tsx: the FinishStep "Go to settings"
        # ghost-button (shown because chatAvailable=false on a bare/no-connector seed) is only
        # reachable by walking FOUNDER_ORDER via continueStep ("Start setup" / "Continue"). The
        # wizard renders a duplicate "Continue" button in a footer nav (.onb-nav), but that block is
        # `display:none` below the 760px breakpoint (styles/onboarding.css) so it is excluded from
        # the accessibility tree at this script's 1280px viewport — get_by_role only matches the
        # visible sidebar (.onb__rail-actions) button, no strict-mode ambiguity.
        start_setup = page.get_by_role("button", name="Start setup")
        await start_setup.wait_for(state="visible", timeout=15000)
        await shot(page, "final_execution_03_onboarding_welcome")
        await start_setup.click()
        log(2, "clicked 'Start setup' on Welcome step (advances to Assistant/cliAuth step)")

        continue_btn = page.get_by_role("button", name="Continue")
        await continue_btn.wait_for(state="visible", timeout=10000)
        await continue_btn.click()
        log(2, "clicked 'Continue' on Assistant/cliAuth step (advances to Google/connectors step)")

        await continue_btn.wait_for(state="visible", timeout=10000)
        await continue_btn.click()
        log(2, "clicked 'Continue' on Google/connectors step (advances to Finish step)")

        goto_settings = page.get_by_role("button", name="Go to settings")
        await goto_settings.wait_for(state="visible", timeout=10000)
        await shot(page, "final_execution_04_onboarding_finish")
        await goto_settings.click()
        await page.wait_for_url("**/settings", timeout=10000)
        await page.wait_for_timeout(1000)
        await shot(page, "final_execution_05_settings_landing")
        log(2, f"CP2 clicked 'Go to settings', landed URL={page.url}")
        assert "/settings" in page.url and "/today" not in page.url, (
            f"CP2 FAILED: expected /settings, got {page.url}"
        )

        # --- CP3: Settings module paths reachable ---
        nav = page.get_by_role("navigation", name="Settings categories")
        await nav.wait_for(state="visible", timeout=10000)
        await nav.get_by_role("button", name="Appearance").click()
        await page.wait_for_timeout(800)
        await shot(page, "final_execution_06_settings_appearance")
        log(3, "CP3 clicked Appearance nav item, pane rendered")

        await nav.get_by_role("button", name="Activity").click()
        await page.wait_for_timeout(1500)
        await shot(page, "final_execution_07_settings_activity")
        log(3, "CP3 clicked Activity nav item, pane rendered")

        # --- CP4: Activity pane on normal (fast) backend load — no false error ---
        activity_unavailable = page.get_by_text("Activity unavailable.")
        loading = page.get_by_text("Loading…")
        # allow query to settle
        await page.wait_for_timeout(500)
        is_error_visible = await activity_unavailable.is_visible()
        is_loading_visible = await loading.is_visible()
        await shot(page, "final_execution_07_activity_fast_load")
        log(
            4,
            f"CP4 fast-load state: error_visible={is_error_visible} loading_visible={is_loading_visible}",
        )
        assert not is_error_visible, "CP4 FAILED: Activity pane shows false error on fast backend"

        # --- CP5: Activity pane, backend response delayed past 3s ---
        async def delayed_audit_route(route):
            log(5, f"[diag] route intercept HIT: {route.request.method} {route.request.url}")
            await asyncio.sleep(4.0)
            try:
                await route.fulfill(
                    status=200,
                    content_type="application/json",
                    body='{"entries":[]}',
                )
            except Exception:
                # Client already aborted at 3s (the fix under test) — the underlying
                # request is gone by the time we try to fulfill it. Expected, not fatal.
                pass

        await page.route("**/api/ai/action-audit**", delayed_audit_route)
        log(5, "intercepted GET /api/ai/action-audit to delay response 4000ms (>3s client abort)")

        # Force a fully fresh query-client (guaranteed cache miss, not just a remount) via a
        # full page reload, then reselect Activity — two prior in-SPA remount strategies
        # ("7 days" range click, nav-away/back) AND a plain reload all timed out identically,
        # consistent with a persisted query cache (e.g. React Query localStorage persister)
        # surviving reload and serving stale data instantly instead of hitting the network.
        # Clear web storage (auth is cookie-based per CP7, so this doesn't sign us out) before
        # reloading so the next Activity fetch is unambiguously new and must hit the route.
        t0 = time.monotonic()
        await page.evaluate("() => { try { localStorage.clear(); } catch (e) {} "
                             "try { sessionStorage.clear(); } catch (e) {} }")
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(500)
        nav = page.get_by_role("navigation", name="Settings categories")
        await nav.wait_for(state="visible", timeout=10000)
        await nav.get_by_role("button", name="Activity").click()
        log(5, "reloaded page (fresh query client) and reselected Activity pane to force new fetch")

        await page.get_by_text("Activity unavailable.").wait_for(state="visible", timeout=8000)
        elapsed = time.monotonic() - t0
        await shot(page, "final_execution_08_activity_delayed_error")
        log(5, f"CP5 truthful error shown after {elapsed:.2f}s (expected ~3s, not stuck loading)")
        assert elapsed < 6.0, f"CP5 FAILED: error surfaced too late ({elapsed:.2f}s), retry backoff suspected"
        try_again = page.get_by_role("button", name="Try again")
        assert await try_again.is_visible(), "CP5 FAILED: 'Try again' control not shown with error"

        # --- CP6: "Try again" against a normal (fast) backend recovers ---
        await page.unroute("**/api/ai/action-audit**")
        log(6, "removed route intercept, backend now responds normally")
        await try_again.click()
        log(6, "clicked 'Try again'")
        await page.get_by_text("Activity unavailable.").wait_for(state="hidden", timeout=8000)
        await page.wait_for_timeout(500)
        await shot(page, "final_execution_09_activity_recovered")
        recovered_error_visible = await page.get_by_text("Activity unavailable.").is_visible()
        log(6, f"CP6 post-retry error_visible={recovered_error_visible}")
        assert not recovered_error_visible, "CP6 FAILED: Activity still showing error after manual retry"

        # --- CP7: narrow (390x844) Today masthead stacks readably, no overflow ---
        narrow_context = await browser.new_context(viewport={"width": 390, "height": 844})
        narrow_page = await narrow_context.new_page()
        # Reuse the same authenticated app instance by re-navigating (cookie-session based UAT seed
        # is per-worker; sign back in quickly on the narrow context to reach an authenticated Today view).
        await narrow_page.goto(BASE_URL, wait_until="domcontentloaded")
        await narrow_page.wait_for_timeout(1000)
        auth_form = narrow_page.locator("form.auth-form")
        if await auth_form.is_visible():
            # Fresh context, no session cookie: owner already exists (needsBootstrap=false) so
            # the screen defaults to sign-in mode already — just fill and submit.
            await auth_form.get_by_label("Email").fill(OWNER_EMAIL)
            await auth_form.get_by_label("Password").fill(OWNER_PASSWORD)
            await auth_form.get_by_role("button", name="Sign in").click()
            await narrow_page.wait_for_timeout(1500)
            log(7, "narrow context signed in as owner via sign-in form")
        else:
            log(7, "narrow context already authenticated (session shared)")
        await narrow_page.goto(BASE_URL + "/today", wait_until="domcontentloaded")
        await narrow_page.wait_for_timeout(1200)
        await narrow_page.screenshot(path=str(SCREENSHOTS / "final_execution_10_today_narrow.png"))
        masthead = narrow_page.locator(".cmd-masthead__row")
        flex_direction = await masthead.evaluate("(el) => getComputedStyle(el).flexDirection")
        body_scroll_width = await narrow_page.evaluate("document.documentElement.scrollWidth")
        viewport_width = await narrow_page.evaluate("window.innerWidth")
        log(
            7,
            f"CP7 narrow masthead flex-direction={flex_direction} "
            f"scrollWidth={body_scroll_width} viewportWidth={viewport_width}",
        )
        assert flex_direction == "column", (
            f"CP7 FAILED: masthead flex-direction={flex_direction}, expected 'column' at 390px"
        )
        assert body_scroll_width <= viewport_width + 4, (
            f"CP7 FAILED: horizontal overflow at 390px (scrollWidth={body_scroll_width} > "
            f"viewportWidth={viewport_width})"
        )
        await narrow_context.close()

        # --- CP8: desktop Today sanity screenshot ---
        await page.goto(BASE_URL + "/today", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        await shot(page, "final_execution_11_today_desktop_sanity")
        log(8, f"CP8 desktop Today sanity render at URL={page.url}")

        await browser.close()
        log(9, "all CPs executed, browser closed cleanly")


asyncio.run(main())
