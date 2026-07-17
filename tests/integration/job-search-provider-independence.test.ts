// tests/integration/job-search-provider-independence.test.ts
//
// JS-09 (#938) Task 2 — provider independence (spec gate item 12, wire half).
// The job-search module requests a capability (`ctx.ai` → `module.job-search`
// service key) and must get an IDENTICAL module-visible result no matter which
// configured provider answers. This suite proves it with the REAL stack:
// the real `HttpApiAdapter` (no createAdapter injection) parses two genuinely
// different wire protocols served by a local `node:http` fake —
//
//   Anthropic shape:          POST /v1/messages, `x-api-key` +
//                             `anthropic-version` headers, forced
//                             `emit_structured_output` tool_use response,
//                             usage {input_tokens, output_tokens}
//   OpenAI-compatible shape:  POST /v1/chat/completions, `Authorization:
//                             Bearer`, response_format json_schema, JSON text
//                             in choices[0].message.content, usage
//                             {prompt_tokens, completion_tokens}
//
// — through the production worker bridge (`createModuleWorkerAiBridge`), which
// must strip usage/model/provider identity before the module sees the result.
// The fake records every request so the suite can assert both distinct shapes
// were actually exercised (not one shape twice). Providers/models are seeded
// through the real admin routes (`baseUrl` pointed at the fake); the
// per-module binding is written via AiRepository directly — the PUT route
// requires the module row to be installed and its validation is already
// covered by ai-structured.test.ts.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";

import { AiRepository } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import type { ExternalModuleAiResult } from "@jarv1s/module-registry/node";

import { createApiServer } from "../../apps/api/src/server.js";
import { createModuleWorkerAiBridge } from "../../apps/worker/src/external-module-ai-bridge.js";
import { EVALUATION_OUTPUT_SCHEMA } from "../../external-modules/job-search/src/worker/evaluate.js";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

// Shared with the JS-01..08 suites and the Task 2 package sweep; stated in the
// PR body so QA can re-run the scan.
const PROVIDER_RE =
  /openai|anthropic|claude|gemini|gpt-|mistral|llama|sonnet|haiku|deepseek|bedrock|vertex/i;

const MODEL_ID_ANTHROPIC_SHAPE = "json-economy-a";
const MODEL_ID_OPENAI_SHAPE = "json-economy-o";

/** Schema-valid evaluation output (mirrors the worker-evaluate unit suite). */
function validOutput(): Record<string, unknown> {
  return {
    fitBand: "strong",
    recommendation: "review",
    evidence: [
      { requirement: "5y TypeScript", evidence: "8y TypeScript at Acme", source: "resume" }
    ],
    blockers: [],
    gaps: ["No Kubernetes exposure"],
    unknowns: ["Team size"],
    preferenceMatches: ["remote"],
    preferenceConflicts: [],
    postingConfidence: "high",
    overallConfidence: "medium",
    summary: "Strong technical match."
  };
}

type SeenRequest = {
  readonly method: string;
  readonly path: string;
  readonly auth: "x-api-key" | "bearer" | "none";
  readonly anthropicVersionHeader: boolean;
  /** Anthropic shape: forced tool_choice; OpenAI shape: response_format kind. */
  readonly structuredMechanism: string;
};

let appDb: Kysely<JarvisDatabase>;
let boss: PgBoss;
let dataContext: DataContextRunner;
let repository: AiRepository;
let apiServer: Awaited<ReturnType<typeof createApiServer>>;
let wireFake: Server;
let baseUrl: string;
let previousSecretKey: string | undefined;

const seenRequests: SeenRequest[] = [];
const resultsByShape = new Map<string, ExternalModuleAiResult>();

function adminContext(): AccessContext {
  return { actorUserId: ids.adminUser, requestId: "request:js09-provider-independence" };
}

// One fake server, two wire protocols routed by path. Response fields copied
// from what extractStructuredResult() actually parses per kind — the value of
// this suite is that the real adapter consumes two genuinely different shapes.
function startWireFake(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      const auth =
        typeof req.headers["x-api-key"] === "string"
          ? "x-api-key"
          : req.headers.authorization?.startsWith("Bearer ")
            ? "bearer"
            : "none";

      if (req.url === "/v1/messages") {
        const body = JSON.parse(raw) as Record<string, unknown>;
        const toolChoice = body.tool_choice as { type?: string; name?: string } | undefined;
        seenRequests.push({
          method: req.method ?? "",
          path: req.url,
          auth,
          anthropicVersionHeader: typeof req.headers["anthropic-version"] === "string",
          structuredMechanism: `tool_choice:${toolChoice?.type ?? "none"}:${toolChoice?.name ?? ""}`
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            content: [{ type: "tool_use", name: "emit_structured_output", input: validOutput() }],
            usage: { input_tokens: 12, output_tokens: 9 }
          })
        );
        return;
      }

      if (req.url === "/v1/chat/completions") {
        const body = JSON.parse(raw) as Record<string, unknown>;
        const responseFormat = body.response_format as { type?: string } | undefined;
        seenRequests.push({
          method: req.method ?? "",
          path: req.url,
          auth,
          anthropicVersionHeader: typeof req.headers["anthropic-version"] === "string",
          structuredMechanism: `response_format:${responseFormat?.type ?? "none"}`
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(validOutput()) } }],
            usage: { prompt_tokens: 12, completion_tokens: 9 }
          })
        );
        return;
      }

      // Anything else (e.g. the provider-create auto-discovery probe hitting
      // GET /v1/models, #870) gets a 404 — discovery soft-fails by design and
      // must never block provider creation; only the two structured endpoints
      // above count as wire-shape traffic.
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected path" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

async function seedProvider(providerKind: string, displayName: string): Promise<string> {
  const response = await apiServer.inject({
    method: "POST",
    url: "/api/ai/providers",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: {
      providerKind,
      displayName,
      baseUrl,
      credentialPayload: { apiKey: `independence-secret-${providerKind}` }
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  // The route must persist baseUrl or the adapter would hit the real vendor.
  expect(response.json().provider.baseUrl).toBe(baseUrl);
  return response.json().provider.id as string;
}

async function seedModel(providerConfigId: string, providerModelId: string): Promise<string> {
  const response = await apiServer.inject({
    method: "POST",
    url: "/api/ai/models",
    headers: { authorization: `Bearer ${ids.sessionAdmin}` },
    payload: {
      providerConfigId,
      providerModelId,
      displayName: providerModelId,
      capabilities: ["json"],
      tier: "economy"
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().model.id as string;
}

/** Bind module.job-search to a model, then drive the REAL bridge + adapter. */
async function driveBridgeBoundTo(modelId: string): Promise<ExternalModuleAiResult> {
  await dataContext.withDataContext(adminContext(), (scopedDb) =>
    repository.setServiceBinding(
      scopedDb,
      "module.job-search",
      { kind: "model", modelId },
      ids.adminUser
    )
  );
  const bridge = createModuleWorkerAiBridge({
    aiRepository: repository,
    logger: { info() {}, warn() {} }
  });
  return dataContext.withDataContext(adminContext(), (scopedDb) =>
    bridge(scopedDb, "job-search", {
      schema: EVALUATION_OUTPUT_SCHEMA,
      prompt: "Evaluate fit for the stored profile."
    })
  );
}

function expectNoIdentifierLeakage(result: ExternalModuleAiResult): void {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(PROVIDER_RE);
  expect(serialized).not.toContain(MODEL_ID_ANTHROPIC_SHAPE);
  expect(serialized).not.toContain(MODEL_ID_OPENAI_SHAPE);
  expect(serialized).not.toContain("Independence"); // provider display names
  expect(serialized).not.toContain("usage"); // bridge drops token accounting
}

beforeAll(async () => {
  previousSecretKey = process.env.JARVIS_AI_SECRET_KEY;
  process.env.JARVIS_AI_SECRET_KEY = "test-provider-independence-secret";

  await resetFoundationDatabase();
  appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
  dataContext = new DataContextRunner(appDb);
  repository = new AiRepository();
  // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
  // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
  // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
  // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
  // Test-only — production callers of createApiServer() are unaffected.
  boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
  apiServer = createApiServer({ appDb, boss, logger: false });
  await apiServer.ready();

  ({ server: wireFake, baseUrl } = await startWireFake());
});

afterAll(async () => {
  await Promise.allSettled([
    apiServer?.close(),
    appDb?.destroy(),
    boss?.stop({ graceful: false }),
    new Promise((resolve) => wireFake?.close(resolve))
  ]);
  if (previousSecretKey === undefined) delete process.env.JARVIS_AI_SECRET_KEY;
  else process.env.JARVIS_AI_SECRET_KEY = previousSecretKey;
});

describe("job-search provider independence — two real wire shapes (#938 gate item 12)", () => {
  it("real adapter drives the Anthropic wire shape; module sees a clean result", async () => {
    const providerId = await seedProvider("anthropic", "Independence A");
    const modelId = await seedModel(providerId, MODEL_ID_ANTHROPIC_SHAPE);

    const result = await driveBridgeBoundTo(modelId);

    expect(result).toEqual({ ok: true, object: validOutput() });
    expectNoIdentifierLeakage(result);
    resultsByShape.set("anthropic-shape", result);
  });

  it("real adapter drives the OpenAI-compatible wire shape; module sees a clean result", async () => {
    const providerId = await seedProvider("openai-compatible", "Independence O");
    const modelId = await seedModel(providerId, MODEL_ID_OPENAI_SHAPE);

    const result = await driveBridgeBoundTo(modelId);

    expect(result).toEqual({ ok: true, object: validOutput() });
    expectNoIdentifierLeakage(result);
    resultsByShape.set("openai-shape", result);
  });

  it("module-visible result is byte-identical across provider shapes", () => {
    const anthropicShape = resultsByShape.get("anthropic-shape");
    const openaiShape = resultsByShape.get("openai-shape");
    expect(anthropicShape).toBeDefined();
    expect(openaiShape).toBeDefined();
    expect(JSON.stringify(anthropicShape)).toBe(JSON.stringify(openaiShape));
  });

  it("the fake saw two genuinely different wire protocols, one request each", () => {
    expect(seenRequests).toHaveLength(2);
    expect(seenRequests).toContainEqual({
      method: "POST",
      path: "/v1/messages",
      auth: "x-api-key",
      anthropicVersionHeader: true,
      structuredMechanism: "tool_choice:tool:emit_structured_output"
    });
    expect(seenRequests).toContainEqual({
      method: "POST",
      path: "/v1/chat/completions",
      auth: "bearer",
      anthropicVersionHeader: false,
      structuredMechanism: "response_format:json_schema"
    });
  });
});
