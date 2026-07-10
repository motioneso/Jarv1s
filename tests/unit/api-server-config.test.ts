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

describe("resolveApiServerConfig external-module flags (#917)", () => {
  it("enables external modules only when the flag is exactly '1' and a dir is set", () => {
    const config = resolveApiServerConfig({
      JARVIS_ENABLE_EXTERNAL_MODULES: "1",
      JARVIS_MODULES_DIR: "/srv/modules"
    } as NodeJS.ProcessEnv);
    expect(config.enableExternalModules).toBe(true);
    expect(config.externalModulesDir).toBe("/srv/modules");
  });

  it("treats any flag value other than '1' as disabled (fail-closed)", () => {
    for (const value of ["0", "true", "yes", "", undefined]) {
      const config = resolveApiServerConfig({
        JARVIS_ENABLE_EXTERNAL_MODULES: value,
        JARVIS_MODULES_DIR: "/srv/modules"
      } as NodeJS.ProcessEnv);
      expect(config.enableExternalModules).toBe(false);
    }
  });

  it("defaults the modules dir to null when unset", () => {
    const config = resolveApiServerConfig({} as NodeJS.ProcessEnv);
    expect(config.externalModulesDir).toBeNull();
  });
});
