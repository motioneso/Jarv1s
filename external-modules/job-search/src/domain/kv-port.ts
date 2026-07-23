// #1232: user-scoped KV is the phase-1 Job Search data plane.
export interface JobSearchKv {
  get(namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(namespace: string, key: string, value: Record<string, unknown>): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<readonly string[]>;
}

export const NS = {
  profiles: "job-search.profiles",
  resume: "job-search.resume",
  sources: "job-search.sources",
  candidates: "job-search.candidates",
  matches: "job-search.matches",
  feedback: "job-search.feedback",
  settings: "job-search.settings",
  meta: "job-search.meta"
} as const;

export const RESET_MARKER_KEY = "resetDone";

export type JobSearchNamespace = (typeof NS)[keyof typeof NS];

interface UserScopedWorkerKv {
  get(scope: "user", namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(scope: "user", namespace: string, key: string, value: Record<string, unknown>): Promise<void>;
  delete(scope: "user", namespace: string, key: string): Promise<boolean>;
  list(scope: "user", namespace: string): Promise<readonly string[]>;
}

export function kvFromWorkerContext(kv: UserScopedWorkerKv): JobSearchKv {
  return {
    get: (namespace, key) => kv.get("user", namespace, key),
    set: (namespace, key, value) => kv.set("user", namespace, key, value),
    delete: (namespace, key) => kv.delete("user", namespace, key),
    list: (namespace) => kv.list("user", namespace)
  };
}
