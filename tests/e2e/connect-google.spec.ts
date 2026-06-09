import { expect, test } from "@playwright/test";

import { createMockConnectorProviders, mockApi } from "./mock-api.js";

test("connects Google via the settings flow", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Connect Google" })).toBeVisible();

  await page.getByLabel("Client ID").fill("cid.apps.googleusercontent.com");
  await page.getByLabel("Client secret").fill("my-client-secret");
  await page.getByRole("button", { name: "Start authorization" }).click();

  await expect(page.getByRole("link", { name: /Open Google consent/ })).toBeVisible();

  await page
    .getByLabel("Pasted redirect URL")
    .fill("http://localhost:1/?code=4/abc&state=test-state");
  await page.getByRole("button", { name: "Finish connecting" }).click();

  await expect(page.getByRole("link", { name: /Open Google consent/ })).not.toBeVisible();
});
