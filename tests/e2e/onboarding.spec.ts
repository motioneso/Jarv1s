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
  await expect(page.getByText("A secure, inspectable connection to your machine.")).toBeVisible();
  await expect(page.getByText("Skip setup and open the app.")).toBeVisible();
  await expect(page.getByText("Tweaks")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Ask Jarvis/ })).toHaveCount(0);

  await page.getByRole("button", { name: /Start setup/ }).click();
  const continueButton = page.getByRole("button", { name: /Continue/ });
  while (await continueButton.isVisible()) {
    await continueButton.click();
  }
  await expect(page.getByRole("heading", { name: "Jarvis is ready." })).toBeVisible();
  // v0.1.3 founder flow: welcome → Assistant (cliAuth) → Google (connectors) → Finish.
  // The multiplexer "Control channel" step is gone; the finish recap shows Provider + Google.
  await expect(
    page.getByLabel("Onboarding step").getByText("Provider", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByLabel("Onboarding step").getByText("Google", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Open today’s brief" }).click();

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
  await page
    .getByRole("dialog", { name: "Skip setup without connecting a provider?" })
    .getByRole("button", { name: "Skip anyway" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Let’s get your Jarvis set up." })
  ).not.toBeVisible();
  await expect(page.locator(".module-nav").getByRole("link", { name: "Today" })).toBeVisible();
});

test("a connected provider renders the ready state on the cliAuth step", async ({ page }) => {
  await mockApi(page, {
    authenticated: true,
    isInstanceAdmin: true,
    chatThreads: [],
    connectorAccounts: [],
    connectorProviders: createMockConnectorProviders(),
    notifications: [],
    tasks: [],
    onboardingStatus: defaultOnboardingStatus({
      // v0.1.3: onboarding offers only `anthropic`; the multiplexer step is gone.
      steps: {
        cliAuth: {
          done: true,
          providers: [{ kind: "anthropic", cliPresent: true, installState: "ready" }]
        },
        connectors: { done: false }
      }
    })
  });

  await page.goto("/");
  await page
    .getByLabel("Onboarding progress")
    .getByRole("button", { name: /Assistant/ })
    .click();
  await expect(page.getByRole("heading", { name: "Connect your AI provider." })).toBeVisible();
  await expect(page.getByText("1 provider connected · chat is ready")).toBeVisible();
  await expect(page.locator(".onb-detect", { hasText: "Connected" })).toBeVisible();
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

test("onboarding offers IMAP providers and makes no Microsoft promises", async ({ page }) => {
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
        cliAuth: {
          done: true,
          providers: [{ kind: "anthropic", cliPresent: true, installState: "ready" }]
        },
        connectors: { done: false }
      }
    })
  });

  await page.goto("/");
  await page
    .getByLabel("Onboarding progress")
    .getByRole("button", { name: /Google/ })
    .click();

  for (const provider of ["Yahoo Mail", "Proton Mail", "iCloud", "Fastmail"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`Connect ${provider}`, "i") })
    ).toBeVisible();
  }

  await expect(page.getByText("Outlook")).toHaveCount(0);
  await expect(page.getByText("Microsoft 365")).toHaveCount(0);

  await page.getByRole("button", { name: /Connect Proton Mail/i }).click();
  await expect(
    page.getByText(/Requires a paid Proton plan with Proton Mail Bridge installed and running/i)
  ).toBeVisible();
  await expect(
    page.getByText(/Passwords are encrypted at rest and never shown in logs or briefings/i)
  ).toBeVisible();
});
