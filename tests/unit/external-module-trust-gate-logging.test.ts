// tests/unit/external-module-trust-gate-logging.test.ts
//
// Every trust-gate refusal in createVerifiedExternalModuleInvoker resolves the caller to
// `undefined`, and a pg-boss queue job that resolves to `undefined` is recorded `completed`
// with NULL output in milliseconds. From outside the worker that is indistinguishable from
// "the handler ran and had nothing to do", and until this logging existed it emitted no log
// line at all — there was nothing to grep, so diagnosing one cost repeated redeploy cycles.
//
// These tests pin the log line, not the refusal: the refusal behavior itself (resolve to
// undefined, never throw) is covered by external-module-invocation-budget.test.ts and is
// deliberately re-asserted here so a future "make the gate throw" change fails loudly.
import { describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";
import type { Job } from "pg-boss";

import type { DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import type { ExternalModuleJobPayload } from "@jarv1s/jobs";
import type { ExternalModuleDiscovery } from "@jarv1s/module-registry";
import type { ExternalModuleQueueDeclaration } from "@jarv1s/module-sdk";
import type { ModuleCredentialCipher } from "@jarv1s/settings";

import { createExternalModuleJobHandler } from "../../apps/worker/src/external-module-job-handler.js";

const OWNER = "00000000-0000-4000-8000-00000000000a";
const MANIFEST_HASH = `sha256:${"a".repeat(64)}`;
const PACKAGE_HASH = `sha256:${"b".repeat(64)}`;

/** A chainable stand-in for the single status/hash lookup the gate runs. */
function fakeWorkerDb(
  row: { status: string; manifest_hash: string; package_hash: string } | undefined
): Kysely<JarvisDatabase> {
  const builder = {
    selectFrom: () => builder,
    select: () => builder,
    where: () => builder,
    executeTakeFirst: async () => row
  };
  return builder as unknown as Kysely<JarvisDatabase>;
}

function discovery(): ExternalModuleDiscovery {
  return {
    id: "acme",
    manifestHash: MANIFEST_HASH,
    packageHash: PACKAGE_HASH,
    manifest: {}
  } as unknown as ExternalModuleDiscovery;
}

const queue: ExternalModuleQueueDeclaration = {
  name: "acme.crawl-run",
  handler: "crawl.run"
} as unknown as ExternalModuleQueueDeclaration;

function job(): Job<ExternalModuleJobPayload> {
  return {
    id: "job-1",
    data: {
      actorUserId: OWNER,
      moduleId: "acme",
      jobKind: "crawl.run",
      manifestHash: MANIFEST_HASH
    }
  } as unknown as Job<ExternalModuleJobPayload>;
}

/**
 * Builds a handler whose gate inputs can each be individually poisoned. Defaults are the
 * happy path, so every test below changes exactly one thing and the reason it logs is
 * unambiguous.
 */
function fixture(
  overrides: {
    row?: { status: string; manifest_hash: string; package_hash: string } | undefined;
    discovered?: boolean;
    activeUsers?: readonly string[];
  } = {}
) {
  const module = discovery();
  const warn = vi.fn();
  const invoke = vi.fn().mockResolvedValue("done");
  const handler = createExternalModuleJobHandler({
    module,
    queue,
    workerDb: fakeWorkerDb(
      "row" in overrides
        ? overrides.row
        : { status: "enabled", manifest_hash: MANIFEST_HASH, package_hash: PACKAGE_HASH }
    ),
    discoveryById:
      overrides.discovered === false
        ? new Map<string, ExternalModuleDiscovery>()
        : new Map([[module.id, module]]),
    dataContext: {
      withDataContext: async (_access: unknown, fn: (db: DataContextDb) => unknown) =>
        fn({} as DataContextDb)
    } as unknown as DataContextRunner,
    cipher: {} as unknown as ModuleCredentialCipher,
    runtime: { invoke },
    listActiveUserIds: async () => overrides.activeUsers ?? [OWNER],
    logger: { warn }
  });
  return { handler, warn, invoke };
}

describe("external module trust-gate rejection logging", () => {
  it("logs the reason when the actor is not an active user of the module", async () => {
    const { handler, warn, invoke } = fixture({ activeUsers: [] });
    await expect(handler(job())).resolves.toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      event: "external_module.trust_gate_rejected",
      reason: "not-active",
      moduleId: "acme",
      jobKind: "crawl.run"
    });
  });

  it("logs the reason, and what WAS discovered, when the module is missing from discovery", async () => {
    // The discovered list is the useful half: an empty array says the staged package dir is
    // missing or unreadable, while a populated one without this id says the module alone
    // failed to stage.
    const { handler, warn } = fixture({ discovered: false });
    await expect(handler(job())).resolves.toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      reason: "not-discovered",
      discovered: []
    });
  });

  it("logs the reason and the current status when the module is not enabled", async () => {
    const { handler, warn } = fixture({
      row: { status: "disabled", manifest_hash: MANIFEST_HASH, package_hash: PACKAGE_HASH }
    });
    await expect(handler(job())).resolves.toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      reason: "not-enabled",
      status: "disabled"
    });
  });

  it("logs the reason with an absent status when there is no installation row at all", async () => {
    const { handler, warn } = fixture({ row: undefined });
    await expect(handler(job())).resolves.toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      reason: "not-enabled",
      status: null
    });
  });

  it("logs BOTH hash pairs on a mismatch, so which one drifted is readable from the log", async () => {
    // Which hash moved is the whole diagnosis: manifest-only means a core change without a
    // re-enable, package means the staged bytes moved under a running worker.
    const stale = `sha256:${"c".repeat(64)}`;
    const { handler, warn } = fixture({
      row: { status: "enabled", manifest_hash: MANIFEST_HASH, package_hash: stale }
    });
    await expect(handler(job())).resolves.toBeUndefined();
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      reason: "hash-mismatch",
      dbManifestHash: MANIFEST_HASH,
      discoveredManifestHash: MANIFEST_HASH,
      dbPackageHash: stale,
      discoveredPackageHash: PACKAGE_HASH
    });
  });

  it("stays silent on the happy path — a rejection log must mean a rejection", async () => {
    const { handler, warn, invoke } = fixture();
    await handler(job());
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not require a logger — an unwired caller still refuses without throwing", async () => {
    // The dep is optional so existing callers compile unchanged; a missing logger must not
    // turn a quiet refusal into a crash.
    const module = discovery();
    const handler = createExternalModuleJobHandler({
      module,
      queue,
      workerDb: fakeWorkerDb(undefined),
      discoveryById: new Map([[module.id, module]]),
      dataContext: {
        withDataContext: async (_access: unknown, fn: (db: DataContextDb) => unknown) =>
          fn({} as DataContextDb)
      } as unknown as DataContextRunner,
      cipher: {} as unknown as ModuleCredentialCipher,
      runtime: { invoke: vi.fn() },
      listActiveUserIds: async () => [OWNER]
    });
    await expect(handler(job())).resolves.toBeUndefined();
  });
});
