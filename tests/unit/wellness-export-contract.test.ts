import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { wellnessExportRequestSchema, wellnessExportResponseSchema } from "@jarv1s/shared";

// Schemas are exercised through a real Fastify instance (the same ajv path that runs in
// prod) so the assertions match what the boundary actually does. With Fastify's default
// ajv, `additionalProperties: false` STRIPS unknown keys (removeAdditional); a missing
// required field still yields a 400.
async function parseBody(
  bodySchema: unknown,
  payload: unknown
): Promise<number> {
  const app = Fastify();
  app.post("/probe", { schema: { body: bodySchema as never } }, async (req) => req.body);
  const res = await app.inject({
    method: "POST",
    url: "/probe",
    payload: payload as Record<string, unknown>,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return res.statusCode;
}

describe("wellness export request schema (#484)", () => {
  it("accepts a well-formed body with all categories", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "2026-01-01",
      to: "2026-03-31",
      categories: ["checkins", "medications", "therapyNotes", "insights"]
    });
    expect(status).toBe(200);
  });

  it("accepts a single-category export", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "2026-01-01",
      to: "2026-03-31",
      categories: ["checkins"]
    });
    expect(status).toBe(200);
  });

  it("rejects an unknown category", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "2026-01-01",
      to: "2026-03-31",
      categories: ["sleep"]
    });
    expect(status).toBe(400);
  });

  it("rejects an empty categories array (minItems: 1)", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "2026-01-01",
      to: "2026-03-31",
      categories: []
    });
    expect(status).toBe(400);
  });

  it("rejects a malformed date (not YYYY-MM-DD)", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "01/01/2026",
      to: "2026-03-31",
      categories: ["checkins"]
    });
    expect(status).toBe(400);
  });

  it("rejects a missing required field", async () => {
    const status = await parseBody(wellnessExportRequestSchema, {
      from: "2026-01-01",
      to: "2026-03-31"
    });
    expect(status).toBe(400);
  });

  it("strips unknown body keys (additionalProperties: false)", async () => {
    const app = Fastify();
    let captured: unknown;
    app.post(
      "/probe",
      { schema: { body: wellnessExportRequestSchema as never } },
      async (req) => {
        captured = req.body;
        return req.body;
      }
    );
    await app.inject({
      method: "POST",
      url: "/probe",
      payload: {
        from: "2026-01-01",
        to: "2026-03-31",
        categories: ["checkins"],
        malicious: "strip me"
      },
      headers: { "content-type": "application/json" }
    });
    await app.close();
    expect(captured).not.toHaveProperty("malicious");
  });
});

describe("wellness export response schema (#484)", () => {
  it("accepts a valid response shape", async () => {
    const app = Fastify();
    app.get("/probe", { schema: { response: { 200: wellnessExportResponseSchema } } }, () => ({
      jobId: "abc",
      status: "pending"
    }));
    const res = await app.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
