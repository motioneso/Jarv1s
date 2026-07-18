// external-modules/finance/src/domain/kv-port.ts
//
// FIN-01 (#1146): narrow KV port the whole domain layer is written against —
// the job-search kv-port pattern verbatim. Structural subset of
// ModuleWorkerContext["kv"] with the scope pinned to "user": domain code
// cannot reach instance scope (the instance `finance.settings` key is read
// through the separate InstanceSettingsPort wired in the composition root),
// undeclared namespaces are rejected by the host fail-closed, and no
// @jarv1s/* import is needed, keeping the domain bundler-independent.
//
// SECRET BOUNDARY: none of these namespaces may ever hold Plaid access
// tokens — tokens live only in app.module_credentials via ctx.auth
// (user slot finance.plaid-tokens).

export interface FinanceKv {
  get(namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(namespace: string, key: string, value: Record<string, unknown>): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  list(namespace: string): Promise<readonly string[]>;
}

// The seven namespaces declared by jarvis.module.json — the manifest is
// authoritative. `settings` also carries instance scope in the manifest;
// this port only ever sees its user scope.
export const NS = {
  connections: "finance.connections",
  accounts: "finance.accounts",
  transactions: "finance.transactions",
  categories: "finance.categories",
  rules: "finance.rules",
  snapshots: "finance.snapshots",
  settings: "finance.settings"
} as const;

export type FinanceNamespace = (typeof NS)[keyof typeof NS];

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
export function kvFromWorkerContext(kv: UserScopedWorkerKv): FinanceKv {
  return {
    get: (namespace, key) => kv.get("user", namespace, key),
    set: (namespace, key, value) => kv.set("user", namespace, key, value),
    delete: (namespace, key) => kv.delete("user", namespace, key),
    list: (namespace) => kv.list("user", namespace)
  };
}
