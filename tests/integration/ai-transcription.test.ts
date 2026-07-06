import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { AiRepository, createAiSecretCipher } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// #738 — Chat voice input capture and transcription.
//
// Covers: (1) transcription routes through the SAME provider-agnostic capability mechanism as
// every other AI capability (no hardcoded provider/model — a configured "transcription"-capable
// model is what makes the route available); (2) raw audio bytes are never persisted, logged, or
// echoed back anywhere in the pipeline (defense in depth, since this route uniquely accepts a
// raw binary body — a naive implementation could easily leak it into an error message or log
// line).
describe("AI voice transcription route (#738)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let originalSecretKey: string | undefined;
  let originalFetch: typeof fetch;

  beforeAll(async () => {
    originalSecretKey = process.env.JARVIS_AI_SECRET_KEY;
    process.env.JARVIS_AI_SECRET_KEY = "test-ai-secret-key";

    await resetFoundationDatabase();
    await setUserAInstanceAdmin();
    appDb = createDatabase({ connectionString: connectionStrings.app, maxConnections: 1 });
    dataContext = new DataContextRunner(appDb);
    repository = new AiRepository();
    server = createApiServer({ appDb, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy()]);
    if (originalSecretKey === undefined) {
      delete process.env.JARVIS_AI_SECRET_KEY;
    } else {
      process.env.JARVIS_AI_SECRET_KEY = originalSecretKey;
    }
  });

  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
  });

  it("reports the capability unavailable when no transcription-capable model is configured", async () => {
    const lookup = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/transcription",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({
      route: { capability: "transcription", available: false }
    });
  });

  it("422s the transcription upload when the capability has no configured model", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/transcriptions",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "audio/webm"
      },
      payload: Buffer.from([1, 2, 3, 4])
    });

    expect(response.statusCode).toBe(422);
  });

  it("routes through the configured model's provider (not a hardcoded provider) and returns only the transcript", async () => {
    const providerId = await createOpenAiCompatibleProvider("Voice provider", "voice-secret-key");
    await createModel(providerId, "self-hosted-parakeet", ["transcription"]);

    let capturedAuth: string | null = null;
    let capturedModelId: string | null = null;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const headers = new Headers(init?.headers);
      capturedAuth = headers.get("authorization");
      const form = init?.body as FormData;
      capturedModelId = form.get("model") as string | null;
      return new Response(JSON.stringify({ text: "the quick brown fox" }), { status: 200 });
    }) as typeof fetch;

    const lookup = await server.inject({
      method: "GET",
      url: "/api/ai/capability-route/transcription",
      headers: { authorization: `Bearer ${ids.sessionA}` }
    });

    const audioMarker = Buffer.from("not-a-real-audio-canary-9f3a1", "utf8");
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/transcriptions",
      headers: {
        authorization: `Bearer ${ids.sessionA}`,
        "content-type": "audio/webm"
      },
      payload: audioMarker
    });

    expect(lookup.json()).toMatchObject({
      route: { capability: "transcription", available: true }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: "the quick brown fox" });
    // Routed to the model/credential actually configured for the capability — never hardcoded.
    expect(capturedModelId).toBe("self-hosted-parakeet");
    expect(capturedAuth).toBe("Bearer voice-secret-key");
    // The transcript is the ONLY thing in the response — raw audio bytes never echo back.
    expect(response.body).not.toContain("not-a-real-audio-canary-9f3a1");
    expect(response.body).not.toContain("voice-secret-key");
    expect(response.body).not.toContain("ciphertext");
  });

  it("never logs or persists the raw audio bytes, even on an upstream failure", async () => {
    const providerId = await createOpenAiCompatibleProvider(
      "Voice provider 2",
      "voice-secret-key-2"
    );
    await createModel(providerId, "self-hosted-parakeet-2", ["transcription"]);

    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("upstream exploded", { status: 500 })) as typeof fetch;

    const audioMarker = Buffer.from("second-canary-do-not-log-4e21b", "utf8");
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = ((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    // A dedicated logger:true instance for this one test — logger:false (used by the shared
    // `server` above) is a Fastify null logger that would make this assertion vacuous.
    const loggedServer = createApiServer({ appDb, logger: true });
    await loggedServer.ready();

    let response;
    try {
      response = await loggedServer.inject({
        method: "POST",
        url: "/api/ai/transcriptions",
        headers: {
          authorization: `Bearer ${ids.sessionA}`,
          "content-type": "audio/webm"
        },
        payload: audioMarker
      });
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      await loggedServer.close();
    }

    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain("second-canary-do-not-log-4e21b");
    expect(stdoutChunks.length + stderrChunks.length).toBeGreaterThan(0);
    for (const chunk of [...stdoutChunks, ...stderrChunks]) {
      expect(chunk).not.toContain("second-canary-do-not-log-4e21b");
    }

    // Confirm no repository/table read-back surfaces the audio marker either — this endpoint
    // has no table of its own, so this asserts the wider AI module tables stay untouched.
    const models = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.listModels(scopedDb)
    );
    expect(JSON.stringify(models)).not.toContain("second-canary-do-not-log-4e21b");
  });

  async function createOpenAiCompatibleProvider(
    displayName: string,
    apiKey: string
  ): Promise<string> {
    const provider = await dataContext.withDataContext(userAContext(), (scopedDb) =>
      repository.createProvider(scopedDb, {
        providerKind: "openai-compatible",
        displayName,
        encryptedCredential: createAiSecretCipher().encryptJson({ apiKey })
      })
    );
    return provider.id;
  }

  async function createModel(
    providerConfigId: string,
    providerModelId: string,
    capabilities: readonly string[]
  ) {
    const response = await server.inject({
      method: "POST",
      url: "/api/ai/models",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: {
        providerConfigId,
        providerModelId,
        displayName: providerModelId,
        capabilities,
        tier: "interactive"
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ model: { id: string } }>().model.id;
  }
});

function userAContext(): AccessContext {
  return {
    actorUserId: ids.userA,
    requestId: "request:user-a-ai-transcription"
  };
}

// Provider/model creation is instance-admin-gated (RLS on ai_provider_configs). userA needs the
// flag flipped directly via a bootstrap connection, same pattern as ai-provider-validation.test.ts.
async function setUserAInstanceAdmin(): Promise<void> {
  const client = new Client({ connectionString: connectionStrings.bootstrap });

  await client.connect();
  try {
    await client.query(`UPDATE app.users SET is_instance_admin = true WHERE id = $1`, [ids.userA]);
  } finally {
    await client.end();
  }
}
