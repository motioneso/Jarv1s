import { describe, expect, it } from "vitest";
import { PageContextStore } from "../../packages/chat/src/live/page-context-store.js";
import type { PageContextSnapshotDto } from "../../packages/shared/src/index.js";

/**
 * #1109 — TTL-backed actor-keyed current-view store. Wraps the existing
 * resolveCachedPageContext TTL policy (packages/chat/src/live/page-context.ts) behind an
 * actor-keyed Map so PUT /api/chat/page-context can stash a snapshot and the pull-based
 * chat.getCurrentView tool (Task 4) can read it back. Ports the TTL-expiry cases from the
 * now-deleted tests/unit/chat-session-manager-page-context.test.ts (#679).
 */

function snapshot(overrides: Partial<PageContextSnapshotDto> = {}): PageContextSnapshotDto {
  return {
    route: "/news",
    pageTitle: "News",
    headings: [],
    buttons: [],
    labels: [],
    visibleText: ["Unavailable"],
    focused: null,
    selectedText: null,
    errors: [],
    capturedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  };
}

describe("PageContextStore (#1109)", () => {
  it("stores a projected actor view and isolates it from other actors", () => {
    const now = 1000;
    const store = new PageContextStore({ now: () => now, ttlMs: 300_000 });

    expect(store.update("actor-a", snapshot(), "web")).toBe(true);

    expect(store.get("actor-a")).toMatchObject({ snapshot: { route: "/news" }, platform: "web" });
    expect(store.get("actor-b")).toBeUndefined();
  });

  it("expires the stored view after the TTL (5 minutes)", () => {
    let now = 0;
    const store = new PageContextStore({ now: () => now, ttlMs: 300_000 });

    store.update("actor-a", snapshot(), "web");
    now += 5 * 60_000 + 1;

    expect(store.get("actor-a")).toBeUndefined();
  });

  it("keeps the stored view when read just under the TTL", () => {
    let now = 0;
    const store = new PageContextStore({ now: () => now, ttlMs: 300_000 });

    store.update("actor-a", snapshot(), "web");
    now += 5 * 60_000 - 1;

    expect(store.get("actor-a")).toMatchObject({ snapshot: { route: "/news" } });
  });

  it("rejects malformed input without replacing the last valid view", () => {
    const store = new PageContextStore({ now: () => 0, ttlMs: 300_000 });

    store.update("actor-a", snapshot(), "web");
    expect(store.update("actor-a", { route: 123 }, "web")).toBe(false);

    expect(store.get("actor-a")).toMatchObject({ snapshot: { route: "/news" } });
  });

  it("delete() removes a stored view", () => {
    const store = new PageContextStore({ now: () => 0, ttlMs: 300_000 });

    store.update("actor-a", snapshot(), "web");
    store.delete("actor-a");

    expect(store.get("actor-a")).toBeUndefined();
  });
});
