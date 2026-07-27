/**
 * #1306 Task 22: "test-only" is a claim until something checks it. This proves the host-side
 * fetch bypass (apps/worker/src/external-module-job-handler.ts) is inert in every default
 * environment and only turns on with both env vars explicitly set — never on NODE_ENV, which
 * plays no part in the guard (see the file's own comment on why NODE_ENV-gating is fail-open).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  createE2eFixtureFetch,
  resolveE2eFetchOverride
} from "../../apps/worker/src/external-module-job-handler.js";

const ENV_KEYS = ["JARVIS_RUNTIME_MODE", "JARVIS_E2E_MODULE_FETCH_BASE", "NODE_ENV"] as const;

describe("resolveE2eFetchOverride", () => {
  const original: Record<(typeof ENV_KEYS)[number], string | undefined> = {
    JARVIS_RUNTIME_MODE: process.env.JARVIS_RUNTIME_MODE,
    JARVIS_E2E_MODULE_FETCH_BASE: process.env.JARVIS_E2E_MODULE_FETCH_BASE,
    NODE_ENV: process.env.NODE_ENV
  };

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("returns an object with no createFetch key at all when the fixture var is unset", () => {
    delete process.env.JARVIS_RUNTIME_MODE;
    delete process.env.JARVIS_E2E_MODULE_FETCH_BASE;
    const result = resolveE2eFetchOverride();
    // Asserting on the argument object's own keys, not on behaviour: a stray
    // `createFetch: undefined` would pass a `typeof result.createFetch === "undefined"`
    // check but still fail this one, exactly as it would defeat a `??` further down
    // the real call chain (external-module-invoke.ts's own `deps.createFetch ? {...} : {}`
    // spread).
    expect("createFetch" in result).toBe(false);
  });

  it.each([undefined, "development", "test", "production"])(
    "throws naming the variable when the fixture var is set but JARVIS_RUNTIME_MODE is not e2e (NODE_ENV=%s)",
    (nodeEnv) => {
      if (nodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnv;
      delete process.env.JARVIS_RUNTIME_MODE;
      process.env.JARVIS_E2E_MODULE_FETCH_BASE = "http://fixture.invalid:9999";
      expect(() => resolveE2eFetchOverride()).toThrow(/JARVIS_E2E_MODULE_FETCH_BASE/);
      expect(() => resolveE2eFetchOverride()).toThrow(/JARVIS_RUNTIME_MODE/);
    }
  );

  it("passes createFetch when both vars are set", () => {
    process.env.JARVIS_RUNTIME_MODE = "e2e";
    process.env.JARVIS_E2E_MODULE_FETCH_BASE = "http://fixture.invalid:9999";
    const result = resolveE2eFetchOverride();
    expect("createFetch" in result).toBe(true);
    expect(typeof result.createFetch).toBe("function");
  });
});

describe("createE2eFixtureFetch", () => {
  it("rejects a host outside the allowlist and rewrites the URL for one inside it", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input instanceof URL ? input.href : String(input), init]);
      return new Response("ok");
    }) as typeof fetch;
    try {
      const buildFetch = createE2eFixtureFetch("http://fixture.invalid:9999");
      const fixtureFetch = buildFetch(["www.linkedin.com"]);

      await expect(fixtureFetch("https://evil.example.com/steal")).rejects.toThrow();

      const response = await fixtureFetch("https://www.linkedin.com/guest/jobs?id=42");
      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls.at(0)?.[0]).toBe("http://fixture.invalid:9999/guest/jobs?id=42");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
