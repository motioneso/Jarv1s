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
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).toBeVisible();
  // Ask Jarvis is disabled until a multiplexer is selected + a CLI is present.
  await expect(page.getByRole("button", { name: /Ask Jarvis/ })).toBeDisabled();

  // Advance to the last step and finish. The wizard resumes at the first INCOMPLETE step
  // (firstIncompleteStepIndex) — with a fresh pending status that is the multiplexer step, not
  // welcome — so click "Next" until the last step ("Finish") rather than a fixed count.
  const nextButton = page.getByRole("button", { name: "Next" });
  while (await nextButton.isVisible()) {
    await nextButton.click();
  }
  await page.getByRole("button", { name: "Finish" }).click();

  // After finish the status mock returns state:"completed"; the app.tsx branch falls through.
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).first().click();
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Set up Jarv1s" })).not.toBeVisible();
});
