import { describe, expect, it, vi } from "vitest";

import { createExternalActiveModulesResolver } from "../../apps/api/src/external-module-tools.js";
import { discoverExternalModules } from "../../apps/api/src/server.js";

const log = { info: vi.fn(), warn: vi.fn() };

describe("discoverExternalModules (#917)", () => {
  it("returns an empty snapshot when the flag is off, without touching disk", () => {
    const result = discoverExternalModules(
      {
        host: "0.0.0.0",
        port: 3000,
        mcpServerUrl: "http://127.0.0.1:3000/api/mcp",
        enableExternalModules: false,
        externalModulesDir: "/does/not/matter"
      },
      log
    );
    expect(result.discoveries).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("returns an empty snapshot when enabled but no dir is configured", () => {
    const result = discoverExternalModules(
      {
        host: "0.0.0.0",
        port: 3000,
        mcpServerUrl: "http://127.0.0.1:3000/api/mcp",
        enableExternalModules: true,
        externalModulesDir: null
      },
      log
    );
    expect(result.discoveries).toEqual([]);
  });
});

it("keeps external tools only when DB reconciliation says active", async () => {
  const builtIn = {
    id: "settings",
    name: "Settings",
    version: "1",
    publisher: "Jarv1s",
    lifecycle: "required" as const,
    compatibility: { jarv1s: ">=0" }
  };
  const external = { ...builtIn, id: "acme", name: "Acme", lifecycle: "optional" as const };
  const resolver = createExternalActiveModulesResolver(
    async () => [builtIn, external],
    new Set([external.id]),
    async () => [{ id: "acme" }]
  );
  await expect(resolver("actor")).resolves.toEqual([builtIn, external]);
  const disabled = createExternalActiveModulesResolver(
    async () => [builtIn, external],
    new Set([external.id]),
    async () => []
  );
  await expect(disabled("actor")).resolves.toEqual([builtIn]);
});
