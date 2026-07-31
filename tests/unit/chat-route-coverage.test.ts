/**
 * Every route the chat module registers must be claimed by its own manifest `routes[]` or by
 * the platform allowlist.
 *
 * This exists because #1284 added `POST /api/chat/seed` to live-routes.ts and never added it to
 * the manifest. Nothing failed: unit tests do not stand the server up, so the whole suite stayed
 * green while `assertRouteCoverage` (apps/api/src/server.ts) threw at BOOT and took down every
 * integration test that calls createApiServer(). A route-registration change is a unit-sized
 * change, so it needs a unit-sized guard — one that runs without a database.
 *
 * The check uses the production `routeKey`/`PLATFORM_UNGUARDED_ROUTES` rather than restating the
 * rule, so it cannot drift from what the boot assertion actually enforces.
 */
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

import { registerChatLiveRoutes } from "../../packages/chat/src/live-routes.js";
import { PageContextStore } from "../../packages/chat/src/live/page-context-store.js";
import { chatModuleManifest } from "../../packages/chat/src/manifest.js";
import {
  PLATFORM_UNGUARDED_ROUTES,
  routeKey
} from "../../packages/module-registry/src/route-guard.js";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

/** Collect what Fastify actually registered, via onRoute — not a hand-kept list that would go
 *  stale exactly when a new route is added, which is the failure being guarded against. */
async function registeredLiveRouteKeys(): Promise<Set<string>> {
  const app = Fastify({ logger: false });
  const keys = new Set<string>();
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) keys.add(routeKey(method, route.url));
  });

  registerChatLiveRoutes(app, {
    resolveAccessContext: async () => ({ actorUserId: ACTOR_ID, requestId: "test-request" }),
    // Cast: the routes are never invoked here — only registered — so a structural fake that
    // satisfies the registrar's shape is enough (same pattern as chat-seed-route.test.ts).
    runtime: {
      manager: { seedContext: vi.fn() },
      resolveUserName: async () => "Test User"
    } as never,
    pageContextStore: new PageContextStore({ now: () => Date.now(), ttlMs: 300_000 })
  });

  await app.ready();
  await app.close();
  return keys;
}

describe("chat module route coverage", () => {
  it("declares every live route it registers in its manifest", async () => {
    const registered = await registeredLiveRouteKeys();
    const declared = new Set(
      chatModuleManifest.routes.map((route) => routeKey(route.method, route.path))
    );

    const unclaimed = [...registered]
      .filter((key) => !declared.has(key) && !PLATFORM_UNGUARDED_ROUTES.has(key))
      .sort();

    // Named in the message so a failure says which route to add, not just that a count differs.
    expect(unclaimed).toEqual([]);
  });

  it("claims the generic seed route specifically", async () => {
    // The regression that motivated this file. Asserted by name so that deleting the manifest
    // entry fails loudly even if the sweep above is ever weakened.
    const declared = new Set(
      chatModuleManifest.routes.map((route) => routeKey(route.method, route.path))
    );
    expect(declared.has(routeKey("POST", "/api/chat/seed"))).toBe(true);

    const registered = await registeredLiveRouteKeys();
    expect(registered.has(routeKey("POST", "/api/chat/seed"))).toBe(true);
  });
});
