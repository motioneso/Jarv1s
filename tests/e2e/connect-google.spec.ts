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

  // Connect account -> service picker -> Google opens the walkthrough takeover.
  await page.getByRole("button", { name: "Connect account" }).click();
  await page.getByRole("button", { name: "Google", exact: true }).click();
  await expect(page.getByText("Connect Google")).toBeVisible();

  await page.getByLabel("Google client ID").fill("cid.apps.googleusercontent.com");
  await page.getByLabel("Google client secret").fill("my-client-secret");
  await page.getByRole("button", { name: "Open consent screen" }).click();

  // Once the server returns the auth URL, the step is marked ready.
  await expect(page.getByText("Consent screen ready")).toBeVisible();

  await page
    .getByLabel("Pasted redirect URL")
    .fill("http://localhost:1/?code=4/abc&state=test-state");
  await page.getByRole("button", { name: "Finish connection" }).click();

  // On success the takeover closes and we return to the accounts list.
  await expect(page.getByRole("heading", { name: "Connected accounts" })).toBeVisible();
  await expect(page.getByText("Connect Google")).not.toBeVisible();
});
