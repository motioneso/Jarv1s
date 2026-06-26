import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import { wellnessExportRequestSchema, WELLNESS_EXPORT_CATEGORIES } from "@jarv1s/shared";

// Mirrors the body the web client builds in WellnessExportModal → requestWellnessExport. We
// exercise the shared request schema (the server's validation contract) against the exact shape
// the modal produces, so a drift between the client construction and the server contract fails
// here rather than at runtime in the browser.
async function validateBody(body: unknown): Promise<number> {
  const app = Fastify();
  app.post("/probe", { schema: { body: wellnessExportRequestSchema as never } }, async (req) => req.body);
  const res = await app.inject({
    method: "POST",
    url: "/probe",
    payload: body as Record<string, unknown>,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return res.statusCode;
}

describe("wellness export modal → server contract (#484)", () => {
  it("the default modal body (last 90 days, all categories) validates", async () => {
    // The modal defaults: from = today-90, to = today, categories = all four.
    const body = {
      from: "2026-02-01",
      to: "2026-04-01",
      categories: [...WELLNESS_EXPORT_CATEGORIES]
    };
    expect(await validateBody(body)).toBe(200);
  });

  it("a single-category selection validates", async () => {
    const body = {
      from: "2026-03-01",
      to: "2026-03-31",
      categories: ["therapyNotes"]
    };
    expect(await validateBody(body)).toBe(200);
  });

  it("rejects an empty category selection (the modal disables Generate when none are picked)", async () => {
    const body = {
      from: "2026-03-01",
      to: "2026-03-31",
      categories: []
    };
    expect(await validateBody(body)).toBe(400);
  });
});
