import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import pg from "pg";

import { createApiServer } from "../../apps/api/src/server.js";
import { createPgBossClient, type PgBoss } from "@jarv1s/jobs";
import { AiRepository } from "@jarv1s/ai";
import {
  DataContextRunner,
  createDatabase,
  type AccessContext,
  type JarvisDatabase
} from "@jarv1s/db";
import { connectionStrings, ids, resetFoundationDatabase } from "./test-database.js";

const { Client } = pg;

// #738 — Chat voice input capture and transcription. #874 — routing rewired to the dedicated
// Voice (STT) endpoint.
//
// Covers: (1) transcription routes through the dedicated `purpose='voice'` endpoint (#874) — no
// hardcoded provider/model, and NOT an assistant provider; configuring the voice endpoint is what
// makes the route available; (2) raw audio bytes are never persisted, logged, or echoed back
// anywhere in the pipeline (defense in depth, since this route uniquely accepts a raw binary body —
// a naive implementation could easily leak it into an error message or log line).
describe("AI voice transcription route (#738)", () => {
  let appDb: Kysely<JarvisDatabase>;
  let dataContext: DataContextRunner;
  let repository: AiRepository;
  let server: ReturnType<typeof createApiServer>;
  let boss: PgBoss;
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
    // #1124: createApiServer()'s default boss falls back to pg-boss's own 10s
    // connectionTimeoutMillis, which a loaded CI runner's PG connection establishment can
    // exceed even when the connection ultimately succeeds. Pass an explicit, longer-but-still-
    // under-hookTimeout override so a slow-but-healthy CI connection isn't killed prematurely.
    // Test-only — production callers of createApiServer() are unaffected.
    boss = createPgBossClient(connectionStrings.app, { connectionTimeoutMillis: 25_000 });
    server = createApiServer({ appDb, boss, logger: false });
    await server.ready();
  });

  afterAll(async () => {
    await Promise.allSettled([server?.close(), appDb?.destroy(), boss?.stop({ graceful: false })]);
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

  it("routes through the configured voice endpoint (not a hardcoded provider) and returns only the transcript", async () => {
    // #874: transcription now resolves through the dedicated `purpose='voice'` endpoint, not a
    // generic assistant provider + transcription model. Configure it via the admin PUT route.
    await configureVoiceEndpoint("self-hosted-parakeet", "voice-secret-key");

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
    // #874: re-point the single voice endpoint (upsert) so the request reaches the mocked upstream
    // that this test drives to a 500 — no instance-default juggling; voice has its own dedicated row.
    await configureVoiceEndpoint("self-hosted-parakeet-2", "voice-secret-key-2");

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
    const loggedServer = createApiServer({ appDb, boss, logger: true });
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

  // #874: configure (upsert) the single instance-wide Voice (STT) endpoint via the admin PUT route.
  // This replaces the old "assistant provider + transcription model" setup — transcription now
  // resolves ONLY through the dedicated `purpose='voice'` endpoint.
  async function configureVoiceEndpoint(modelName: string, apiKey: string): Promise<void> {
    const response = await server.inject({
      method: "PUT",
      url: "/api/ai/voice-endpoint",
      headers: { authorization: `Bearer ${ids.sessionA}` },
      payload: { baseUrl: "https://voice.example", modelName, apiKey }
    });
    expect(response.statusCode).toBe(200);
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
