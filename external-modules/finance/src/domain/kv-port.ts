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

// The eight namespaces declared by jarvis.module.json — the manifest is
// authoritative. `settings` also carries instance scope in the manifest;
// this port only ever sees its user scope. `budgets` (FIN-03, #1148) holds
// `ledger:{month}` assignment ledgers (KV mode only — post-migration the
// store reads the module tables).
export const NS = {
  connections: "finance.connections",
  accounts: "finance.accounts",
  transactions: "finance.transactions",
  categories: "finance.categories",
  rules: "finance.rules",
  snapshots: "finance.snapshots",
  budgets: "finance.budgets",
  settings: "finance.settings",
  // FIN-06b (#1166 F6-D4): the storage-migrate marker namespace — separate
  // from settings so a future settings wipe/export can never touch it.
  meta: "finance.meta"
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

// ---------------------------------------------------------------------------
// FIN-04 (#1149): the household mirror port. `finance.shared` is the module's
// only instance-scoped writable namespace (instanceWritePolicy: "module");
// this port pins BOTH the scope and the namespace, so the mirror writer is
// structurally incapable of touching any other namespace — that construction
// is half of the "share handlers never read tokens/rules/budgets" guarantee
// (the throwing-port unit tests are the other half).

export const SHARED_NS = "finance.shared";

/** Keyed access to the `finance.shared` instance namespace, nothing else. */
export interface SharedMirrorKv {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(): Promise<readonly string[]>;
}

// Structural mirror of ModuleWorkerContext["kv"] with scope pinned to
// "instance" — same not-an-SDK-import rationale as UserScopedWorkerKv above.
interface InstanceScopedWorkerKv {
  get(scope: "instance", namespace: string, key: string): Promise<Record<string, unknown> | null>;
  set(
    scope: "instance",
    namespace: string,
    key: string,
    value: Record<string, unknown>
  ): Promise<void>;
  delete(scope: "instance", namespace: string, key: string): Promise<boolean>;
  list(scope: "instance", namespace: string): Promise<readonly string[]>;
}

/** Adapt a worker context's kv to the mirror port, pinning scope + namespace. */
export function mirrorFromWorkerContext(kv: InstanceScopedWorkerKv): SharedMirrorKv {
  return {
    get: (key) => kv.get("instance", SHARED_NS, key),
    set: (key, value) => kv.set("instance", SHARED_NS, key, value),
    delete: (key) => kv.delete("instance", SHARED_NS, key),
    list: () => kv.list("instance", SHARED_NS)
  };
}
