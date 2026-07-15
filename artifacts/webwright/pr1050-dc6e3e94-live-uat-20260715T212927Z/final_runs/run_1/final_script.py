import json
import os
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


RUN_DIR = Path(os.environ.get("WEBWRIGHT_RUN_DIR", Path(__file__).parent))
WORKSPACE = RUN_DIR.parents[1]
SCREENSHOTS = RUN_DIR / "screenshots"
LOG = RUN_DIR / "final_script_log.txt"
EXACT_HEAD = "dc6e3e949c861848d7800f0b45a976546001c2ad"

SCREENSHOTS.mkdir(parents=True, exist_ok=True)
LOG.write_text("")


def log(step: int, action: str) -> None:
    line = f"step {step} action: {action}"
    print(line)
    with LOG.open("a") as handle:
        handle.write(f"{line}\n")


def screenshot(page: Page, step: int, action: str) -> None:
    page.screenshot(path=str(SCREENSHOTS / f"final_execution_{step}_{action}.png"))


def api(page: Page, path: str, method: str = "GET", body=None):
    result = page.evaluate(
        """
        async ({path, method, body}) => {
          const response = await fetch(path, {
            method,
            headers: body === null ? undefined : {"Content-Type": "application/json"},
            body: body === null ? undefined : JSON.stringify(body)
          });
          const text = await response.text();
          return {
            status: response.status,
            body: text ? JSON.parse(text) : null
          };
        }
        """,
        {"path": path, "method": method, "body": body},
    )
    assert 200 <= result["status"] < 300, result
    return result["body"]


state = json.loads((WORKSPACE / "uat-state.json").read_text())
assert state["exactHead"] == EXACT_HEAD, state
base_url = state["baseURL"]

with sync_playwright() as playwright:
    browser = playwright.firefox.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 1800})

    page.goto(base_url, wait_until="domcontentloaded")
    page.locator("input[type=email]").fill("uat-admin@jarv1s.local")
    page.locator("input[type=password]").fill("uat-admin-password-1025")
    page.locator("button[type=submit]").click()
    page.wait_for_url("**/today", timeout=15_000)
    page.goto(f"{base_url}/settings?section=priorities", wait_until="domcontentloaded")
    page.get_by_role("heading", name="Priorities").wait_for(timeout=15_000)
    assert page.get_by_text("UAT Admin", exact=True).count() >= 1
    log(1, f"real owner/admin login reached authenticated Settings on exact head {EXACT_HEAD}")
    screenshot(page, 1, "authenticated_priorities_desktop")

    model = api(page, "/api/me/priority-model")
    model["anchors"] = []
    model["mutedSources"] = ["wellness"]
    model["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    seeded = api(page, "/api/me/priority-model", "PATCH", model)
    assert seeded["mutedSources"] == ["wellness"], seeded
    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name="Priorities").wait_for(timeout=15_000)

    priority_patches = []

    def record_priority_patch(request) -> None:
        if request.method == "PATCH" and request.url.endswith("/api/me/priority-model"):
            priority_patches.append(request.post_data_json)

    page.on("request", record_priority_patch)
    page.get_by_role("button", name="Add priority").click()
    label_input = page.get_by_placeholder("e.g. Finish the launch plan")
    label_input.wait_for()
    page.get_by_role("button", name="Save priorities").click()
    page.get_by_text("Give each priority a label before saving.", exact=True).wait_for()
    assert priority_patches == [], priority_patches
    log(2, "blank-label Save showed validation and emitted zero priority-model PATCH requests")
    screenshot(page, 2, "blank_label_blocked_zero_patch")

    label_input.fill("Ship UX hardening")
    with page.expect_response(
        lambda response: response.request.method == "PATCH"
        and response.url.endswith("/api/me/priority-model")
        and response.ok
    ):
        page.get_by_role("button", name="Save priorities").click()
    page.get_by_role("button", name="Save priorities").wait_for(state="hidden")
    assert len(priority_patches) == 1, priority_patches
    saved_payload = priority_patches[0]
    assert saved_payload["anchors"][0]["label"] == "Ship UX hardening", saved_payload
    assert "wellness" in saved_payload["mutedSources"], saved_payload
    page.reload(wait_until="domcontentloaded")
    page.get_by_role("heading", name="Priorities").wait_for(timeout=15_000)
    label_input = page.get_by_placeholder("e.g. Finish the launch plan")
    assert label_input.input_value() == "Ship UX hardening"
    persisted = api(page, "/api/me/priority-model")
    assert "wellness" in persisted["mutedSources"], persisted
    log(3, "one valid UI Save PATCH persisted the priority and preserved hidden source wellness")
    screenshot(page, 3, "saved_priority_hidden_source_round_trip")

    label_input.fill("Temporary unsaved edit")
    page.get_by_role("button", name="Discard").click()
    assert label_input.input_value() == "Ship UX hardening"
    assert len(priority_patches) == 1, priority_patches
    log(4, "Discard restored the saved snapshot without another priority-model PATCH")
    screenshot(page, 4, "discard_restored_snapshot")

    api(
        page,
        "/api/admin/yolo/users/00000000-0000-4000-8000-000000000001",
        "PUT",
        {"allowed": True},
    )
    api(page, "/api/admin/yolo/instance", "PUT", {"enabled": False})
    api(page, "/api/me/yolo", "PUT", {"enabled": False})
    page.goto(f"{base_url}/settings?section=assistant", wait_until="domcontentloaded")
    page.get_by_role("heading", name="Assistant & AI").wait_for(timeout=15_000)
    yolo_switch = page.get_by_role("checkbox", name="Auto-approve actions")
    yolo_switch.wait_for(state="attached", timeout=15_000)
    assert not yolo_switch.is_checked()
    yolo_switch.locator("xpath=..").click()
    page.get_by_role("button", name="Enable YOLO").click()
    inactive_copy = page.get_by_text(
        "Effective state: inactive because the instance owner has disabled YOLO. Your preference remains saved.",
        exact=True,
    )
    inactive_copy.wait_for(timeout=15_000)
    yolo_state = api(page, "/api/me/yolo")
    assert yolo_state["instanceEnabled"] is False, yolo_state
    assert yolo_state["self"]["enabled"] is True, yolo_state
    assert yolo_switch.is_checked()
    inactive_copy.scroll_into_view_if_needed()
    log(5, "personal YOLO is on while instance policy is off; effective copy truthfully remains inactive")
    screenshot(page, 5, "truthful_yolo_effective_state_desktop")

    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{base_url}/settings?section=priorities", wait_until="domcontentloaded")
    page.get_by_role("heading", name="Priorities").wait_for(timeout=15_000)
    label_input = page.get_by_placeholder("e.g. Finish the launch plan")
    assert label_input.input_value() == "Ship UX hardening"
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    label_input.fill("Narrow temporary edit")
    page.get_by_role("button", name="Save priorities").scroll_into_view_if_needed()
    assert page.get_by_role("button", name="Discard").is_visible()
    screenshot(page, 6, "narrow_priorities_dirty_actions")
    page.get_by_role("button", name="Discard").click()
    assert label_input.input_value() == "Ship UX hardening"
    assert len(priority_patches) == 1, priority_patches
    log(6, "390px narrow Priorities had no horizontal overflow and exposed working Save/Discard actions")

    result = (
        "RESULT: exact-head authenticated desktop+narrow UAT passed; one priority PATCH, "
        "blank Save blocked, persistence/discard/hidden-source/YOLO copy verified"
    )
    print(result)
    with LOG.open("a") as handle:
        handle.write(f"{result}\n")
    browser.close()
