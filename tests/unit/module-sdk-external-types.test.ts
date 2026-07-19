import { describe, expect, it } from "vitest";

import { validateExternalModuleManifest } from "@jarv1s/module-registry";
import type { ExternalJarvisModulePackage, JsonJarvisModuleManifest } from "@jarv1s/module-sdk";

describe("external module manifest types (#917)", () => {
  const base = {
    schemaVersion: 1,
    id: "fixture",
    name: "Fixture",
    version: "0.1.0",
    publisher: "Fixture",
    lifecycle: "user-toggleable",
    compatibility: { jarv1s: ">=0.1.0" },
    runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 }
  } as const;

  it("accepts a metadata-only manifest", () => {
    const manifest: JsonJarvisModuleManifest = {
      schemaVersion: 1,
      id: "acme-widgets",
      name: "Acme Widgets",
      version: "0.1.0",
      publisher: "Acme, Inc.",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" },
      runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
      assistantTools: [
        {
          name: "acme-widgets.lookup",
          description: "Look up a widget",
          permissionId: "acme-widgets.lookup",
          risk: "read",
          handler: "lookup"
        }
      ]
    };
    const pkg: ExternalJarvisModulePackage = {
      manifest,
      manifestHash: "sha256:deadbeef",
      packageHash: "sha256:cafebabe"
    };
    expect(pkg.manifest.id).toBe("acme-widgets");
    expect(pkg.manifest.compatibility.jarv1s).toBe(">=0.1.0");
  });

  it("accepts a manifest whose navigation field type-checks (module-sdk ABI shape)", () => {
    const manifest: JsonJarvisModuleManifest = {
      schemaVersion: 1,
      id: "acme-widgets",
      name: "Acme Widgets",
      version: "0.1.0",
      publisher: "Acme, Inc.",
      lifecycle: "optional",
      compatibility: { jarv1s: ">=0.1.0" },
      navigation: [{ id: "acme-widgets", label: "Acme Widgets", path: "/" }]
    };
    expect(manifest.navigation?.[0]?.id).toBe("acme-widgets");
  });

  it("preserves a validated worker declaration and fetch hosts", () => {
    const result = validateExternalModuleManifest(
      {
        schemaVersion: 1,
        id: "fixture",
        name: "Fixture",
        version: "0.1.0",
        publisher: "Fixture",
        lifecycle: "user-toggleable",
        compatibility: { jarv1s: ">=0.1.0" },
        runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
        fetchHosts: ["api.example.com"],
        worker: {
          queues: [
            {
              name: "fixture.sync",
              handler: "sync",
              retryLimit: 2,
              allowManualRun: true,
              paramsSchema: {
                type: "object",
                fields: { resourceId: { type: "uuid" } }
              }
            }
          ],
          schedules: [
            {
              id: "daily",
              cron: "0 8 * * *",
              tz: "UTC",
              queue: "fixture.sync",
              jobKind: "daily-sync",
              scope: "user",
              params: { resourceId: "00000000-0000-4000-8000-000000000001" }
            }
          ]
        }
      },
      "fixture",
      "0.1.0"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.fetchHosts).toEqual(["api.example.com"]);
    expect(result.manifest.worker?.queues?.[0]?.name).toBe("fixture.sync");
    expect(result.manifest.worker?.schedules?.[0]?.id).toBe("daily");
  });

  it("preserves a validated worker.reconcileJobs declaration (#1166 F6-D4)", () => {
    const result = validateExternalModuleManifest(
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: [
            { id: "storage-migrate", queue: "fixture.migrate", jobKind: "fixture.migrate" }
          ]
        }
      },
      "fixture",
      "0.1.0"
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.worker?.reconcileJobs?.[0]).toEqual({
      id: "storage-migrate",
      queue: "fixture.migrate",
      jobKind: "fixture.migrate"
    });
  });

  it.each([
    [
      "reconcileJob targeting an undeclared queue",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: [
            { id: "storage-migrate", queue: "fixture.missing", jobKind: "fixture.migrate" }
          ]
        }
      },
      "declared queue"
    ],
    [
      "reconcileJob with a bad id",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: [
            { id: "Storage_Migrate", queue: "fixture.migrate", jobKind: "fixture.migrate" }
          ]
        }
      },
      "bounded lowercase kebab identifier"
    ],
    [
      "reconcileJob with unknown keys",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: [
            {
              id: "storage-migrate",
              queue: "fixture.migrate",
              jobKind: "fixture.migrate",
              extra: true
            }
          ]
        }
      },
      "unknown fields"
    ],
    [
      "duplicate reconcileJob ids",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: [
            { id: "storage-migrate", queue: "fixture.migrate", jobKind: "fixture.migrate" },
            { id: "storage-migrate", queue: "fixture.migrate", jobKind: "fixture.migrate" }
          ]
        }
      },
      "unique"
    ],
    [
      "too many reconcileJobs",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.migrate", handler: "migrate" }],
          reconcileJobs: Array.from({ length: 9 }, (_, index) => ({
            id: `job-${index}`,
            queue: "fixture.migrate",
            jobKind: "fixture.migrate"
          }))
        }
      },
      "8 reconcileJobs"
    ]
  ])("rejects %s", (_name, raw, expected) => {
    const result = validateExternalModuleManifest(raw, "fixture", "0.1.0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain(expected);
  });

  it.each([
    ["invalid fetch host", { ...base, fetchHosts: ["127.0.0.1"] }, "fetchHost"],
    [
      "foreign queue name",
      { ...base, worker: { queues: [{ name: "other.sync", handler: "sync" }] } },
      "prefixed"
    ],
    [
      "invalid cron",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.sync", handler: "sync" }],
          schedules: [
            {
              id: "daily",
              cron: "not cron",
              queue: "fixture.sync",
              jobKind: "daily",
              scope: "user"
            }
          ]
        }
      },
      "cron"
    ],
    [
      "dead-letter cycle",
      {
        ...base,
        worker: {
          queues: [
            { name: "fixture.a", handler: "a", deadLetterQueue: "fixture.b" },
            { name: "fixture.b", handler: "b", deadLetterQueue: "fixture.a" }
          ]
        }
      },
      "cycle"
    ],
    [
      "free-form string schema",
      {
        ...base,
        worker: {
          queues: [
            {
              name: "fixture.sync",
              handler: "sync",
              paramsSchema: { type: "object", fields: { content: { type: "string" } } }
            }
          ]
        }
      },
      "paramsSchema"
    ]
  ])("rejects %s", (_name, raw, expected) => {
    const result = validateExternalModuleManifest(raw, "fixture", "0.1.0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain(expected);
  });

  it.each([
    [
      "undeclared dead-letter target",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.sync", handler: "sync", deadLetterQueue: "fixture.missing" }]
        }
      },
      "deadLetterQueue"
    ],
    [
      "schedule targeting an undeclared queue",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.sync", handler: "sync" }],
          schedules: [
            {
              id: "daily",
              cron: "0 8 * * *",
              queue: "fixture.missing",
              jobKind: "daily",
              scope: "user"
            }
          ]
        }
      },
      "declared queue"
    ],
    [
      "invalid timezone",
      {
        ...base,
        worker: {
          queues: [{ name: "fixture.sync", handler: "sync" }],
          schedules: [
            {
              id: "daily",
              cron: "0 8 * * *",
              tz: "Mars/Olympus",
              queue: "fixture.sync",
              jobKind: "daily",
              scope: "user"
            }
          ]
        }
      },
      "time zone"
    ],
    [
      "schedule params that violate the queue schema",
      {
        ...base,
        worker: {
          queues: [
            {
              name: "fixture.sync",
              handler: "sync",
              paramsSchema: {
                type: "object",
                fields: { resourceId: { type: "uuid" } }
              }
            }
          ],
          schedules: [
            {
              id: "daily",
              cron: "0 8 * * *",
              queue: "fixture.sync",
              jobKind: "daily",
              scope: "user",
              params: { resourceId: "not-a-uuid" }
            }
          ]
        }
      },
      "params"
    ]
  ])("rejects %s", (_name, raw, expected) => {
    const result = validateExternalModuleManifest(raw, "fixture", "0.1.0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain(expected);
  });

  it("clamps retryLimit to the platform maximum", () => {
    const result = validateExternalModuleManifest(
      {
        ...base,
        worker: { queues: [{ name: "fixture.sync", handler: "sync", retryLimit: 999 }] }
      },
      "fixture",
      "0.1.0"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.worker?.queues?.[0]?.retryLimit).toBe(10);
  });

  it("rejects queue collisions with platform queues", () => {
    const result = validateExternalModuleManifest(
      {
        ...base,
        worker: { queues: [{ name: "fixture.sync", handler: "sync" }] }
      },
      "fixture",
      "0.1.0",
      new Set(["fixture.sync"])
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain("collides");
  });

  it.each([
    [
      "duplicate queues",
      {
        ...base,
        worker: {
          queues: [
            { name: "fixture.sync", handler: "a" },
            { name: "fixture.sync", handler: "b" }
          ]
        }
      },
      "unique"
    ],
    [
      "too many queues",
      {
        ...base,
        worker: {
          queues: Array.from({ length: 17 }, (_, index) => ({
            name: `fixture.q${index}`,
            handler: `h${index}`
          }))
        }
      },
      "16 queues"
    ],
    [
      "worker without runtime",
      {
        ...base,
        runtime: undefined,
        worker: { queues: [{ name: "fixture.sync", handler: "sync" }] }
      },
      "runtime is required"
    ]
  ])("rejects %s", (_name, raw, expected) => {
    const result = validateExternalModuleManifest(raw, "fixture", "0.1.0");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join("; ")).toContain(expected);
  });
});
