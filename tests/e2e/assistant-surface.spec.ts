import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockAssistantSurfaceWebModule } from "./mock-modules.js";

test("embedded assistant owns chat presence and restores the drawer on unmount (#1196)", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  await mockAssistantSurfaceWebModule(page);

  const reply = JSON.stringify({ kind: "reply", text: "**Embedded reply**" });
  const actionRequest = JSON.stringify({
    kind: "action_request",
    text: "Approve profile",
    actionRequestId: "action-1",
    toolName: "job-search.profile.approve",
    summary: "Approve profile"
  });
  let streamServed = false;
  await page.route("**/api/chat/stream", async (route) => {
    if (streamServed) return;
    streamServed = true;
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: `data: ${reply}\n\ndata: ${actionRequest}\n\n`
    });
  });
  const turnTexts: string[] = [];
  await page.route("**/api/chat/turn", async (route) => {
    turnTexts.push((route.request().postDataJSON() as { text: string }).text);
    await route.fulfill({ json: { reply: "ok" } });
  });

  await page.goto("/");
  const chatToggle = page.getByRole("button", { name: "Chat with Jarvis" });
  await chatToggle.click();
  await expect(page.getByRole("dialog", { name: "Chat with Jarvis" })).toBeVisible();

  await page.getByRole("link", { name: "Job Search" }).click();

  const surface = page.locator(".assistant-surface");
  await expect(surface).toBeVisible();
  await expect(chatToggle).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Chat with Jarvis" })).toHaveCount(0);
  await expect(surface.locator(".chatd-md strong")).toHaveText("Embedded reply");
  await expect(surface.locator(".action-request-card")).toBeVisible();
  await expect(surface.locator(".assistant-surface__row").nth(0)).toContainText("Scripted intro");
  await expect(surface.locator(".assistant-surface__row").nth(1)).toContainText("Scripted answer");
  await expect(
    surface.locator(".assistant-surface__row--assistant .assistant-surface__identity").first()
  ).toContainText("Jarvis");
  await expect(
    surface.locator(".assistant-surface__typing-row .assistant-surface__identity")
  ).toContainText("Jarvis");
  await expect(
    surface.locator(".assistant-surface__row--control .assistant-surface__identity")
  ).toContainText("Jarvis");

  await surface.getByRole("button", { name: "Route draft inline" }).click();
  const composer = surface.getByRole("textbox", { name: "Message Jarvis" });
  await expect(composer).toHaveValue("Draft routed inline");
  await expect(composer).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Chat with Jarvis" })).toHaveCount(0);

  await composer.fill("Enter sends once");
  await composer.press("Enter");
  await expect.poll(() => turnTexts).toEqual(["Enter sends once"]);

  await composer.fill("Line one");
  await composer.press("Shift+Enter");
  await expect(composer).toHaveValue("Line one\n");
  expect(turnTexts).toEqual(["Enter sends once"]);
  await composer.type("Line two");
  await surface.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => turnTexts).toEqual(["Enter sends once", "Line one\nLine two"]);

  await composer.fill("Composing text");
  await composer.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })
    )
  );
  await expect(composer).toHaveValue("Composing text");
  expect(turnTexts).toEqual(["Enter sends once", "Line one\nLine two"]);
  await surface.getByRole("button", { name: "Send" }).click();
  await expect
    .poll(() => turnTexts)
    .toEqual(["Enter sends once", "Line one\nLine two", "Composing text"]);

  await page.getByRole("link", { name: "Today" }).click();
  await expect(chatToggle).toBeEnabled();
});
