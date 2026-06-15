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
  await page.getByRole("button", { name: "Connected accounts" }).click();
  await expect(page.getByRole("heading", { name: "Connected accounts" })).toBeVisible();

  await page.getByLabel("Google client ID").fill("cid.apps.googleusercontent.com");
  await page.getByLabel("Google client secret").fill("my-client-secret");
  await page.getByRole("button", { name: "Start Google connect" }).click();

  await expect(page.getByRole("link", { name: /Open Google consent/ })).toBeVisible();

  await page
    .getByLabel("Pasted redirect URL")
    .fill("http://localhost:1/?code=4/abc&state=test-state");
  await page.getByRole("button", { name: "Finish connecting" }).click();

  await expect(page.getByRole("link", { name: /Open Google consent/ })).not.toBeVisible();
});
