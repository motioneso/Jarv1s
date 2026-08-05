// external-modules/job-search/src/web/latch.ts
// Task 18 (#1302): the enqueue latch's storage, split out of root.tsx so
// tests/unit/job-search-web-root.test.tsx (plain node env, no DOM — Root needs no real
// document) can mock this one module instead of pulling in jsdom just for a single
// localStorage read/write. use-profiles.ts's own selectedId persistence stays inline since
// its test file already runs under jsdom (real document.hidden/visibilitychange).
export function latchKey(actorScopeKey: string, profileId: string): string {
  return `job-search:crawl-enqueued:${actorScopeKey}:${profileId}`;
}

export function isLatched(actorScopeKey: string, profileId: string): boolean {
  try {
    return window.localStorage.getItem(latchKey(actorScopeKey, profileId)) === "1";
  } catch {
    return false;
  }
}

export function setLatched(actorScopeKey: string, profileId: string): void {
  try {
    window.localStorage.setItem(latchKey(actorScopeKey, profileId), "1");
  } catch {
    // Storage unavailable (private mode, quota, no window) — worst case is a
    // duplicate manual crawl.run enqueue, which the queue's own singleton
    // dedupe absorbs (api.ts's "already-queued" outcome).
  }
}
