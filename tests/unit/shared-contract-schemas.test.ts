import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  addTaskActivityRequestSchema,
  breakdownTaskRequestSchema,
  createTaskListRequestSchema,
  createTaskRequestSchema,
  createTaskTagRequestSchema,
  deferredTaskStatusRequestSchema,
  errorResponseSchema,
  idParamsSchema,
  jsonObjectSchema,
  taskListParamsSchema,
  taskParamsSchema,
  updateTaskPreferencesRequestSchema,
  updateTaskRequestSchema
} from "@jarv1s/shared";

// These schemas ARE the runtime Fastify validation contract. We exercise them through a real
// Fastify instance (the same ajv path that runs in prod) rather than re-implementing a validator,
// so the assertions match what the boundary actually does.
//
// Contract note: with Fastify's default ajv, `additionalProperties: false` does NOT 400 — it
// STRIPS unknown keys from `request.body` before the handler runs (removeAdditional). That is the
// defense-in-depth win: attacker-supplied keys never reach the repository layer (no mass-assignment
// surface). A `required` field that is missing still yields a 400.
const UNKNOWN_KEY = "__unexpected_key__";

async function parseBody(
  bodySchema: unknown,
  payload: Record<string, unknown>
): Promise<{ status: number; body: Record<string, unknown> | undefined }> {
  const app = Fastify();
  app.post("/probe", { schema: { body: bodySchema as never } }, async (req) => req.body);
  const res = await app.inject({
    method: "POST",
    url: "/probe",
    payload,
    headers: { "content-type": "application/json" }
  });
  await app.close();
  return {
    status: res.statusCode,
    body: res.statusCode === 200 ? (JSON.parse(res.body) as Record<string, unknown>) : undefined
  };
}

describe("tasks request schemas strip unknown body keys (additionalProperties: false)", () => {
  const cases: Array<[string, unknown, Record<string, unknown>, string]> = [
    ["createTaskRequestSchema", createTaskRequestSchema, { title: "T" }, "title"],
    ["updateTaskRequestSchema", updateTaskRequestSchema, { title: "T" }, "title"],
    [
      "addTaskActivityRequestSchema",
      addTaskActivityRequestSchema,
      { activityType: "note" },
      "activityType"
    ],
    [
      "deferredTaskStatusRequestSchema",
      deferredTaskStatusRequestSchema,
      { status: "todo" },
      "status"
    ],
    ["createTaskListRequestSchema", createTaskListRequestSchema, { name: "L" }, "name"],
    ["createTaskTagRequestSchema", createTaskTagRequestSchema, { name: "G" }, "name"],
    ["breakdownTaskRequestSchema", breakdownTaskRequestSchema, { steps: ["a"] }, "steps"],
    [
      "updateTaskPreferencesRequestSchema",
      updateTaskPreferencesRequestSchema,
      { defaultView: "priority" },
      "defaultView"
    ]
  ];

  for (const [name, schema, validBody, keptKey] of cases) {
    it(`${name} drops the unknown key and keeps the declared field`, async () => {
      const { status, body } = await parseBody(schema, { ...validBody, [UNKNOWN_KEY]: "x" });
      expect(status).toBe(200);
      expect(body).toBeDefined();
      expect(body).not.toHaveProperty(UNKNOWN_KEY);
      expect(body).toHaveProperty(keptKey);
    });
  }

  it("createTaskRequestSchema still 400s when the required field is missing", async () => {
    const { status } = await parseBody(createTaskRequestSchema, {});
    expect(status).toBe(400);
  });
});

describe("tasks params schemas are closed (additionalProperties: false)", () => {
  it("taskParamsSchema and taskListParamsSchema declare additionalProperties: false", () => {
    expect((taskParamsSchema as { additionalProperties?: boolean }).additionalProperties).toBe(
      false
    );
    expect((taskListParamsSchema as { additionalProperties?: boolean }).additionalProperties).toBe(
      false
    );
  });
});

describe("shared schema fragments", () => {
  it("errorResponseSchema requires `error` and strips extra keys", async () => {
    const ok = await parseBody(errorResponseSchema, { error: "boom", [UNKNOWN_KEY]: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ error: "boom" });
    const missing = await parseBody(errorResponseSchema, {});
    expect(missing.status).toBe(400);
  });

  it("idParamsSchema requires `id` and strips extra keys", async () => {
    const ok = await parseBody(idParamsSchema, { id: "abc", [UNKNOWN_KEY]: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ id: "abc" });
    const missing = await parseBody(idParamsSchema, {});
    expect(missing.status).toBe(400);
  });

  it("jsonObjectSchema stays deliberately open and retains arbitrary nested keys", async () => {
    expect((jsonObjectSchema as { additionalProperties?: boolean }).additionalProperties).toBe(
      true
    );
    // A closed wrapper strips unknown TOP-level keys, but the open blob field keeps its nested keys.
    const wrapper = {
      type: "object",
      additionalProperties: false,
      required: ["blob"],
      properties: { blob: jsonObjectSchema }
    } as const;
    const { status, body } = await parseBody(wrapper, {
      blob: { anything: [1, 2, 3], nested: { ok: true } },
      [UNKNOWN_KEY]: "drop me"
    });
    expect(status).toBe(200);
    expect(body).toEqual({ blob: { anything: [1, 2, 3], nested: { ok: true } } });
  });
});
