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
  readonly routes?: readonly ModuleRouteManifest[];
  readonly jobs?: readonly ModuleJobManifest[];
  readonly shareableResources?: readonly ModuleShareableResourceManifest[];
  readonly assistantActionFamilies?: readonly ModuleAssistantActionFamilyManifest[];
  readonly assistantTools?: readonly ModuleAssistantToolManifest[];
  readonly sourceBehaviors?: readonly SourceBehaviorSourceDecl[];
  readonly focusSignal?: FocusSignalProvider;
  readonly proactiveMonitor?: ProactiveMonitorProvider;
  readonly personContextProvider?: PersonContextProvider;
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
