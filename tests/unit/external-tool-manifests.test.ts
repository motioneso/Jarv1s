import { expect, it, vi } from "vitest";

import { createExternalToolManifests } from "@jarv1s/module-registry/node";
import type { ExternalModuleDiscovery } from "../../packages/module-registry/src/external/types.js";

const discovery: ExternalModuleDiscovery = {
  id: "acme",
  dir: "/modules/acme",
  manifest: {
    schemaVersion: 1,
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    publisher: "Acme",
    lifecycle: "user-toggleable",
    compatibility: { jarv1s: ">=0.0.0" },
    runtime: { workerEntrypoint: "dist/worker.js", workerContractVersion: 1 },
    assistantTools: [
      {
        name: "acme.write",
        description: "Write",
        permissionId: "acme.write",
        risk: "write",
        handler: "write"
      }
    ]
  },
  manifestHash: "sha256:a",
  packageHash: "sha256:a"
};

it("adapts declarations into executable tools with parent-bound identity", async () => {
  const invoke = vi.fn(async () => ({ data: { ok: true } }));
  const [manifest] = createExternalToolManifests([discovery], invoke);
  expect(manifest).toMatchObject({
    id: "acme",
    availability: { supportsUserDisable: true },
    assistantTools: [{ name: "acme.write", risk: "write" }]
  });
  const execute = manifest?.assistantTools?.[0]?.execute;
  if (!execute) throw new Error("expected execute");
  const context = { actorUserId: "actor", requestId: "request", chatSessionId: "chat" };
  await execute({} as never, { moduleId: "evil" }, context, {});
  expect(invoke).toHaveBeenCalledWith(
    discovery,
    discovery.manifest.assistantTools?.[0],
    { moduleId: "evil" },
    context
  );
});
