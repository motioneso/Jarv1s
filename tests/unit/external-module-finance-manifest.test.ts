// tests/unit/external-module-finance-manifest.test.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { assertModuleJobPayload } from "@jarv1s/jobs";
import { validateExternalModuleManifest } from "@jarv1s/module-registry";

// FIN-01 (#1146): the REAL shipped finance manifest must pass the merged external
// ABI, and targeted mutations must fail closed. Slice deltas vs the design spec
// (grounded-decisions D1–D4): Plaid creds are declared auth slots resolved at
// runtime (never in the manifest), the connect poll is a shared tool+queue
// handler, and the sweep schedule posts directly onto finance.sync-run.
const manifestPath = fileURLToPath(
  new URL("../../external-modules/finance/jarvis.module.json", import.meta.url)
);
const loadManifest = (): Record<string, unknown> =>
  JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

describe("finance manifest contract (#1146)", () => {
  it("accepts the shipped manifest against the merged ABI", () => {
    const result = validateExternalModuleManifest(loadManifest(), "finance", "0.1.0");
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.id).toBe("finance");
    // FIN-01 is worker-only; the web surface lands in FIN-02 (#1147).
    expect(result.manifest.web).toBeUndefined();
    expect(result.manifest.navigation).toBeUndefined();
    expect(result.manifest.runtime).toEqual({
      workerEntrypoint: "dist/worker.js",
      workerContractVersion: 1
    });

    // Tool surface: name === permissionId (one permission per tool), and the
    // run-now tool shares its handler with the finance.sync-run queue (D3).
    expect((result.manifest.assistantTools ?? []).map((tool) => [tool.name, tool.handler])).toEqual(
      [
        ["finance.accounts.list", "accounts.list"],
        ["finance.connect.start", "connect.start"],
        ["finance.connect.poll", "connect.poll"],
        ["finance.sync.run-now", "sync.run"]
      ]
    );
    for (const tool of result.manifest.assistantTools ?? []) {
      expect(tool.permissionId).toBe(tool.name);
    }
    const riskOf = Object.fromEntries(
      (result.manifest.assistantTools ?? []).map((tool) => [tool.name, tool.risk])
    );
    expect(riskOf["finance.accounts.list"]).toBe("read");
    expect(riskOf["finance.connect.start"]).toBe("write");
    expect(riskOf["finance.connect.poll"]).toBe("write");
    expect(riskOf["finance.sync.run-now"]).toBe("write");

    // Credential slots: instance Plaid keys (admin-entered at runtime) + the
    // per-user token map. Tokens live ONLY in app.module_credentials — no KV
    // namespace below may ever hold them.
    expect(result.manifest.auth).toEqual([
      {
        id: "finance.plaid-client-id",
        displayName: "Plaid client id",
        kind: "api-key",
        scope: "instance"
      },
      {
        id: "finance.plaid-secret",
        displayName: "Plaid secret",
        kind: "api-key",
        scope: "instance"
      },
      {
        id: "finance.plaid-tokens",
        displayName: "Plaid access tokens",
        kind: "api-key",
        scope: "user"
      }
    ]);

    // Seven namespaces from the design spec; settings alone carries an instance
    // scope (admin-gated `plaid` → {environment} key, default write policy).
    expect(result.manifest.storage).toEqual([
      { namespace: "finance.connections", scopes: ["user"] },
      { namespace: "finance.accounts", scopes: ["user"] },
      { namespace: "finance.transactions", scopes: ["user"] },
      { namespace: "finance.categories", scopes: ["user"] },
      { namespace: "finance.rules", scopes: ["user"] },
      { namespace: "finance.snapshots", scopes: ["user"] },
      { namespace: "finance.settings", scopes: ["user", "instance"] }
    ]);

    // D2/D3: connect-poll queue shares the tool handler; the six-hourly sweep
    // posts directly onto finance.sync-run (no sweep handler exists).
    expect(result.manifest.worker?.queues).toEqual([
      { name: "finance.sync-run", handler: "sync.run", retryLimit: 3, allowManualRun: true },
      { name: "finance.connect-poll", handler: "connect.poll", retryLimit: 5, allowManualRun: true }
    ]);
    expect(result.manifest.worker?.schedules).toEqual([
      {
        id: "finance.sync-sweep",
        cron: "41 */6 * * *",
        scope: "user",
        jobKind: "finance.sync-sweep",
        queue: "finance.sync-run"
      }
    ]);

    expect(result.manifest.fetchHosts).toEqual(["production.plaid.com", "sandbox.plaid.com"]);
  });

  it("every tool declares a strict input schema; connect.start allows only environment", () => {
    const tools = loadManifest().assistantTools as Array<Record<string, unknown>>;
    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema.type, String(tool.name)).toBe("object");
      expect(schema.additionalProperties, String(tool.name)).toBe(false);
    }
    const start = tools.find((tool) => tool.name === "finance.connect.start")!;
    const props = (start.inputSchema as { properties: Record<string, Record<string, unknown>> })
      .properties;
    expect(Object.keys(props)).toEqual(["environment"]);
    expect(props.environment?.enum).toEqual(["production", "sandbox"]);
    expect((start.inputSchema as Record<string, unknown>).required).toBeUndefined();
  });

  it("payloads pass the platform metadata-only gate and reject undeclared params", () => {
    const result = validateExternalModuleManifest(loadManifest(), "finance", "0.1.0");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const syncQueue = result.manifest.worker!.queues![0]!;
    const base = {
      actorUserId: "11111111-1111-4111-8111-111111111111",
      moduleId: "finance",
      manifestHash: `sha256:${"a".repeat(64)}`
    };
    expect(() =>
      assertModuleJobPayload(syncQueue, { ...base, jobKind: "finance.sync-sweep" })
    ).not.toThrow();
    // No paramsSchema declared → ANY params object is rejected, which is the
    // fail-closed gate keeping account/transaction content out of pg-boss.
    expect(() =>
      assertModuleJobPayload(syncQueue, {
        ...base,
        jobKind: "finance.sync-run-now",
        params: { payee: "ACME GROCERY #42" }
      })
    ).toThrow();
  });

  it("rejects a token-bearing KV namespace outside the finance prefix", () => {
    const manifest = loadManifest();
    const storage = manifest.storage as Array<Record<string, unknown>>;
    const mutated = {
      ...manifest,
      storage: [...storage, { namespace: "job-search.feed", scopes: ["user"] }]
    };
    const result = validateExternalModuleManifest(mutated, "finance", "0.1.0");
    expect(result.ok).toBe(false);
  });

  it("rejects duplicated permission ids", () => {
    const manifest = loadManifest();
    const tools = manifest.assistantTools as Array<Record<string, unknown>>;
    const mutated = {
      ...manifest,
      assistantTools: [
        { ...tools[0], permissionId: "finance.read" },
        { ...tools[1], permissionId: "finance.read" }
      ]
    };
    const result = validateExternalModuleManifest(mutated, "finance", "0.1.0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("unique");
  });

  it("rejects a non-api-key auth kind (fail closed on future credential kinds)", () => {
    const manifest = loadManifest();
    const auth = manifest.auth as Array<Record<string, unknown>>;
    const mutated = { ...manifest, auth: [{ ...auth[0], kind: "oauth" }] };
    const result = validateExternalModuleManifest(mutated, "finance", "0.1.0");
    expect(result.ok).toBe(false);
  });

  it("rejects forbidden executable-surface fields", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), permissions: [] },
      "finance",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });

  it("fails closed on a compound compatibility range", () => {
    const result = validateExternalModuleManifest(
      { ...loadManifest(), compatibility: { jarv1s: ">=0.1.0 <0.2.0" } },
      "finance",
      "0.1.0"
    );
    expect(result.ok).toBe(false);
  });
});
