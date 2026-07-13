/**
 * Unit test for resolveApiServerConfig MCP server URL source (v0.1.4 deploy fix).
 *
 * In the container deploy the CLI runs in a separate `cli-runner` container, so a
 * hardcoded `http://127.0.0.1:${PORT}/api/mcp` resolves to the cli-runner itself and the
 * MCP gateway is unreachable (Jarvis loads zero tools). The config must honor
 * `JARVIS_MCP_SERVER_URL` (compose default `http://api:3000/api/mcp`) when set, and keep
 * the loopback default for dev/non-container runs when it is unset.
 */
import { describe, expect, it } from "vitest";

import { resolveApiServerConfig } from "../../apps/api/src/server.js";

describe("resolveApiServerConfig MCP server URL", () => {
  it("honors JARVIS_MCP_SERVER_URL when set (container deploy), ignoring PORT", () => {
    const config = resolveApiServerConfig({
      PORT: "3000",
      JARVIS_MCP_SERVER_URL: "http://api:3000/api/mcp"
    } as NodeJS.ProcessEnv);

    expect(config.mcpServerUrl).toBe("http://api:3000/api/mcp");
  });

  it("falls back to the loopback URL with the configured PORT when env is unset (dev)", () => {
    const config = resolveApiServerConfig({ PORT: "4100" } as NodeJS.ProcessEnv);

    expect(config.mcpServerUrl).toBe("http://127.0.0.1:4100/api/mcp");
  });
});

describe("resolveApiServerConfig external modules dir (#996, #860)", () => {
  it("honors JARVIS_MODULES_DIR when set", () => {
    const config = resolveApiServerConfig({
      JARVIS_MODULES_DIR: "/srv/modules"
    } as NodeJS.ProcessEnv);
    expect(config.externalModulesDir).toBe("/srv/modules");
  });

  it("falls back to a resolved dev default when unset (never null)", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect(typeof config.externalModulesDir).toBe("string");
    expect(config.externalModulesDir.length).toBeGreaterThan(0);
  });

  it("no longer exposes enableExternalModules", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect((config as unknown as Record<string, unknown>).enableExternalModules).toBeUndefined();
  });
});
