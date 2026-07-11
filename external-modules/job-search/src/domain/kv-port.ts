// external-modules/job-search/src/domain/kv-port.ts
//
// JS-02 (#931): narrow KV port the whole domain layer is written against.
// Structural subset of ModuleWorkerContext["kv"] with the scope pinned to
// "user" — domain code cannot reach instance scope, other namespaces are
// rejected by the host (undeclared-namespace fail-closed, JS-01), and no
// @jarv1s/* import is needed, keeping the domain bundler-independent.

export interface JobSearchKv {
  get(namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(namespace: string, key: string, value: Record<string, unknown>): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<readonly string[]>;
}

// The seven user-scoped namespaces declared by jarvis.module.json — the
// manifest is authoritative (coordinator ruling 2026-07-11: `job-search.*`,
// not the module-design doc's `jarv1s.job-search.*`).
export const NS = {
  onboarding: "job-search.onboarding",
  profile: "job-search.profile",
  resume: "job-search.resume",
  monitors: "job-search.monitors",
  opportunities: "job-search.opportunities",
  runs: "job-search.runs",
  feed: "job-search.feed"
} as const;

export type JobSearchNamespace = (typeof NS)[keyof typeof NS];

// Structural mirror of ModuleWorkerContext["kv"] — intentionally NOT an SDK
// import (see header). The real ctx.kv (scope: "instance" | "user") is
// assignable because each method accepts a superset of "user".
interface UserScopedWorkerKv {
  get(scope: "user", namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(scope: "user", namespace: string, key: string, value: Record<string, unknown>): Promise<void>;
  delete(scope: "user", namespace: string, key: string): Promise<boolean>;
  list(scope: "user", namespace: string): Promise<readonly string[]>;
}

/** Adapt a worker context's kv to the domain port, pinning scope to "user". */
export function kvFromWorkerContext(kv: UserScopedWorkerKv): JobSearchKv {
  return {
    get: (namespace, key) => kv.get("user", namespace, key),
    set: (namespace, key, value) => kv.set("user", namespace, key, value),
    delete: (namespace, key) => kv.delete("user", namespace, key),
    list: (namespace) => kv.list("user", namespace)
  };
}
