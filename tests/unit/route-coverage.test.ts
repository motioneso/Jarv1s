import { describe, expect, it } from "vitest";

import { getBuiltInModuleManifests } from "@jarv1s/module-registry";

function manifestPaths(id: string): { method: string; path: string }[] {
  const manifest = getBuiltInModuleManifests().find((m) => m.id === id);
  if (!manifest) throw new Error(`no manifest for ${id}`);
  return (manifest.routes ?? []).map((r) => ({ method: r.method, path: r.path }));
}

describe("manifest routes[] reconciliation", () => {
  it("tasks manifest declares preferences + subtasks + activity GET routes", () => {
    const paths = manifestPaths("tasks");
    expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/preferences" });
    expect(paths).toContainEqual({ method: "PATCH", path: "/api/tasks/preferences" });
    expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/:id/subtasks" });
    expect(paths).toContainEqual({ method: "GET", path: "/api/tasks/:id/activity" });
  });

  it("settings manifest declares source behavior routes", () => {
    const paths = manifestPaths("settings");
    expect(paths).toContainEqual({ method: "GET", path: "/api/me/source-behaviors" });
    expect(paths).toContainEqual({ method: "PUT", path: "/api/me/source-behaviors/:id" });
  });

  it("chat manifest declares every chat API route the routes module registers", () => {
    const paths = manifestPaths("chat");
    for (const expected of [
      { method: "POST", path: "/api/chat/turn" },
      { method: "GET", path: "/api/chat/stream" },
      { method: "POST", path: "/api/chat/clear" },
      { method: "POST", path: "/api/chat/switch" },
      { method: "GET", path: "/api/chat/threads" },
      { method: "GET", path: "/api/chat/memory/settings" },
      { method: "PATCH", path: "/api/chat/memory/settings" },
      { method: "GET", path: "/api/chat/memory/facts" },
      { method: "DELETE", path: "/api/chat/memory/facts/:id" },
      { method: "PATCH", path: "/api/chat/memory/facts/:id" },
      { method: "POST", path: "/api/chat/memory/facts/:id/confirm" },
      { method: "POST", path: "/api/chat/memory/facts/:id/reject" },
      { method: "POST", path: "/api/chat/action-requests/:id/resolve" },
      { method: "POST", path: "/api/mcp" }
    ]) {
      expect(paths).toContainEqual(expected);
    }
  });

  it("connectors manifest declares the Google OAuth POST routes", () => {
    const paths = manifestPaths("connectors");
    expect(paths).toContainEqual({ method: "POST", path: "/api/connectors/google/authorize" });
    expect(paths).toContainEqual({ method: "POST", path: "/api/connectors/google/complete" });
  });

  it("every manifest API route uses Fastify :param syntax (not {param})", () => {
    for (const manifest of getBuiltInModuleManifests()) {
      for (const route of manifest.routes ?? []) {
        expect(route.path).not.toMatch(/\{.*\}/);
      }
    }
  });
});
