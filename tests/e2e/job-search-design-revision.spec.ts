import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockExternalWebModuleFromDist } from "./mock-modules.js";

test("Job Search uses the embedded revised shell and isolates the drawer (#1232)", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    connectorAccounts: [],
    connectorProviders: [],
    notifications: [],
    tasks: []
  });
  await mockExternalWebModuleFromDist(page, {
    invokeFixtures: { "job-search.profiles.list": { profiles: [] } }
  });

  const moduleReply = JSON.stringify({ kind: "reply", text: "Resume context received." });
  const moduleTurnBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/chat/stream*", async (route) => {
    const surface = new URL(route.request().url()).searchParams.get("surface");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: surface === "job-search" ? `data: ${moduleReply}\n\n` : ""
    });
  });
  await page.route("**/api/chat/turn", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    moduleTurnBodies.push(body);
    await route.fulfill({ json: { reply: "Resume context received." } });
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Job Search" }).click();
  await expect(
    page.getByRole("heading", { name: "Find work that fits the life you’re building." })
  ).toBeVisible();
  await expect(page.locator(".jsn-module-header")).toHaveCount(0);
  await expect(page.locator(".topbar-title")).toHaveText("Job Search");
  await page.getByRole("button", { name: "Start a new search" }).click();

  await expect(page).toHaveURL(/\/m\/job-search\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Building your profile" })).toBeVisible();
  for (const label of [
    "Target roles",
    "Experience",
    "Compensation",
    "Work mode",
    "Locations",
    "Dealbreakers",
    "Resume",
    "Search status"
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.locator('[data-control-slot="resume-intake"]')).toHaveCount(1);
  await expect(page.locator('[data-control-slot="profile-chips"]')).toHaveCount(1);
  await expect(page.locator('[data-control-slot="source-controls"]')).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "Let’s get your resume solid first." })
  ).toBeVisible();
  await expect(page.getByText("Resume context received.", { exact: true })).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Message Jarvis" });
  await composer.fill("hello");
  await composer.press("Enter");
  await expect.poll(() => moduleTurnBodies).toEqual([{ text: "hello", surface: "job-search" }]);

  const chatToggle = page.getByRole("button", { name: "Chat with Jarvis" });
  await chatToggle.click();
  const drawer = page.getByRole("dialog", { name: "Chat with Jarvis" });
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toContainText("hello");
  await expect(drawer).not.toContainText("Resume context received.");
});
