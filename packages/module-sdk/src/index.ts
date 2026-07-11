export {
  HttpError,
  handleRouteError,
  type RouteErrorMapper,
  type HandleRouteErrorOptions
} from "./route-errors.js";

export { sessionRateLimitKey, mcpSessionRateLimitKey } from "./rate-limit-key.js";

export { CORE_VERSION, compareJarvisVersions, satisfiesCoreVersion } from "./core-version.js";

export { createModuleLogger } from "./logger.js";

export type ModuleLifecycle = "required" | "optional" | "user-toggleable" | "workspace-toggleable";
export type ModuleScope = "user" | "admin" | "system";
export type ModulePermissionAction = "view" | "create" | "update" | "delete" | "manage" | "execute";
export type ModuleAssistantToolRisk = "read" | "write" | "destructive";
export type ModuleAssistantToolExecutionPolicy = "auto" | "confirm";
export type JarvisActionPermissionTier = "ask_each_time" | "trusted_auto" | "always_confirm";

export interface ModuleAssistantActionFamilyManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly defaultTier: "ask_each_time" | "always_confirm";
  readonly allowedTiers: readonly JarvisActionPermissionTier[];
}

export interface JsonSchema {
  readonly [key: string]: unknown;
}

export type ToolInput = Record<string, unknown>;

export interface ToolContext {
  readonly actorUserId: string;
  readonly requestId: string;
  readonly chatSessionId: string;
  /** IANA timezone string from the user's locale settings (e.g. "America/Chicago"). Absent when the gateway has no locale available (falls back to UTC at call site). */
  readonly localTimezone?: string;
}

export interface ToolResult {
  readonly data: Record<string, unknown>;
  readonly columnOrder?: readonly string[];
}

/**
 * Opaque per-call service registry handed to a tool's execute by the gateway. Keyed by
 * service name (e.g. "calendarWrite"); values are typed `unknown` to keep module-sdk free
 * of any module dependency (same reason scopedDb is `unknown`). The owning module narrows
 * the value it requested via its own type. Constructed by the composition host, never by a
 * module. The gateway treats it as opaque and never inspects its contents.
 */
export type ToolServices = Readonly<Record<string, unknown>>;

/**
 * Execution handler for an assistant tool. `scopedDb` is a DataContextDb supplied
 * by the gateway under withDataContext; it is typed as `unknown` here to avoid a
 * module-sdk -> db dependency. The owning module narrows it via its own repository.
 * `services` is an optional composition-layer-constructed capability registry (see
 * ToolServices); a tool that needs no service simply omits the 4th parameter.
 * Called ONLY when authorized (read allowed, or write/destructive approved); input
 * is already validated against inputSchema.
 */
export type ToolExecute = (
  scopedDb: unknown,
  input: ToolInput,
  ctx: ToolContext,
  services?: ToolServices
) => Promise<ToolResult>;

/** Optional human-readable description of a proposed write, for the Approve/Deny card. */
export type ToolSummarize = (input: ToolInput, ctx: ToolContext) => string;

/**
 * Optional per-call override for the run/confirm decision. When it returns true for a given
 * call's input, the gateway treats that call as always-confirm — equivalent to `risk:
 * "destructive"` — even if the tool's `actionFamilyId` has been promoted to `trusted_auto`.
 * Use this when a tool's risk is input-shaped: most calls are an ordinary write (safe to
 * auto-run once trusted), but a particular input combination is actually destructive (e.g.
 * `notes.create` with `overwrite: true`, which replaces existing content). Tools with `risk:
 * "destructive"` already always confirm and don't need this; a `risk: "read"` tool ignores it
 * (reads never confirm).
 */
export type ToolRequiresConfirmation = (input: ToolInput) => boolean;

/**
 * Rich, server-derived preview of a proposed write for the Approve/Deny card. Unlike the
 * persisted `inputSummary` (key-names only), this is computed under the actor's DataContextDb
 * from owner-visible cached state and rides the live SSE stream ONLY — it is never persisted
 * to the action_request row, audit log, job payload, export, or prompt. The email reply tools
 * use it to show the derived recipient/subject and the composed body on the card without ever
 * writing the body to durable storage (spec §5 / metadata-only persistence).
 */
export interface ActionRequestPreview {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

/**
 * Optional async producer of an ActionRequestPreview. Called by the gateway inside
 * `withDataContext` at card-creation time (only for a tool that declares it), so it can look
 * up owner-visible cached state to derive the preview. `scopedDb` is a DataContextDb typed
 * `unknown` (same reason as ToolExecute — no module-sdk -> db dependency); the owning module
 * narrows it. Returning `undefined` (or throwing — the gateway guards) means "no preview": the
 * card still renders from the summary. It must never throw sensitive detail; it returns only
 * the secret-free preview shape.
 */
export type ToolPreview = (
  scopedDb: unknown,
  input: ToolInput,
  ctx: ToolContext,
  services?: ToolServices
) => Promise<ActionRequestPreview | undefined>;

/** A normalized readiness/energy signal contributed by ANY module to the focus path. */
export interface FocusSignal {
  /** Stable id of the contributing module, e.g. "wellness". */
  readonly moduleId: string;
  /** Normalized readiness in [0,1]; 1 = fully ready/energized, 0 = depleted. */
  readonly readiness: number;
  /** Short, non-sensitive human label, e.g. "energy trended low". */
  readonly summary: string;
}

/**
 * A focus-signal provider. `scopedDb` is a DataContextDb supplied under withDataContext;
 * it is typed `unknown` to avoid a module-sdk -> db dependency (the owning module narrows
 * it via assertDataContextDb, exactly like ToolExecute). Returns null = no signal for this
 * actor (e.g. no recent data).
 */
export type FocusSignalProvider = (
  scopedDb: unknown,
  ctx: { readonly actorUserId: string; readonly requestId: string }
) => Promise<FocusSignal | null>;

export interface RegisteredFocusSignal {
  readonly moduleId: string;
  readonly provider: FocusSignalProvider;
}

export interface ProactiveMonitorPriorityAnchor {
  readonly label: string;
  readonly aliases: readonly string[];
}

export interface ProactiveMonitorInput {
  readonly ownerUserId: string;
  readonly sinceCursor: unknown;
  readonly now: string;
  readonly timeZone: string;
  readonly maxSignals: number;
  readonly priorityAnchors: readonly ProactiveMonitorPriorityAnchor[];
}

export interface ProactiveMonitorSignal {
  /** Deterministic for the material source event; contains no raw private ids. */
  readonly source: string;
  readonly stableKey: string;
  /** Hash of source-local ids, never the raw id. */
  readonly sourceRefHash: string;
  readonly signalType: string;
  readonly title: string;
  readonly summary: string;
  readonly occurredAt?: string;
  readonly targetAt?: string;
  readonly priorityCandidate: unknown;
  readonly expiresAt?: string;
}

export interface ProactiveMonitorResult {
  readonly signals: readonly ProactiveMonitorSignal[];
  readonly nextCursor: unknown;
}

/**
 * A proactive-monitor provider. `scopedDb` is a DataContextDb supplied under withDataContext;
 * typed `unknown` to avoid a module-sdk -> db dependency. The owning module narrows it via
 * assertDataContextDb. Providers may query ONLY their own module data.
 */
export interface ProactiveMonitorProvider {
  readonly source: string;
  readonly moduleId: string;
  collectSignals(scopedDb: unknown, input: ProactiveMonitorInput): Promise<ProactiveMonitorResult>;
}

export interface RegisteredProactiveMonitorProvider {
  readonly moduleId: string;
  readonly provider: ProactiveMonitorProvider;
}

export type PersonContextSource =
  | "email"
  | "calendar"
  | "chat"
  | "note"
  | "task"
  | "commitment"
  | "memory"
  | "manual";

export interface PersonContextSignal {
  readonly identityKind: "email_address" | "source_identity" | "alias" | "display_name";
  readonly displayValue: string;
  readonly normalizedValue: string;
  readonly sourceRef: string;
  readonly sourceRefHash: string;
  readonly sourceVersion: string;
  readonly linkKind:
    | "sender"
    | "recipient"
    | "attendee"
    | "mentioned"
    | "assigned"
    | "counterparty"
    | "related";
  readonly sourceLabel?: string;
  readonly summary?: string;
  readonly occurredAt?: Date;
  readonly confidence: number;
  readonly provenance: "source" | "inferred" | "user_confirmed" | "imported";
}

export interface PersonContextSignalBatch {
  readonly signals: PersonContextSignal[];
  readonly nextCursor?: string;
}

export interface PersonContextProviderInput {
  readonly actorUserId: string;
  readonly sourceRefHash: string;
  readonly sourceVersion?: string;
  readonly cursor?: string;
}

export interface PersonContextProvider {
  readonly sourceKind: PersonContextSource;
  collectPersonSignals(input: PersonContextProviderInput): Promise<PersonContextSignalBatch>;
}

/** Sanitized observability hook for a failed/dropped provider. */
export interface FocusSignalAggregateOptions {
  /**
   * Called when a provider throws or returns a malformed value. Receives ONLY the contributing
   * moduleId + the error's name (never the error message, stack, or any payload/health data) —
   * so a readiness outage is observable without leaking sensitive content (Codex R1).
   */
  readonly onProviderError?: (moduleId: string, errorName: string) => void;
}

/**
 * Runs a single provider's work inside a FRESH, per-provider data context. The composition
 * root supplies this (wrapping `DataContextRunner.withDataContext`) so module-sdk stays free
 * of a `@jarv1s/db` dependency. Each provider MUST get its own context/transaction — see
 * aggregateFocusSignals for why a shared one is unsafe.
 */
export type FocusSignalContextRunner = <T>(work: (scopedDb: unknown) => Promise<T>) => Promise<T>;

/**
 * Run every registered provider for an actor and collect the non-null signals. Generic and
 * uniform: it knows nothing about any specific module. A provider that throws or returns a
 * malformed value is treated as "no signal" (fail soft — focus must never break), but the
 * drop is reported via `onProviderError` (sanitized) so outages are not silent.
 *
 * CONCURRENCY/ISOLATION: each provider runs in its OWN data context via `runInContext` (a
 * fresh withDataContext → fresh transaction → fresh pg connection). This is load-bearing,
 * not cosmetic: a single shared Kysely transaction is ONE pg client, so (a) "concurrent"
 * provider queries would serialize on that one connection — no real parallelism — and (b)
 * any provider whose query aborts the transaction (Postgres 25P02) would poison every OTHER
 * provider's queries on the same connection, turning one provider's failure into a total
 * focus outage and defeating the fail-soft guarantee above. Separate contexts make the
 * fail-soft real and let the providers genuinely run in parallel.
 */
const FOCUS_SIGNAL_PROVIDER_TIMEOUT_MS = 250;

export async function aggregateFocusSignals(
  providers: readonly RegisteredFocusSignal[],
  runInContext: FocusSignalContextRunner,
  ctx: { readonly actorUserId: string; readonly requestId: string },
  options: FocusSignalAggregateOptions = {}
): Promise<FocusSignal[]> {
  const results = await Promise.all(
    providers.map(async ({ moduleId, provider }) => {
      try {
        // Each provider gets its OWN context/transaction: one provider aborting its txn
        // (25P02) cannot poison another, and they do not serialize on one pg connection.
        // Race against a 250ms deadline: a stalled provider must not block the focus path.
        const providerTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => {
            const err = new Error(
              `FocusSignalProvider timed out after ${FOCUS_SIGNAL_PROVIDER_TIMEOUT_MS}ms`
            );
            err.name = "ProviderTimeout";
            reject(err);
          }, FOCUS_SIGNAL_PROVIDER_TIMEOUT_MS)
        );
        const signal = await Promise.race([
          runInContext((scopedDb) => provider(scopedDb, ctx)),
          providerTimeout
        ]);
        if (
          signal &&
          typeof signal.moduleId === "string" &&
          typeof signal.readiness === "number" &&
          Number.isFinite(signal.readiness) &&
          typeof signal.summary === "string"
        ) {
          return {
            moduleId: signal.moduleId,
            readiness: Math.min(1, Math.max(0, signal.readiness)),
            summary: signal.summary
          } satisfies FocusSignal;
        }
        // Non-null but malformed → treat as a provider error (observability).
        if (signal !== null) options.onProviderError?.(moduleId, "MalformedFocusSignal");
        return null;
      } catch (error) {
        const name = error instanceof Error ? error.name : "UnknownError";
        options.onProviderError?.(moduleId, name);
        return null;
      }
    })
  );
  return results.filter((s): s is FocusSignal => s !== null);
}

export interface ModuleCompatibility {
  readonly jarv1s: string;
}

export interface ModuleAvailabilityManifest {
  readonly defaultEnabled: boolean;
  readonly required?: boolean;
  readonly supportsUserDisable?: boolean;
  readonly supportsWorkspaceDisable?: boolean;
  readonly featureFlagId?: string;
}

export interface ModuleDatabaseManifest {
  readonly migrations: readonly string[];
  readonly migrationDirectories?: readonly string[];
  readonly ownedTables: readonly string[];
}

export interface ModuleRouteManifest {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly requestSchema?: JsonSchema;
  readonly responseSchema?: JsonSchema;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
}

export interface ModuleJobManifest {
  readonly queueName: string;
  readonly payloadSchema?: JsonSchema;
  readonly metadataOnly?: boolean;
  readonly permissionId?: string;
}

export interface ModuleShareableResourceManifest {
  readonly resourceType: string;
  readonly grantLevels: readonly ("view" | "contribute" | "manage")[];
}

export interface ModulePermissionManifest {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly scope: ModuleScope;
  readonly actions: readonly ModulePermissionAction[];
}

export interface ModuleFeatureFlagManifest {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly scope: ModuleScope;
  readonly defaultEnabled: boolean;
}

export interface ModuleNotificationManifest {
  readonly supported: true;
}

export interface ModuleNavigationEntryManifest {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: string;
  readonly order?: number;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
}

export interface ModuleSettingsSurfaceManifest {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly scope: ModuleScope;
  readonly order?: number;
  readonly permissionId?: string;
  readonly featureFlagId?: string;
  readonly entry?: string;
}

/**
 * Default activation state for a source behavior:
 * - `default-on`: enabled unless the user opts out (toggleable).
 * - `default-off`: opt-in — disabled unless the user enables it (toggleable). No shipped manifest
 *   uses this yet; forward-compat for opt-in behaviors, exercised by source-behaviors.test.ts.
 * - `coming-soon`: shown but not yet available (not toggleable).
 *
 * Mirrored in @jarv1s/shared source-behaviors-api.ts — keep both in sync.
 */
export type SourceBehaviorDefault = "default-on" | "default-off" | "coming-soon";

/** One toggleable behavior Jarvis can perform with a source. */
export interface SourceBehaviorDecl {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly default: SourceBehaviorDefault;
}

/**
 * A data source and the behaviors Jarvis may perform with it. Source identity
 * (name/description) is declared once here and owns its behaviors — never repeated
 * on every behavior row, so the route layer never has to guess a source's identity.
 */
export interface SourceBehaviorSourceDecl {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly behaviors: readonly SourceBehaviorDecl[];
}

export interface ModuleAssistantToolManifest {
  readonly name: string;
  readonly description: string;
  readonly permissionId: string;
  readonly actionFamilyId?: string;
  readonly risk: ModuleAssistantToolRisk;
  readonly executionPolicy?: ModuleAssistantToolExecutionPolicy;
  readonly inputSchema?: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly featureFlagId?: string;
  readonly execute?: ToolExecute;
  readonly summarize?: ToolSummarize;
  /**
   * Optional per-call override of the run/confirm policy decision (see ToolRequiresConfirmation).
   * Forces "confirm" for calls where it returns true, regardless of actionFamilyId tier — the
   * write→trusted_auto auto-run path never applies to those calls.
   */
  readonly requiresConfirmation?: ToolRequiresConfirmation;
  /**
   * Optional async producer of a rich Approve/Deny card preview, derived server-side under the
   * actor's DataContextDb (see ToolPreview). The gateway calls it at card-creation time and
   * streams the result to the client; it is NEVER persisted (the durable row keeps the
   * key-names-only `inputSummary`). Used by the email reply tools to show the derived
   * recipient/subject + composed body without persisting the body.
   */
  readonly preview?: ToolPreview;
  /**
   * Names of composition-layer services this tool's execute requires in the 4th
   * `services` argument (e.g. ["calendarWrite"]). Declaration only — the module does
   * not construct the service. The composition host builds it and registers it on the
   * gateway's toolServices; a build-time/test assertion checks every declared key is present.
   */
  readonly requiresServices?: readonly string[];
  /**
   * When true, the tool output contains untrusted external content (e.g. web search snippets,
   * fetched page text) that should be wrapped in a `<tool_result>` trust boundary before
   * reaching the model. Internal tools whose output Jarvis controls must leave this unset.
   */
  readonly externalContent?: boolean;
}

export interface JarvisModuleManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly lifecycle: ModuleLifecycle;
  readonly compatibility: ModuleCompatibility;
  readonly availability?: ModuleAvailabilityManifest;
  readonly database?: ModuleDatabaseManifest;
  readonly navigation?: readonly ModuleNavigationEntryManifest[];
  readonly settings?: readonly ModuleSettingsSurfaceManifest[];
  readonly permissions?: readonly ModulePermissionManifest[];
  readonly featureFlags?: readonly ModuleFeatureFlagManifest[];
  readonly notifications?: ModuleNotificationManifest;
  readonly routes?: readonly ModuleRouteManifest[];
  readonly jobs?: readonly ModuleJobManifest[];
  readonly shareableResources?: readonly ModuleShareableResourceManifest[];
  readonly assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[];
  readonly assistantTools?: readonly ModuleAssistantToolManifest[];
  readonly sourceBehaviors?: readonly SourceBehaviorSourceDecl[];
  readonly focusSignal?: FocusSignalProvider;
  readonly proactiveMonitor?: ProactiveMonitorProvider;
  readonly personContextProvider?: PersonContextProvider;
  readonly dataLifecycle?: ModuleDataLifecycleManifest;
  readonly externalSources?: readonly ModuleExternalSourceManifest[];
}

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

export interface ExternalModuleWorkerDeclaration {
  readonly queues?: readonly ExternalModuleQueueDeclaration[];
  readonly schedules?: readonly ExternalModuleScheduleDeclaration[];
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

/** Context passed to a module's data-lifecycle hooks (export collect, etc.). */
export interface ModuleLifecycleContext {
  readonly actorUserId: string;
  readonly requestId: string;
}

/**
 * A module's contribution to full-account export and account deletion. See
 * docs/superpowers/specs/2026-07-04-module-data-lifecycle-ports.md for the design.
 */
export interface ModuleDataLifecycleManifest {
  readonly exportSections?: readonly ModuleExportSection[];
  readonly deletion: ModuleDeletionDecl;
}

export interface ModuleExportSection {
  /**
   * Top-level property name under the archive's `sections` object — e.g. "wellness".
   * The archive is nested; a section's collect() returns that exact nested object, so
   * the assembled archive stays deep-equal to today's hand-written output.
   */
  readonly key: string;
  readonly displayName: string;
  /**
   * Runs under the actor's own DataContextDb (RLS-scoped). `scopedDb` stays `unknown`
   * here — module-sdk has no @jarv1s/db dependency; modules narrow it via
   * assertDataContextDb, the established pattern for assistant tools. Returns the
   * JSON-serializable section object (nested sub-keys included).
   */
  readonly collect: (scopedDb: unknown, ctx: ModuleLifecycleContext) => Promise<unknown>;
}

export interface ModuleDeletionDecl {
  /** This slice: cascade-only. A "purge" strategy with an executable hook is deferred. */
  readonly strategy: "cascade";
  /** FK cascade chain to app.users, verified by an integration test (not the boot assertion). */
  readonly tables: readonly ModuleDeletionTable[];
}

export interface ModuleDeletionTable {
  /** e.g. "app.wellness_checkins" */
  readonly table: string;
  /**
   * SQL boolean predicate over $1::uuid (the target user id) for the deletion script's
   * before/after count sweep. Defaults to "owner_user_id = $1::uuid" — the shape most of
   * the script's current list uses. Tables scoped differently declare theirs explicitly,
   * e.g. "user_id = $1::uuid" or a join predicate.
   */
  readonly countPredicate?: string;
}

/** Boundary of text from a source that may contain commitments. */
export interface CommitmentTextBoundary {
  readonly sourceRef: string;
  readonly sourceVersion: number;
  readonly text: string;
  readonly occurredAt: string;
}

/** A single extracted commitment candidate returned by the AI extractor. */
export interface ExtractedCommitmentCandidate {
  readonly kind: "deadline" | "promise" | "obligation" | "intent";
  readonly title: string;
  readonly dueLocalDate: string | null;
  readonly counterpartyLabel: string | null;
  readonly evidenceExcerpt: string;
  readonly confidence: "high" | "medium" | "low";
}

/**
 * Implemented by source modules (chat, email, notes) to supply text boundaries
 * for commitment extraction. The Commitments module never imports source module
 * internals — it invokes only this interface.
 */
export interface CommitmentExtractionProvider {
  readonly sourceKind: "chat" | "email" | "notes";
  getTextBoundaries(
    scopedDb: unknown,
    actorUserId: string,
    since: Date | null
  ): Promise<CommitmentTextBoundary[]>;
}

/**
 * Validates that a resolution reference is real and owned by the actor before
 * it is stored on a candidate. Missing verifier → 503 (not 500).
 */
export interface CommitmentResolutionVerifier {
  verifyResolutionRef(
    scopedDb: unknown,
    actorUserId: string,
    resolutionRef: string
  ): Promise<{ readonly valid: boolean; readonly reason?: string }>;
}

export function renderToolResult(result: ToolResult): string {
  const { data, columnOrder } = result;
  const items = data.items;

  if (!isUniformFlatArray(items)) {
    return JSON.stringify(data, null, 2);
  }

  const columns = columnOrder
    ? [...columnOrder, ...Object.keys(items[0]!).filter((k) => !columnOrder.includes(k))]
    : Object.keys(items[0]!).sort();

  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = items.map(
    (row: Record<string, unknown>) => `| ${columns.map((c) => String(row[c] ?? "")).join(" | ")} |`
  );
  return [header, divider, ...rows].join("\n");
}

function isUniformFlatArray(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = Object.keys(value[0]).sort().join(",");
  return value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      Object.keys(item).sort().join(",") === keys &&
      Object.values(item).every((v) => typeof v !== "object" || v === null)
  );
}
