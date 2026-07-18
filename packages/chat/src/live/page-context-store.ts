/**
 * #1109 — TTL-backed, actor-keyed store of the current client-reported page view.
 *
 * Pivot from the per-turn push model (#679): instead of the client attaching a
 * page-context snapshot to every /api/chat/turn body and the server folding it into
 * that turn's prompt, the client PUTs its current view here on navigation/change and
 * an AI tool (chat.getCurrentView, Task 4) pulls it on demand. Wraps the existing
 * resolveCachedPageContext TTL policy (page-context.ts) rather than reimplementing
 * it — same 5-minute freshness rule, now keyed by actor instead of chat session.
 *
 * In-memory only: no DB table, no pg-boss payload. A view is ephemeral UI state, not
 * a record worth persisting, and never needs to survive a process restart.
 */
import type { PageContextSnapshotDto } from "@jarv1s/shared";

import {
  projectPageContextSnapshot,
  resolveCachedPageContext,
  type CachedPageContext
} from "./page-context.js";

export interface StoredCurrentView {
  readonly snapshot: PageContextSnapshotDto;
  readonly platform: "web";
}

export class PageContextStore {
  private readonly views = new Map<string, { cached: CachedPageContext; platform: "web" }>();

  constructor(private readonly options: { readonly now: () => number; readonly ttlMs: number }) {}

  /**
   * Re-projects `raw` through the same bounded-shape defense-in-depth as the old
   * per-turn path and, if valid, replaces the actor's stored view. Returns false
   * (and leaves the last valid view untouched) on malformed input — a bad PUT body
   * must never wipe a good cached view.
   */
  update(actorUserId: string, raw: unknown, platform: "web"): boolean {
    const snapshot = projectPageContextSnapshot(raw);
    if (!snapshot) return false;

    const { nextCached } = resolveCachedPageContext(
      undefined,
      snapshot,
      this.options.now(),
      this.options.ttlMs
    );
    if (!nextCached) return false;

    this.views.set(actorUserId, { cached: nextCached, platform });
    return true;
  }

  /** Returns the actor's current view, or undefined if none is stored or it has expired. */
  get(actorUserId: string): StoredCurrentView | undefined {
    const current = this.views.get(actorUserId);
    const { resolved, nextCached } = resolveCachedPageContext(
      current?.cached,
      undefined,
      this.options.now(),
      this.options.ttlMs
    );
    if (!resolved || !nextCached || !current) {
      this.views.delete(actorUserId);
      return undefined;
    }
    current.cached = nextCached;
    return { snapshot: resolved, platform: current.platform };
  }

  delete(actorUserId: string): void {
    this.views.delete(actorUserId);
  }
}
