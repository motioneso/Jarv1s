import { expect, test } from "@playwright/test";

import { defaultOnboardingStatus } from "./mock-onboarding-api.js";
import { createMockConnectorProviders, mockApi } from "./mock-api.js";

test("bootstrap owner with incomplete onboarding sees the wizard, then the app shell after finish", async ({
  page
}) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus()
  });

  await page.goto("/");
  await expect(page.getByText("Jarvis setup")).toBeVisible();
  await expect(page.getByLabel("Onboarding progress").getByText("Owner")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Let’s get your Jarvis set up." })).toBeVisible();
  await expect(
    page.getByText("A safe, inspectable, interactive way for me to connect to your LLM.")
  ).toBeVisible();
  await expect(page.getByText("Skips the whole setup and opens the app.")).toBeVisible();
  await expect(page.getByText("Tweaks")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ask Jarvis/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Start setup/ }).click();
  const continueButton = page.getByRole("button", { name: /Continue/ });
  while (await continueButton.isVisible()) {
    await continueButton.click();
  }
  await page.getByLabel("Onboarding step").getByRole("button", { name: "Finish" }).click();

  // After finish the status mock returns state:"completed"; the app.tsx branch falls through.
  await expect(
    page.getByRole("heading", { name: "Let’s get your Jarvis set up." })
  ).not.toBeVisible();
});

test("Skip setup on the first step reaches the app shell", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus()
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Let’s get your Jarvis set up." })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Let’s get your Jarvis set up." })
  ).not.toBeVisible();
});

test("provider auth test is an explicit installed-provider action", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus({
      steps: {
        multiplexer: { done: false, selected: null, tmuxUsable: false, herdrUsable: false },
        cliAuth: {
          done: true,
          providers: [
            { kind: "anthropic", cliPresent: true },
            { kind: "openai-compatible", cliPresent: false },
            { kind: "google", cliPresent: false }
          ]
        },
        connectors: { done: false }
      }
    })
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Connect the assistant I’ll run." })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Install first" })).toHaveCount(2);

  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText("Connection ready.")).toBeVisible();
});

test("a non-owner never sees the wizard", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: false, // non-admin ⇒ non-owner (meResponseFor keeps it coherent)
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus() // even incomplete, must be ignored for non-owners
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Let’s get your Jarvis set up." })
  ).not.toBeVisible();
});

test("a status-endpoint error falls through to the app shell", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: []
  });
  // Override status to 500 AFTER mockApi registers its 200 handler (last route wins).
  await page.route("**/api/onboarding/status", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "down" })
    })
  );

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Let’s get your Jarvis set up." })
  ).not.toBeVisible();
});
