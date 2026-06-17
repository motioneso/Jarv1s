import { afterEach, describe, expect, it, vi } from "vitest";

const registerChatRoutes = vi.fn();

vi.mock("@jarv1s/chat", () => ({
  CHAT_QUEUE_DEFINITIONS: [],
  CliChatUnavailableError: class CliChatUnavailableError extends Error {},
  chatModuleManifest: {
    id: "chat",
    name: "Chat",
    version: "0.0.0",
    publisher: "test",
    lifecycle: "required",
    compatibility: { jarv1s: ">=0.0.0" },
    availability: { defaultEnabled: true }
  },
  chatModuleSqlMigrationDirectory: "mock-chat-sql",
  registerChatJobWorkers: vi.fn(),
  registerChatRoutes
}));

describe("module-registry chat MCP URL wiring", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    registerChatRoutes.mockClear();
  });

  it("passes the composition-root MCP server URL instead of reading PORT", async () => {
    vi.stubEnv("PORT", "9999");
    const { getBuiltInModuleRegistrations } = await import("@jarv1s/module-registry");
    const chatRegistration = getBuiltInModuleRegistrations().find(
      (registration) => registration.manifest.id === "chat"
    );

    chatRegistration?.registerRoutes?.({} as never, {
      boss: {} as never,
      dataContext: {} as never,
      focusSignals: undefined,
      listConfiguredAuthProviders: () => [],
      listModuleManifests: () => [],
      mcpServerUrl: "http://configured.example.test/api/mcp",
      resolveAccessContext: async () => ({ actorUserId: "user-1", requestId: "req-1" }),
      resolveActiveModules: async () => [],
      rootDb: {} as never
    });

    expect(registerChatRoutes).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        mcpServerUrl: "http://configured.example.test/api/mcp"
      })
    );
  });
});
