// Split out of index.ts (file-size gate) — external/downloadable module ABI (#917/#918/#964/#1019
// dataset connector SDK). Re-exported from the barrel verbatim, so no consumer import path changes.
import type {
  JsonSchema,
  ModuleAssistantOnboardingManifest,
  ModuleAssistantToolRisk,
  ModuleCompatibility,
  ModuleLifecycle
} from "./index.js";

/**
 * Credential slot a module declares (#918 Slice 2). Values are stored
 * platform-side in app.module_credentials (AES-256-GCM at rest) and are
 * NOT readable by module code until Slice 3's ctx.auth.getCredential RPC.
 * `id` must be prefixed with the module id ("<moduleId>." + slug).
 */
export interface ModuleAuthDeclaration {
  readonly id: string;
  readonly displayName: string;
  readonly kind: "api-key";
  readonly scope: "instance" | "user";
}

/**
 * KV namespace a module declares (#918 Slice 2). Rows live platform-side in
 * app.module_kv; module code cannot read/write them until Slice 3's ctx.kv RPC.
 * `namespace` must be the module id or "<moduleId>.<slug>".
 */
export interface ModuleStorageDeclaration {
  readonly namespace: string;
  readonly scopes: readonly ("instance" | "user")[];
  /**
   * FIN-00 #1145: who may write instance-scoped rows from module handlers.
   * Default "admin" (today's behavior). "module" opts declared namespaces into
   * handler writes regardless of the acting user's admin status — part of what
   * the admin approves at enable time (manifest hash pins it).
   */
  readonly instanceWritePolicy?: "admin" | "module";
}

/**
 * Web contribution entry (#918 Slice 2). `entrypoint` is a package-relative
 * ESM file served via GET /api/modules/:moduleId/web/*; `contractVersion`
 * must equal the host's JARVIS_WEB_CONTRACT_VERSION or nothing mounts.
 */
export interface ModuleWebDeclaration {
  readonly entrypoint: string;
  readonly contractVersion: number;
}

export interface ModuleWorkerDeclaration {
  readonly workerEntrypoint: string;
  readonly workerContractVersion: 1;
}

export const MODULE_WORKER_CONTRACT_VERSION = 1 as const;

export type ModuleParamScalarSchema =
  | { readonly type: "uuid" | "identifier" | "timestamp" | "boolean" | "null" }
  | { readonly type: "integer" | "number"; readonly min: number; readonly max: number }
  | { readonly type: "enum"; readonly values: readonly string[] };

export type ModuleParamsSchema =
  | ModuleParamScalarSchema
  | { readonly type: "array"; readonly items: ModuleParamScalarSchema; readonly maxItems: number }
  | {
      readonly type: "object";
      readonly fields: Readonly<
        Record<
          string,
          | ModuleParamScalarSchema
          | {
              readonly type: "array";
              readonly items: ModuleParamScalarSchema;
              readonly maxItems: number;
            }
        >
      >;
    };

export interface ExternalModuleQueueDeclaration {
  readonly name: string;
  readonly handler: string;
  readonly paramsSchema?: ModuleParamsSchema;
  readonly retryLimit?: number;
  readonly deadLetterQueue?: string;
  readonly allowManualRun?: boolean;
}

export interface ExternalModuleScheduleDeclaration {
  readonly id: string;
  readonly cron: string;
  readonly tz?: string;
  readonly queue: string;
  readonly jobKind: string;
  readonly scope: "user";
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * #1166 (F6-D4): a job the platform enqueues ONCE PER ACTIVE USER every time
 * the module is reconciled (boot, enable, manifest change). For backfill /
 * repair work. Deliveries repeat across reconciles — handlers MUST be
 * idempotent (marker check); the singletonKey only dedups concurrent sends.
 */
export interface ExternalModuleReconcileJobDeclaration {
  readonly id: string;
  /** Must name one of this module's declared worker queues. */
  readonly queue: string;
  readonly jobKind: string;
}

export interface ExternalModuleWorkerDeclaration {
  readonly queues?: readonly ExternalModuleQueueDeclaration[];
  readonly schedules?: readonly ExternalModuleScheduleDeclaration[];
  readonly reconcileJobs?: readonly ExternalModuleReconcileJobDeclaration[];
}

export interface ModuleFetchRequest {
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly bodyBase64?: string;
}

export interface ModuleFetchResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyBase64: string;
}

export interface ExternalModuleAssistantToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly risk: ModuleAssistantToolRisk;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly handler: string;
}

/**
 * Database surface of a downloadable module (#964). Declaration only — the privileged
 * installer (scripts/module-install.ts) creates tables from the module's sql/ directory;
 * the manifest declares which app-schema table names the module owns so install, purge,
 * and registry capability display all key off one list. Validation (module-registry)
 * enforces the `app.<module_slug>_` prefix so no module can claim another's tables.
 */
export interface ExternalModuleDatabaseDeclaration {
  readonly ownedTables: readonly string[];
}

/**
 * A single nav-menu entry a downloadable module contributes (#1019). Narrower than the
 * built-in `ModuleNavigationEntryManifest` — deliberately omits `permissionId` /
 * `featureFlagId` (those gate built-in-only surfaces); an external module cannot declare
 * either through this ABI. `path` is module-relative; `serializeExternalModule`
 * (apps/api/src/server.ts) is the ONLY place that turns it into a real route by prefixing
 * it with `/m/<moduleId>`.
 */
export interface ExternalModuleNavigationEntry {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly order?: number;
}

/**
 * The JSON-serializable subset of {@link JarvisModuleManifest} that an EXTERNAL
 * (non-compiled) module ships as `jarvis.module.json` (#917). It deliberately omits
 * every function-valued or executable-surface field of the compiled manifest —
 * external modules contribute identity/compat metadata only in Slice 1. `auth` and
 * `storage` are declaration-only and REJECTED at load in this slice (see the
 * metadata-only invariant); they are typed here for forward compatibility.
 */
export interface JsonJarvisModuleManifest {
  /**
   * On-disk envelope contract version (#917, spec revision 2026-07-10 for PR #924). Slice 1
   * ships a FLAT metadata-only manifest with a single top-level `schemaVersion: 1`, validated
   * at load. The spec's nested `runtime.workerContractVersion` / optional `web.contractVersion`
   * are DEFERRED to Slices 2-3, where the worker and web-asset loaders that consume them first
   * exist — Slice 1 executes no worker and serves no web assets, so those fields would guard
   * nothing this slice. Bumping this integer is how a future incompatible on-disk shape is gated.
   */
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly description?: string;
  readonly lifecycle: ModuleLifecycle;
  readonly compatibility: ModuleCompatibility;
  readonly auth?: readonly ModuleAuthDeclaration[];
  readonly storage?: readonly ModuleStorageDeclaration[];
  readonly web?: ModuleWebDeclaration;
  readonly runtime?: ModuleWorkerDeclaration;
  readonly assistantTools?: readonly ExternalModuleAssistantToolDeclaration[];
  readonly worker?: ExternalModuleWorkerDeclaration;
  readonly fetchHosts?: readonly string[];
  readonly database?: ExternalModuleDatabaseDeclaration;
  /**
   * Nav-menu entries this module contributes (#1019). Optional — a metadata-only module
   * declares none and gets no nav entry, same as before this field existed. 1-4 entries,
   * validated positively in packages/module-registry/src/external/validate.ts.
   */
  readonly navigation?: readonly ExternalModuleNavigationEntry[];
  readonly assistantOnboarding?: ModuleAssistantOnboardingManifest;
}

/**
 * A validated external module package: its parsed metadata-only manifest plus the
 * two content hashes the platform trusts it by (#917). `manifestHash` is over the
 * canonical (sorted-key) manifest JSON; `packageHash` is over the whole package
 * (manifest + dist/worker.js + dist/web/**). Drift in `packageHash` from the value
 * recorded at admin-enable auto-disables the module.
 */
export interface ExternalJarvisModulePackage {
  readonly manifest: JsonJarvisModuleManifest;
  readonly manifestHash: string;
  readonly packageHash: string;
}

/**
 * Dataset connector SDK (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md).
 * A module declares external HTTP data sources it needs here; the `@jarv1s/datasets` runtime
 * host executes fetches under the declared constraints (host pinning, TTL caching, staleness
 * policy). Adapters never call global `fetch` directly — they receive a pinned `fetchFn` via
 * {@link ExternalSourceAdapterContext}.
 */
export type ModuleExternalSourceCredential = "none" | "api-key";

/**
 * Context an `ExternalSourceAdapter` receives per call. `fetchFn` is already host-pinned
 * (exact-hostname allowlist, https-only, redirect-hop re-validated) to the declaring source's
 * `fetchHosts` — adapters must use it instead of the global `fetch`. `apiKey` is present only
 * when the source declares `credential: "api-key"`; this slice rejects that credential at
 * registration, so it is always absent today (reserved for a future slice).
 */
export interface ExternalSourceAdapterContext {
  readonly fetchFn: typeof fetch;
  readonly apiKey?: string;
}

/**
 * The swappable per-source fetch contract. `datasetKey` selects one of the source's declared
 * `datasets`; `params` is the adapter-defined (and adapter-validated) request shape for that
 * dataset. Return value is opaque to the runtime — the module's own service layer owns typing.
 */
export interface ExternalSourceAdapter {
  fetchDataset(
    datasetKey: string,
    params: Record<string, unknown>,
    ctx: ExternalSourceAdapterContext
  ): Promise<unknown>;
}

export interface ModuleDatasetManifest {
  /** Unique within the declaring source, e.g. "scoreboard". */
  readonly key: string;
  readonly ttlMs: number;
  /**
   * "serve-stale-on-error" keeps a stale cache entry available for `staleRetentionMs` after
   * expiry so a fetch failure can still serve it (degraded); "degrade-empty" drops the entry at
   * TTL expiry and falls back to the caller-supplied fallback value on fetch failure.
   */
  readonly staleness: "serve-stale-on-error" | "degrade-empty";
  /** serve-stale-on-error only; defaults to 6 hours. */
  readonly staleRetentionMs?: number;
}

export interface ModuleExternalSourceManifest {
  /** Globally unique across every built-in module; asserted at registration. */
  readonly id: string;
  readonly displayName: string;
  /** OAuth is deliberately excluded (non-goal). "api-key" is reserved; registration rejects it. */
  readonly credential: ModuleExternalSourceCredential;
  /** Exact hostnames the adapter may hit. Lowercase, no port, no IP literal. */
  readonly fetchHosts: readonly string[];
  /** Aggregated into the web CSP img-src allowlist. */
  readonly imageHosts?: readonly string[];
  readonly datasets: readonly ModuleDatasetManifest[];
  /** Rate-courtesy minimum interval between fetches to this source, in ms. Defaults to none. */
  readonly minIntervalMs?: number;
}
