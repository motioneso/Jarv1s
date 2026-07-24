import { expect, test } from "@playwright/test";

import { mockApi } from "./mock-api.js";
import { mockExternalWebModuleFromDist } from "./mock-modules.js";

test("Job Search renders a grounded resume review inline and queues approval (#1233)", async ({
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

  const turns: Record<string, unknown>[] = [];
  await page.route("**/api/chat/stream*", async (route) => {
    const surface = new URL(route.request().url()).searchParams.get("surface");
    const reviewRecord = {
      kind: "action_result",
      text: "Executed: job-search.resume.critique",
      actionRequestId: "review-action-1",
      toolName: "job-search.resume.critique",
      outcome: "executed",
      result: {
        status: "ok",
        revisionId: "review-1",
        artifact: {
          critique: [{ section: "Experience", text: "Make the outcome easier to scan." }],
          revisions: [
            {
              section: "Summary",
              before: "Led a migration",
              after: "Led a platform migration with clear outcomes.",
              evidence: "Led a migration"
            }
          ],
          strengths: [{ text: "Migration leadership", evidence: "Led a migration" }],
          gaps: [{ text: "Cloud certification", evidence: "AWS certification" }]
        }
      }
    };
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      headers: { "cache-control": "no-cache" },
      body: surface === "job-search" ? `data: ${JSON.stringify(reviewRecord)}\n\n` : ""
    });
  });
  await page.route("**/api/chat/turn", async (route) => {
    turns.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { reply: "I have the résumé." } });
  });
  const queueBodies: Record<string, unknown>[] = [];
  await page.route(
    "**/api/modules/job-search/queues/job-search.resume-revise/run*",
    async (route) => {
      queueBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ status: 202, json: { jobId: "job-1" } });
    }
  );

  await page.goto("/m/job-search");
  await page.getByRole("button", { name: "Start a new search" }).click();

  const card = page.getByRole("article", { name: "Résumé review draft" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Strengths I’ll cite");
  await expect(card).toContainText("I’d source before citing");
  await expect(card).toContainText("Make the outcome easier to scan.");
  await expect(card).toContainText("Led a migration");
  await expect(card.locator("del")).toContainText("Led a migration");
  await expect(card.locator("ins")).toContainText("Led a platform migration with clear outcomes.");

  const composer = page.getByRole("textbox", { name: "Message Jarvis" });
  await card.getByRole("button", { name: "Looks right — use it" }).click();
  await expect
    .poll(() => queueBodies)
    .toEqual([
      {
        jobKind: "job-search.resume-revise",
        params: { revisionId: "review-1" }
      }
    ]);
  await expect(composer).toHaveValue(
    "Looks right — use this approved résumé and help me continue."
  );

  await page.getByRole("button", { name: "Paste résumé" }).click();
  await composer.fill("Led a migration");
  await composer.press("Enter");
  await expect
    .poll(() => turns)
    .toContainEqual({
      text: "Led a migration",
      controlContext: { step: "resume", action: "paste" },
      surface: "job-search"
    });
});
