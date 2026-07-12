import { createHash } from "node:crypto";

import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import {
  commitmentsModuleManifest,
  commitmentsModuleSqlMigrationDirectory,
  COMMITMENT_EXTRACTION_QUEUE,
  CommitmentsRepository
} from "@jarv1s/commitments";
import {
  peopleModuleManifest,
  peopleModuleSqlMigrationDirectory,
  PeopleNotesService,
  registerPeopleRoutes,
  registerPersonIndexWorker,
  registerSyncPersonMemoryWorker,
  PERSON_INDEX_QUEUE,
  SYNC_PERSON_MEMORY_QUEUE
} from "@jarv1s/people";
import { getVaultBaseDir, VaultContextRunner } from "@jarv1s/vault";
import { registerCommitmentsRoutes } from "@jarv1s/commitments/routes";
import { registerCommitmentExtractionWorker } from "@jarv1s/commitments/workers";
import {
  AI_QUEUE_DEFINITIONS,
  AiAutoRegisterService,
  AiRepository,
  aiModuleManifest,
  aiModuleSqlMigrationDirectory,
  createAiSecretCipher,
  generateStructured,
  registerAiMaintenanceWorkers,
  registerAiRoutes
} from "@jarv1s/ai";
import {
  GraphMemoryRecallService,
  ManualMemoryCandidateService,
  MemoryCandidatesRepository,
  MemoryGraphRepository,
  MemoryRepository,
  type MemoryRetriever,
  memoryModuleManifest,
  memorySqlMigrationDirectory,
  registerMemoryDashboardRoutes,
  registerMemoryGraphRoutes
} from "@jarv1s/memory";
import {
  PreferencesRepository,
  structuredStateModuleManifest,
  structuredStateSqlMigrationDirectory
} from "@jarv1s/structured-state";
import { isBehaviorEnabled, type SourceBehaviorPreferencesPort } from "@jarv1s/source-behaviors";
import {
  BRIEFINGS_QUEUE_DEFINITIONS,
  BriefingsRepository,
  briefingsModuleManifest,
  briefingsModuleSqlMigrationDirectory,
  createBriefingsFeedbackTargetVerifier,
  registerBriefingsJobWorkers,
  registerBriefingsRoutes,
  type ComposeDeps
} from "@jarv1s/briefings";
import {
  CalendarRepository,
  calendarFollowThroughSourceRef,
  isCalendarFollowThroughEvent,
  isCalendarFollowThroughTask,
  calendarModuleManifest,
  calendarModuleSqlMigrationDirectory,
  CALENDAR_QUEUE_DEFINITIONS,
  registerCalendarRoutes,
  registerCalendarJobWorkers
} from "@jarv1s/calendar";
import {
  CHAT_QUEUE_DEFINITIONS,
  chatModuleManifest,
  chatModuleSqlMigrationDirectory,
  CliChatUnavailableError,
  buildEveningInterviewSeed,
  buildCalendarWriteService,
  chatCommitmentProvider,
  ChatRepository,
  createChatFeedbackTargetVerifier,
  registerChatJobWorkers,
  registerChatRoutes,
  type ChatEngineFactory,
  type ChatRoutesDependencies,
  type RpcConnection
} from "@jarv1s/chat";
import {
  ConnectorsRepository,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  GOOGLE_SYNC_SWEEP_QUEUE_DEFINITIONS,
  GoogleEmailWriteProvider,
  IMAP_SYNC_QUEUE_DEFINITIONS,
  ImapEmailWriteProvider,
  MONITOR_QUEUE_DEFINITIONS,
  buildFeatureGrantService,
  buildRuntimeSourceContextService,
  connectorsModuleManifest,
  connectorsModuleSqlMigrationDirectory,
  createConnectorSecretCipher,
  getConnectorSyncAt,
  GoogleApiClient as RuntimeGoogleApiClient,
  GoogleConnectionService as RuntimeGoogleConnectionService,
  GoogleOAuthClient,
  registerConnectorsJobWorkers,
  registerConnectorsRoutes,
  registerGoogleSyncSweepWorker,
  registerImapSyncWorker,
  registerSourceMonitorWorkers,
  parseEmailSourceRef,
  type EmailTaskCreationPort,
  type GoogleApiClient,
  type GoogleConnectionService
} from "@jarv1s/connectors";
import type { ActiveModulesResolver } from "@jarv1s/ai";
import type { AccessContext, DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import { resolveTimeZone, type ProactiveSource } from "@jarv1s/shared";
import {
  emailModuleManifest,
  emailModuleSqlMigrationDirectory,
  EmailRepository,
  registerEmailRoutes
} from "@jarv1s/email";
import {
  assertMetadataOnlyPayload,
  FOUNDATION_QUEUES,
  registerDataContextWorker,
  type QueueDefinition
} from "@jarv1s/jobs";
import { createModuleLogger } from "@jarv1s/module-sdk";
import type {
  JarvisModuleManifest,
  RegisteredFocusSignal,
  RegisteredProactiveMonitorProvider
} from "@jarv1s/module-sdk";
import {
  NotificationsRepository,
  DIGEST_COMPOSE_QUEUE,
  type NotificationPreferencePort,
  runNotificationDigestCompose,
  notificationsModuleManifest,
  notificationsModuleSqlMigrationDirectory,
  registerNotificationsRoutes,
  type NotificationDigestSender
} from "@jarv1s/notifications";
import {
  type AuthProviderStatusDto,
  type ChatMultiplexerChoice,
  type OnboardingProviderCheckResponse,
  type OnboardingProviderKind
} from "@jarv1s/shared";
import {
  EXPORT_QUEUE_DEFINITIONS,
  createWebSearchSecretCipher,
  getWebSearchKeyConfig,
  readBraveSearchApiKey,
  registerSettingsJobWorkers,
  registerSettingsRoutes,
  registerRuntimeConfigRoutes,
  registerWebSearchKeyRoutes,
  settingsModuleManifest,
  settingsModuleSqlMigrationDirectory,
  SettingsRepository,
  type HostDiagnosticsProvider,
  type MeSessionsService,
  type PersonaPreviewInput,
  type ReconcileProactiveScheduleFn,
  type VerifySelfPasswordPort,
  type HasPasswordCredentialPort,
  type OnboardingInstallDependencies,
  type OnboardingLoginDependencies,
  type ExternalModulesDependencies,
  type ModuleDistributionDependencies
} from "@jarv1s/settings";
import {
  TASKS_QUEUE_DEFINITIONS,
  TasksRepository,
  registerTasksJobWorkers,
  registerTasksRoutes,
  TasksCompatibilityHelper,
  tasksModuleManifest,
  tasksModuleSqlMigrationDirectory,
  type EmailTriageFeedbackPort
} from "@jarv1s/tasks";
import {
  goalsModuleManifest,
  goalsModuleSqlMigrationDirectory,
  registerGoalsRoutes,
  registerGoalsMemorySyncWorker,
  registerGoalsMemorySyncReconcileWorker,
  GoalsRepository,
  GOALS_MEMORY_SYNC_QUEUE,
  GOALS_MEMORY_SYNC_RECONCILE_QUEUE
} from "@jarv1s/goals";
import {
  createHostRateLimiter,
  createRobotsGate,
  fetchWebResource,
  fetchWebResourceBytes,
  invalidateWebSearchProviderCache,
  resolveWebSearchProvider,
  setWebSearchKeyResolver,
  webModuleManifest
} from "@jarv1s/web-research";
import {
  registerWellnessRoutes,
  registerWellnessExportRoutes,
  registerWellnessExportWorkers,
  WELLNESS_EXPORT_QUEUE_DEFINITIONS,
  wellnessModuleManifest,
  wellnessModuleSqlMigrationDirectory
} from "@jarv1s/wellness";
import { registerWeatherRoutes, weatherModuleManifest } from "@jarv1s/weather";
import {
  configureSportsBriefingService,
  createEspnDatasetAdapter,
  registerSportsRoutes,
  sportsModuleManifest,
  sportsModuleSqlMigrationDirectory
} from "@jarv1s/sports";
import {
  configureNewsBriefingService,
  createRssDatasetAdapter,
  NEWS_QUEUE_DEFINITIONS,
  newsModuleManifest,
  newsModuleSqlMigrationDirectory,
  registerNewsJobWorkers,
  registerNewsRoutes
} from "@jarv1s/news";
import { assertValidFetchHosts, createDatasetClient } from "@jarv1s/datasets";
import {
  notesModuleManifest,
  notesCommitmentProvider,
  notesModuleSqlMigrationDirectory,
  NOTES_QUEUE_DEFINITIONS,
  reconcileNotesSchedule,
  registerNotesSyncRoutes,
  registerNotesJobWorkers
} from "@jarv1s/notes";
import {
  FeedbackTargetVerifierRegistry,
  registerUsefulnessFeedbackRoutes,
  usefulnessFeedbackModuleManifest,
  usefulnessFeedbackModuleSqlMigrationDirectory
} from "@jarv1s/usefulness-feedback";
import {
  CardRepository,
  makeProactiveCardVerifier,
  proactiveMonitoringModuleManifest,
  proactiveMonitoringSqlMigrationDirectory,
  PROACTIVE_SCAN_SOURCE_QUEUE,
  registerProactiveMonitoringRoutes,
  registerProactiveMonitoringWorkers,
  type ProactiveScanSourceJobPayload
} from "@jarv1s/proactive-monitoring";

import {
  createDefaultPersonaPreview,
  createRuntimeEmbeddingProvider,
  quietHoursPortImpl,
  runtimeMemoryRetriever,
  usefulnessFeedbackRepository
} from "./built-in-module-helpers.js";
import { assertModulesCompatible } from "./compat-gate.js";
import {
  makeCliPresentProbe,
  makeChatMultiplexerStatusProbe,
  makeProviderConnectionCheckProbe,
  resolveChatEngineFactory,
  type LiveChatMultiplexerStatus
} from "./chat-multiplexer.js";
import { buildOnboardingInstall } from "./onboarding-install.js";
import { buildOnboardingLogin } from "./onboarding-login.js";

// Declared here (not `apps/api/src/server.ts`, which sets it via an onRequest hook)
// because module-registry is the composition root every consumer of the field
// already reaches: apps/api sets `request.timeZone` and imports this package
// directly, and every built-in module that reads it (e.g. wellness's
// `resolveRouteTimeZone` via `resolveRequestTimeZoneForRoute` below) is wired
// through here. Ambient module augmentations only apply within the TS program
// they're compiled into, so keeping the declaration next to the file everyone
// already imports avoids "works in one tsc invocation, breaks in another" drift
// (#801 Phase A — apps/web's isolated `tsc` once reached wellness routes through
// a since-removed settings -> module-registry import edge and couldn't see the
// augmentation while it lived in server.ts).
declare module "fastify" {
  interface FastifyRequest {
    timeZone?: string;
  }
}

export type { ChatEngineFactory } from "@jarv1s/chat";
export type { JarvisModuleManifest } from "@jarv1s/module-sdk";
export { aggregateFocusSignals } from "@jarv1s/module-sdk";

export * from "./external/validate.js";
export * from "./external/types.js";
export * from "./external/reconcile.js";

export {
  createActiveModulesResolver,
  type ActiveModulesResolverDeps
} from "./active-modules-resolver.js";

export {
  PLATFORM_UNGUARDED_ROUTES,
  assertRouteCoverage,
  buildRouteModuleIndex,
  lookupModuleForRoute,
  registerRouteEnablementGuard,
  routeKey,
  type RegisteredRoute,
  type RouteGuardDeps,
  type RouteKey,
  type RouteModuleIndex
} from "./route-guard.js";

export interface BuiltInRouteDependencies {
  // Raw root handle forwarded to settings' BootstrapHelper (pre-session bootstrap status).
  // Documented Kysely< exemption — see packages/settings/src/bootstrap.ts. This is the
  // ONLY root-handle escape hatch in the route layer; module admin checks run through
  // DataContextDb (connectors' admin check was converted off appDb in Audit B3) — plus
  // the bounded pre-auth non-secret instance-config reads documented in
  // DEVELOPMENT_STANDARDS.md (registration gate + `chat.multiplexer` boot resolution).
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders: () => readonly AuthProviderStatusDto[];
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  /**
   * Async, actor-filtered resolver (the enablement SEAM). Used by the tool surfaces
   * (MCP gateway + AI REST tools) and the route guard. Distinct from
   * listModuleManifests (the full registered set used by briefings + /api/modules).
   */
  readonly resolveActiveModules: ActiveModulesResolver;
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  /**
   * Per-request, per-actor focus-signal aggregator. The composition root resolves the
   * actor's ACTIVE modules first, builds providers from them, then runs EACH provider in
   * its OWN withDataContext (fresh transaction → fresh pg connection) before aggregating —
   * so a disabled module contributes nothing AND one provider aborting its transaction
   * (25P02) cannot poison the others (fail-soft is real, not just declared). Tasks consumes
   * an opaque FocusSignal[].
   */
  readonly focusSignals?: (ctx: {
    readonly actorUserId: string;
    readonly requestId: string;
  }) => Promise<readonly { moduleId: string; readiness: number; summary: string }[]>;
  /** Resolved MCP endpoint advertised to CLI chat engines. Owned by API composition config. */
  readonly mcpServerUrl: string;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
  /**
   * #342 (§3.5 boot-time fork) — built by `registerBuiltInApiRoutes` only on the socket path
   * (JARVIS_CLI_RUNNER_SOCKET set) and forwarded to `registerChatRoutes`, where the chat runtime uses
   * it to select the RPC client (and fail-fast on a missing §6.6 secret), wire the §5.3 reconciliation
   * hook, and start the §5.5 idle reaper. Absent on the in-process / host-dev path (the late-bound
   * {@link chatEngineFactory} wrapper is used there instead, preserving admin `chat.multiplexer`
   * resolution).
   */
  readonly chatEngineSelection?: ChatRoutesDependencies["engineSelection"];
  /** Chat-owned passive graph recall seam; no module imports graph internals directly. */
  readonly passiveMemoryRecall?: ChatRoutesDependencies["passiveMemoryRecall"];
  /**
   * #342 (§3.4) — the ONE RPC connection to the cli-runner sidecar, when the api runs containerized
   * (JARVIS_CLI_RUNNER_SOCKET set). Owned by the chat runtime (it constructs the connection WITH the
   * §5.3 onReconcile hook + the idle reaper). The composition root adopts it for the onboarding probes
   * (§4.8 socket route) and the connect-on-boot / close-on-shutdown lifecycle. May be supplied here
   * directly, or published after route registration via {@link adoptChatRpcConnection}. Absent on the
   * in-process / host-dev path (no socket).
   */
  readonly chatRpcConnection?: RpcConnection;
  /**
   * #342 — set by `registerBuiltInApiRoutes` and consumed inside `registerChatRoutes` (the composition
   * seam): the chat runtime calls this to publish the ONE RPC connection it constructed back to the
   * probes + boot lifecycle, so a single socket serves both chat and onboarding (§3.4). No-op on the
   * in-process path.
   */
  readonly adoptChatRpcConnection?: (connection: RpcConnection) => void;
  readonly resolveEveningInterviewSeed?: ChatRoutesDependencies["resolveEveningInterviewSeed"];
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  /** Auth-owned current-user session list/revoke service (#237). */
  readonly meSessions?: MeSessionsService;
  /**
   * Auth-owned password re-verification for self-service account deletion (#239).
   * Absent when no auth runtime is wired; the route fails closed for
   * password-bearing accounts.
   */
  readonly verifySelfPassword?: VerifySelfPasswordPort;
  /**
   * Auth-owned existence probe (does the actor own a password credential?) for
   * GET /api/me + the self-delete dialog (migration 0045 revoked app_runtime
   * SELECT on auth_accounts).
   */
  readonly hasPasswordCredential?: HasPasswordCredentialPort;
  readonly bootstrapConnectionString?: string;
  readonly googleConnectionService?: GoogleConnectionService;
  readonly googleApiClient?: GoogleApiClient;
  readonly connectorsRepository?: ConnectorsRepository;
  /** Live multiplexer status probe for the admin settings UI (resolved fresh per request). */
  readonly getChatMultiplexerStatus?: (
    configured: ChatMultiplexerChoice
  ) => Promise<LiveChatMultiplexerStatus>;
  /** Host diagnostics runtime-facts provider (#255), built by the API composition root. */
  readonly hostDiagnostics?: HostDiagnosticsProvider;
  readonly personaPreview?: (input: PersonaPreviewInput) => Promise<string>;
  /**
   * Bounded, live onboarding probes (Phase 2). Built inside registerBuiltInApiRoutes (sync,
   * no boot-time probing) and forwarded to the settings module so it keeps no @jarv1s/ai /
   * @jarv1s/connectors PACKAGE dependency (module isolation). Each probes lazily, per request.
   */
  readonly onboardingProbes?: {
    readonly cliPresent: (kind: OnboardingProviderKind) => Promise<boolean>;
    readonly testProviderConnection: (
      kind: OnboardingProviderKind
    ) => Promise<OnboardingProviderCheckResponse>;
    readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
  };
  /**
   * #342 §A.5 install seam, built inside registerBuiltInApiRoutes on the socket path and forwarded
   * to the settings module (module isolation — settings never imports @jarv1s/chat / cli-runner).
   * Absent on the host-dev / in-process path ⇒ the install route fails closed (500).
   */
  readonly onboardingInstall?: OnboardingInstallDependencies;
  /**
   * #342 §L.5 login seam, built inside registerBuiltInApiRoutes on the socket path and forwarded to
   * the settings module (module isolation). Absent on the host-dev / in-process path ⇒ the login
   * routes fail closed (500).
   */
  readonly onboardingLogin?: OnboardingLoginDependencies;
  /**
   * #917 — boot-time external-module discovery snapshot, built by the API composition root
   * (apps/api discoverExternalModules) and forwarded to the settings module, where the Task 9
   * admin GET route reconciles it against app.external_modules. Absent ⇒ feature off. Optional
   * so every existing registerBuiltInApiRoutes call site keeps compiling unchanged.
   */
  readonly externalModules?: ExternalModulesDependencies;
  readonly moduleDistribution?: ModuleDistributionDependencies;
  readonly reconcileExternalModuleJobs?: (
    change:
      | { readonly kind: "module"; readonly moduleId: string }
      | { readonly kind: "user"; readonly userId: string }
  ) => Promise<void>;
  /** TEST-ONLY. Inject a fake fetch for weather (and any other external HTTP) without real network. */
  readonly fetchFn?: typeof fetch;
}

export interface BuiltInWorkerDependencies {
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly dataContext: DataContextRunner;
  readonly focusSignals?: BuiltInRouteDependencies["focusSignals"];
  /**
   * Structured logger for worker-path diagnostics. Production (apps/worker) passes
   * a pino root; tests omit it. Threaded into per-module worker registrations so
   * no `console.*` lands in production worker logs (observability spec #413).
   */
  readonly logger?: FastifyBaseLogger;
}

export interface BuiltInModuleRegistration {
  readonly manifest: JarvisModuleManifest;
  readonly sqlMigrationDirectories: readonly string[];
  readonly queueDefinitions: readonly QueueDefinition[];
  readonly registerRoutes?: (
    server: FastifyInstance,
    dependencies: BuiltInRouteDependencies
  ) => void;
  readonly registerWorkers?: (
    boss: PgBoss,
    dependencies: BuiltInWorkerDependencies
  ) => Promise<readonly string[]>;
}

const newsRobotsGate = createRobotsGate();
const newsHostRateLimiter = createHostRateLimiter();

function buildNewsDiscoveryPorts(logger?: Pick<FastifyBaseLogger, "info" | "warn">) {
  const repository = new AiRepository();
  const cipher = createAiSecretCipher();
  return {
    fetch: (url: string) =>
      fetchWebResource(url, {
        requireHttps: true,
        robots: newsRobotsGate,
        rateLimiter: newsHostRateLimiter
      }),
    image: (url: string, maxBytes: number) =>
      fetchWebResourceBytes(url, {
        requireHttps: true,
        robots: newsRobotsGate,
        rateLimiter: newsHostRateLimiter,
        maxBytes
      }),
    search: {
      async search(
        scopedDb: DataContextDb,
        query: string,
        options: { limit: number; freshness?: "day" | "week" }
      ) {
        const result = await (
          await resolveWebSearchProvider(scopedDb)
        ).search({
          query,
          ...options
        });
        return { results: [...result.results] };
      }
    },
    ai: {
      generateJson: (
        scopedDb: DataContextDb,
        input: {
          schema: Record<string, unknown>;
          prompt: string;
          maxOutputTokens?: number;
        }
      ) =>
        generateStructured(
          scopedDb,
          { service: "module.news", ...input },
          { repository, cipher, logger }
        ),
      async fingerprint(scopedDb: DataContextDb) {
        const model = (
          await repository.resolveModelForService(scopedDb, "module.news", {
            capability: "json",
            tierHint: "economy"
          })
        ).model;
        if (!model) return null;
        return createHash("sha256").update(`${model.provider_kind}\0${model.id}`).digest("hex");
      }
    }
  };
}

/** Recurring per-user/per-source scheduled check — at most every 30 minutes (spec §7). */
const PROACTIVE_CHECK_CRON = "*/30 * * * *";
export const PEOPLE_NOTES_SUGGEST_UPDATES_BEHAVIOR_ID = "people.notes.suggest-updates";

export function buildCalendarFollowThroughPort(
  deps: {
    readonly tasksRepository?: Pick<TasksRepository, "create">;
    readonly aiRepository?: Pick<AiRepository, "listActionPolicies">;
    readonly calendarWrite?: {
      proposeAndInsert(
        scopedDb: DataContextDb,
        ctx: {
          readonly actorUserId: string;
          readonly requestId: string;
          readonly chatSessionId: string;
        },
        window: {
          readonly start: Date;
          readonly end: Date;
          readonly durationMinutes: number;
          readonly title: string;
        },
        options: { readonly requireCacheMirror: true; readonly followThroughTargetRef: string }
      ): Promise<{ readonly created: boolean; readonly calendarEventId?: string }>;
    };
  } = {}
): NonNullable<ComposeDeps["calendarFollowThrough"]> {
  const tasksRepository = deps.tasksRepository ?? new TasksRepository();
  const aiRepository = deps.aiRepository ?? new AiRepository();
  const connectorsRepository = new ConnectorsRepository();
  const calendarRepository = new CalendarRepository();
  const calendarWrite =
    deps.calendarWrite ??
    buildCalendarWriteService({
      googleService: new RuntimeGoogleConnectionService({
        repository: connectorsRepository,
        cipher: createConnectorSecretCipher(),
        oauthClient: new GoogleOAuthClient()
      }),
      googleApiClient: new RuntimeGoogleApiClient(),
      connectorsRepository,
      calendarRepository
    });

  return {
    async executeAutoActions({ scopedDb, actorUserId, requestId, targetRef, signal }) {
      const refs: { targetRef: string; taskId?: string; calendarEventId?: string } = { targetRef };
      const sourceRef = calendarFollowThroughSourceRef(targetRef);

      if (signal.suggestedActions.includes("create_task")) {
        const task = await tasksRepository.create(scopedDb, {
          title: signal.summary,
          status: "todo",
          source: "calendar",
          sourceRef,
          externalKey: sourceRef
        });
        refs.taskId = task.id;
      }

      if (signal.suggestedActions.includes("block_time")) {
        const policies = await aiRepository.listActionPolicies(scopedDb);
        const writebackPolicy = policies.find(
          (policy) =>
            policy.moduleId === "calendar" && policy.actionFamilyId === "calendar_writeback"
        );
        if (writebackPolicy?.tier === "trusted_auto") {
          const window = calendarFollowThroughWindow(signal);
          if (window) {
            const result = await calendarWrite.proposeAndInsert(
              scopedDb,
              { actorUserId, requestId, chatSessionId: "" },
              window,
              { requireCacheMirror: true, followThroughTargetRef: targetRef }
            );
            if (result.created && result.calendarEventId) {
              refs.calendarEventId = result.calendarEventId;
            }
          }
        }
      }

      return refs;
    }
  };
}

export function buildCalendarFollowThroughSideEffects(
  deps: {
    readonly tasksRepository?: Pick<TasksRepository, "getById" | "update">;
    readonly calendarRepository?: Pick<CalendarRepository, "getById">;
    readonly calendarWrite?: {
      deleteEvent(
        scopedDb: DataContextDb,
        ctx: {
          readonly actorUserId: string;
          readonly requestId: string;
          readonly chatSessionId: string;
        },
        input: { readonly eventId: string }
      ): Promise<{ readonly deleted: boolean }>;
    };
  } = {}
) {
  const tasksRepository = deps.tasksRepository ?? new TasksRepository();
  const connectorsRepository = new ConnectorsRepository();
  const calendarRepository = deps.calendarRepository ?? new CalendarRepository();
  const calendarWrite =
    deps.calendarWrite ??
    buildCalendarWriteService({
      googleService: new RuntimeGoogleConnectionService({
        repository: connectorsRepository,
        cipher: createConnectorSecretCipher(),
        oauthClient: new GoogleOAuthClient()
      }),
      googleApiClient: new RuntimeGoogleApiClient(),
      connectorsRepository,
      calendarRepository: calendarRepository as CalendarRepository
    });

  return {
    async removeCreatedRefs(
      scopedDb: DataContextDb,
      actorUserId: string,
      metadata: Record<string, unknown>
    ): Promise<string | null> {
      const refs = readCalendarFollowThroughRefs(metadata);
      if (!refs) return null;
      const sourceRef = calendarFollowThroughSourceRef(refs.targetRef);
      const removed: string[] = [];

      if (refs.taskId) {
        const task = await tasksRepository.getById(scopedDb, refs.taskId);
        if (task && isCalendarFollowThroughTask(task, sourceRef)) {
          await tasksRepository.update(scopedDb, task.id, { status: "archived" });
          removed.push(`task:${task.id}`);
        }
      }

      if (refs.calendarEventId) {
        const event = await calendarRepository.getById(scopedDb, refs.calendarEventId);
        if (event && isCalendarFollowThroughEvent(event, refs.targetRef)) {
          const result = await calendarWrite.deleteEvent(
            scopedDb,
            { actorUserId, requestId: "feedback:calendar-follow-through", chatSessionId: "" },
            { eventId: event.id }
          );
          if (result.deleted) removed.push(`calendar_event:${event.id}`);
        }
      }

      return removed.length > 0 ? removed.join(",") : null;
    }
  };
}

function readCalendarFollowThroughRefs(metadata: Record<string, unknown>): {
  readonly targetRef: string;
  readonly taskId?: string;
  readonly calendarEventId?: string;
} | null {
  const raw = metadata.calendarFollowThrough;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.targetRef !== "string" || record.targetRef.length === 0) return null;
  const refs = {
    targetRef: record.targetRef,
    ...(typeof record.taskId === "string" ? { taskId: record.taskId } : {}),
    ...(typeof record.calendarEventId === "string"
      ? { calendarEventId: record.calendarEventId }
      : {})
  };
  return refs.taskId || refs.calendarEventId ? refs : null;
}

function calendarFollowThroughWindow(signal: {
  readonly type?: string;
  readonly summary: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
}): { start: Date; end: Date; durationMinutes: number; title: string } | null {
  const start = signal.startsAt ? new Date(signal.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const end = signal.endsAt ? new Date(signal.endsAt) : null;
  if (signal.type === "prep_needed") {
    const prepEnd = start;
    const prepStart = new Date(prepEnd.getTime() - 60 * 60_000);
    return { start: prepStart, end: prepEnd, durationMinutes: 60, title: "Prep time" };
  }
  if (!end || Number.isNaN(end.getTime()) || end <= start) return null;
  const durationMinutes = Math.min(
    120,
    Math.max(15, Math.floor((end.getTime() - start.getTime()) / 60_000))
  );
  return { start, end, durationMinutes, title: "Focus time" };
}

export function isPeopleNotesSuggestUpdatesEnabled(
  scopedDb: DataContextDb,
  preferencesRepository: SourceBehaviorPreferencesPort = new PreferencesRepository()
): Promise<boolean> {
  return isBehaviorEnabled(
    scopedDb,
    { manifests: getBuiltInModuleManifests(), preferencesRepository },
    PEOPLE_NOTES_SUGGEST_UPDATES_BEHAVIOR_ID
  );
}

export function createNotificationPreferencePort(
  preferencesRepository = new PreferencesRepository()
): NotificationPreferencePort {
  return {
    async isModuleEnabled(scopedDb, moduleId) {
      const raw = await preferencesRepository.get(scopedDb, `notifications:${moduleId}`);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
      const enabled = (raw as { enabled?: unknown }).enabled;
      return typeof enabled === "boolean" ? enabled : true;
    }
  };
}

function buildReconcileProactiveSchedule(boss: PgBoss): ReconcileProactiveScheduleFn {
  return async (actorUserId, pref) => {
    const allProviders = proactiveMonitorProvidersFor(getBuiltInModuleManifests());
    for (const { provider } of allProviders) {
      const source = provider.source as ProactiveSource;
      // Use actorUserId:source as the pg-boss schedule key — one row per user+source.
      const scheduleKey = `${actorUserId}:${source}`;
      if (pref.enabled && pref.sources[source]?.enabled) {
        const data: ProactiveScanSourceJobPayload = {
          actorUserId,
          source,
          reason: "scheduled-check",
          idempotencyKey: `scheduled-check:${actorUserId}:${source}`
        };
        // Defense-in-depth: boss.schedule does NOT route through sendJob's metadata guard.
        assertMetadataOnlyPayload(data);
        await boss.schedule(PROACTIVE_SCAN_SOURCE_QUEUE.name, PROACTIVE_CHECK_CRON, data, {
          key: scheduleKey
        });
      } else {
        await boss.unschedule(PROACTIVE_SCAN_SOURCE_QUEUE.name, scheduleKey);
      }
    }
  };
}

function createNotificationDigestSender(): NotificationDigestSender {
  const connectorsRepository = new ConnectorsRepository();
  const cipher = createConnectorSecretCipher();
  const googleProvider = new GoogleEmailWriteProvider(
    new RuntimeGoogleConnectionService({
      repository: connectorsRepository,
      cipher,
      oauthClient: new GoogleOAuthClient()
    }),
    new RuntimeGoogleApiClient()
  );
  const imapProvider = new ImapEmailWriteProvider(connectorsRepository, cipher);

  return {
    async sendDigest(scopedDb, input) {
      const accounts = await connectorsRepository.listAccounts(scopedDb);
      const google = accounts.find(
        (account) => account.status === "active" && account.provider_type === "google"
      );
      if (google) {
        return googleProvider.sendNew(scopedDb, {
          to: input.to,
          subject: input.subject,
          body: input.text
        });
      }
      const imap = accounts.find(
        (account) => account.status === "active" && account.provider_type === "imap"
      );
      if (!imap) return { ok: false };
      return imapProvider.sendNew(scopedDb, {
        connectorAccountId: imap.id,
        to: input.to,
        subject: input.subject,
        body: input.text
      });
    }
  };
}

/**
 * Composes the tasks module's EmailTriageFeedbackPort over the email cache and the
 * connectors feedback store. Lives here because only the composition root may import
 * both modules; enrichment comes from the CACHED row (metadata columns only) — full
 * bodies never reach the learning record (#729 §9).
 */
export function createEmailTriageFeedbackPort(): EmailTriageFeedbackPort {
  const emailRepository = new EmailRepository();
  const connectorsRepository = new ConnectorsRepository();
  return {
    async record(scopedDb, input) {
      const parsedRef = input.taskSourceRef ? parseEmailSourceRef(input.taskSourceRef) : null;
      const row = parsedRef
        ? await emailRepository.getByConnectorAccountAndExternalId(
            scopedDb,
            parsedRef.connectorAccountId,
            parsedRef.externalId
          )
        : undefined;
      const signals = (row?.signals ?? {}) as {
        actionability?: { category?: string };
        confidence?: number;
      };
      const sender = row?.sender ?? "unknown";
      const senderDomain = sender.includes("@")
        ? (sender.split("@").pop() ?? "unknown").toLowerCase()
        : "unknown";
      await connectorsRepository.recordTriageFeedback(scopedDb, {
        connectorAccountId: row?.connector_account_id ?? null,
        actionability: signals.actionability?.category ?? "unknown",
        sender,
        senderDomain,
        subjectPrefix: row ? row.subject.slice(0, 120) : null,
        actionType: null,
        confidence: typeof signals.confidence === "number" ? signals.confidence : null,
        modelVersion: null,
        verdict: input.verdict,
        reason: null
      });
    }
  };
}

const BUILT_IN_MODULES: readonly BuiltInModuleRegistration[] = [
  {
    manifest: settingsModuleManifest,
    sqlMigrationDirectories: [settingsModuleSqlMigrationDirectory],
    queueDefinitions: [...EXPORT_QUEUE_DEFINITIONS],
    registerRoutes: (server, deps) => {
      registerSettingsRoutes(server, {
        rootDb: deps.rootDb,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        listConfiguredAuthProviders: deps.listConfiguredAuthProviders,
        listModuleManifests: deps.listModuleManifests,
        moduleDeletionTables: MODULE_DELETION_TABLES,
        revokeUserSessions: deps.revokeUserSessions,
        meSessions: deps.meSessions,
        verifySelfPassword: deps.verifySelfPassword,
        hasPasswordCredential: deps.hasPasswordCredential,
        bootstrapConnectionString: deps.bootstrapConnectionString,
        getChatMultiplexerStatus: deps.getChatMultiplexerStatus,
        hostDiagnostics: deps.hostDiagnostics,
        onboardingProbes: deps.onboardingProbes,
        onboardingInstall: deps.onboardingInstall,
        onboardingLogin: deps.onboardingLogin,
        externalModules: deps.externalModules, // #917: thread the boot snapshot to settings routes
        moduleDistribution: deps.moduleDistribution,
        reconcileExternalModuleJobs: deps.reconcileExternalModuleJobs,
        personaPreview: deps.personaPreview ?? createDefaultPersonaPreview(deps.dataContext),
        preferencesRepository: new PreferencesRepository(),
        notificationUnreadPort: new NotificationsRepository(),
        boss: deps.boss,
        // #449: wire the per-actor 15-min notes-sync heartbeat. Injected as a hook
        // (not imported in @jarv1s/settings) because @jarv1s/notes already depends
        // on @jarv1s/settings for resolveNotesRoots — a direct import would cycle.
        reconcileNotesSchedule: deps.boss
          ? (actorUserId, hasPath) => reconcileNotesSchedule(deps.boss!, actorUserId, hasPath)
          : undefined,
        reconcileProactiveSchedule: deps.boss
          ? buildReconcileProactiveSchedule(deps.boss)
          : undefined
      });
      // Instance-wide Brave Search key: dedicated admin routes (the key is AES-256-GCM
      // encrypted at rest, never returned). The web-research module stays db-free; this
      // composition root injects the decrypt-at-use resolver so the tool resolves the key
      // per request. invalidateWebSearchProviderCache on save/revoke = no restart needed.
      const webSearchCipher = createWebSearchSecretCipher();
      registerWebSearchKeyRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        repository: new SettingsRepository(),
        cipher: webSearchCipher,
        onKeyChanged: invalidateWebSearchProviderCache
      });
      registerRuntimeConfigRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        repository: new SettingsRepository()
      });
      setWebSearchKeyResolver(
        (scopedDb) => readBraveSearchApiKey(scopedDb as DataContextDb, webSearchCipher),
        {
          // Metadata-only observability event. NEVER include the key/ciphertext/envelope/derived
          // value (Hard Invariant: secrets never escape). An operator pairs this with the setting
          // key to diagnose a keyring/rotation problem without exposing secret material.
          onDecryptFailed: () =>
            server.log.warn(
              { event: "web_search.key_decrypt_failed" },
              "Stored Brave Search key failed to decrypt; falling back to env key"
            )
        }
      );
    },
    registerWorkers: (boss, deps) =>
      registerSettingsJobWorkers(boss, deps.dataContext, deps.rootDb, getBuiltInModuleManifests)
  },
  {
    manifest: connectorsModuleManifest,
    sqlMigrationDirectories: [connectorsModuleSqlMigrationDirectory],
    queueDefinitions: [
      ...GOOGLE_SYNC_QUEUE_DEFINITIONS,
      ...GOOGLE_SYNC_SWEEP_QUEUE_DEFINITIONS,
      ...IMAP_SYNC_QUEUE_DEFINITIONS,
      ...MONITOR_QUEUE_DEFINITIONS
    ],
    registerRoutes: (server, deps) =>
      registerConnectorsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss
      }),
    registerWorkers: async (boss, deps) => {
      const googleWorkIds = await registerConnectorsJobWorkers(boss, {
        dataContext: deps.dataContext
      });
      // #792: self-healing periodic sweep, additive to the connect/manual-sync triggers
      // above. Needs the raw root Kysely handle (not DataContextDb) because it must
      // enumerate connected accounts across ALL actors via a bounded SECURITY DEFINER
      // function (sql/0143) — each subsequent GOOGLE_SYNC_QUEUE job it sends stays scoped
      // to that job's own actorUserId exactly as it does today.
      const googleSweepWorkId = await registerGoogleSyncSweepWorker(boss, deps.rootDb);
      const imapWorkIds = await registerImapSyncWorker(boss, { dataContext: deps.dataContext });
      // Structural task-creation port: connectors never imports the tasks module — the
      // composition root hands it a two-method adapter over TasksRepository (module isolation).
      const tasksRepositoryForEmail = new TasksRepository();
      const emailTaskPort: EmailTaskCreationPort = {
        async create(scopedDb, input) {
          const task = await tasksRepositoryForEmail.create(scopedDb, {
            title: input.title,
            description: input.description ?? undefined,
            status: input.status,
            dueAt: input.dueAt ?? undefined,
            priority: input.priority ?? undefined,
            source: input.source,
            sourceRef: input.sourceRef,
            externalKey: input.externalKey
          });
          return { id: task.id };
        }
      };
      const monitorWorkIds = await registerSourceMonitorWorkers(boss, {
        dataContext: deps.dataContext,
        taskPort: emailTaskPort
      });
      return [...googleWorkIds, googleSweepWorkId, ...imapWorkIds, ...monitorWorkIds];
    }
  },
  {
    manifest: tasksModuleManifest,
    sqlMigrationDirectories: [tasksModuleSqlMigrationDirectory],
    queueDefinitions: TASKS_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerTasksRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss,
        agencyPreferencesRepository: new PreferencesRepository(),
        localePreferencesRepository: new PreferencesRepository(),
        aiRepository: new AiRepository(),
        aiSecretCipher: createAiSecretCipher(),
        focusSignals: deps.focusSignals,
        emailTriageFeedback: createEmailTriageFeedbackPort()
      }),
    registerWorkers: (boss, dependencies) => registerTasksJobWorkers(boss, dependencies.dataContext)
  },
  {
    manifest: goalsModuleManifest,
    sqlMigrationDirectories: [goalsModuleSqlMigrationDirectory],
    queueDefinitions: [
      {
        name: GOALS_MEMORY_SYNC_QUEUE,
        options: { retryLimit: 3, retryDelay: 60, retryBackoff: true }
      },
      {
        name: GOALS_MEMORY_SYNC_RECONCILE_QUEUE,
        options: { retryLimit: 3, retryDelay: 60, retryBackoff: true }
      }
    ],
    registerRoutes: (server, deps) =>
      registerGoalsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss
      }),
    registerWorkers: async (boss, deps) => {
      const repository = new GoalsRepository();
      const memoryGraphRepo = new MemoryGraphRepository();
      return [
        await registerGoalsMemorySyncWorker(boss, deps.dataContext, repository, memoryGraphRepo),
        await registerGoalsMemorySyncReconcileWorker(boss, deps.dataContext, repository)
      ];
    }
  },
  {
    manifest: webModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: []
  },
  {
    manifest: notificationsModuleManifest,
    sqlMigrationDirectories: [notificationsModuleSqlMigrationDirectory],
    queueDefinitions: [{ name: DIGEST_COMPOSE_QUEUE, options: { retryLimit: 0 } }],
    registerRoutes: registerNotificationsRoutes,
    registerWorkers: async (boss, deps) => [
      await registerDataContextWorker(
        boss,
        DIGEST_COMPOSE_QUEUE,
        deps.dataContext,
        (_job, scopedDb) =>
          runNotificationDigestCompose(scopedDb, {
            baseUrl: process.env.JARVIS_PUBLIC_BASE_URL ?? "http://localhost:3000",
            preferencesRepository: new PreferencesRepository(),
            notificationsRepository: new NotificationsRepository(),
            notificationPreferencePort: createNotificationPreferencePort(),
            sender: createNotificationDigestSender()
          })
      )
    ]
  },
  {
    manifest: calendarModuleManifest,
    sqlMigrationDirectories: [calendarModuleSqlMigrationDirectory],
    queueDefinitions: CALENDAR_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerCalendarRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        calendarWritebackPolicy: {
          set: (scopedDb, moduleId, actionFamilyId, tier) =>
            new AiRepository().setActionPolicy(scopedDb, moduleId, actionFamilyId, tier)
        }
      }),
    registerWorkers: (boss, deps) => registerCalendarJobWorkers(boss, deps.dataContext)
  },
  {
    manifest: emailModuleManifest,
    sqlMigrationDirectories: [emailModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerEmailRoutes
  },
  {
    manifest: aiModuleManifest,
    sqlMigrationDirectories: [aiModuleSqlMigrationDirectory],
    queueDefinitions: AI_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) => {
      const preferencesRepository = new PreferencesRepository();
      const tasksCompatibility = new TasksCompatibilityHelper(preferencesRepository);
      return registerAiRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        resolveActiveModules: deps.resolveActiveModules,
        // #915 D6: installed set, not actor-filtered enablement.
        listInstalledModuleIds: () => deps.listModuleManifests().map((manifest) => manifest.id),
        tasksCompatibility,
        readToolServices: deps.connectorsRepository
          ? {
              featureGrants: buildFeatureGrantService({
                connectorsRepository: deps.connectorsRepository,
                preferencesRepository: new PreferencesRepository()
              }),
              sourceContext: buildRuntimeSourceContextService()
            }
          : undefined
      });
    },
    registerWorkers: (boss, deps) => registerAiMaintenanceWorkers(boss, deps.rootDb)
  },
  {
    manifest: chatModuleManifest,
    sqlMigrationDirectories: [chatModuleSqlMigrationDirectory],
    queueDefinitions: CHAT_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerChatRoutes(server, {
        rootDb: deps.rootDb,
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        // #342 (§3.5): on the RPC/socket path the chat runtime selects the engine itself via
        // `engineSelection`, so we must NOT also pass the in-process late-bound factory wrapper (which
        // would win the explicit-factory branch and never select the RPC client, and would throw
        // "not resolved yet" because the host-dev onReady resolver is skipped on the socket path). On
        // the host-dev path `engineSelection` is undefined and the resolved factory is passed instead.
        chatEngineFactory: deps.chatEngineSelection ? undefined : deps.chatEngineFactory,
        engineSelection: deps.chatEngineSelection,
        adoptChatRpcConnection: deps.adoptChatRpcConnection,
        resolveActiveModules: deps.resolveActiveModules,
        mcpServerUrl: deps.mcpServerUrl,
        boss: deps.boss,
        personaPreferences: new PreferencesRepository(),
        chatPreferences: new PreferencesRepository(),
        localePreferences: new PreferencesRepository(),
        agencyPreferences: new PreferencesRepository(),
        priorityPreferences: new PreferencesRepository(),
        googleConnectionService: deps.googleConnectionService,
        googleApiClient: deps.googleApiClient,
        connectorsRepository: deps.connectorsRepository,
        featureGrantService: deps.connectorsRepository
          ? buildFeatureGrantService({
              connectorsRepository: deps.connectorsRepository,
              preferencesRepository: new PreferencesRepository()
            })
          : undefined,
        sourceContextService: deps.connectorsRepository
          ? buildRuntimeSourceContextService()
          : undefined
      }),
    registerWorkers: (boss, deps) =>
      registerChatJobWorkers(boss, deps.dataContext, {
        embeddingProviderFactory: createRuntimeEmbeddingProvider,
        extractFactsDeps: {
          aiRepository: new AiRepository(),
          cipher: createAiSecretCipher(),
          candidatesRepository: new MemoryCandidatesRepository(),
          graphRepository: new MemoryGraphRepository()
        },
        logger: deps.logger ? createModuleLogger(deps.logger, "chat") : undefined
      })
  },
  {
    manifest: briefingsModuleManifest,
    sqlMigrationDirectories: [briefingsModuleSqlMigrationDirectory],
    queueDefinitions: BRIEFINGS_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerBriefingsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        listModuleManifests: deps.listModuleManifests,
        boss: deps.boss,
        feedbackRepository: usefulnessFeedbackRepository
      }),
    registerWorkers: (boss, dependencies) => {
      const briefingsLogger = dependencies.logger
        ? createModuleLogger(dependencies.logger, "briefings")
        : undefined;
      return registerBriefingsJobWorkers(boss, dependencies.dataContext, {
        moduleManifests: getBuiltInModuleManifests(),
        // A13: inject the full synthesis deps so the production scheduled briefing
        // actually grounds in vault recency/semantics AND fires the "ready"
        // notification — without this the worker falls back to the no-op retriever
        // (no vault grounding) and never delivers the notification (both seams are
        // built in the engine; this is the wiring that activates them).
        composeDeps: {
          moduleManifests: getBuiltInModuleManifests(),
          aiRepository: new AiRepository(),
          cipher: createAiSecretCipher(),
          personaRepository: new PreferencesRepository(),
          priorityPreferencesRepository: new PreferencesRepository(),
          focusReadiness: dependencies.focusSignals,
          sourceBehaviorPolicy: {
            manifests: getBuiltInModuleManifests(),
            preferencesRepository: new PreferencesRepository()
          },
          resolveUserName: async (scopedDb, actorUserId) => {
            const row = await scopedDb.db
              .selectFrom("app.users")
              .select("name")
              .where("id", "=", actorUserId)
              .executeTakeFirst();
            const name = row?.name?.trim();
            return name && name.length > 0 ? name : actorUserId;
          },
          memoryRetriever: runtimeMemoryRetriever as unknown as MemoryRetriever,
          logger: briefingsLogger,
          connectorSyncAt: async (scopedDb, kind) => {
            const repo = new ConnectorsRepository();
            return getConnectorSyncAt(repo, scopedDb, kind);
          },
          vaultLastWriteAt: async (scopedDb) => {
            const repo = new MemoryRepository();
            return repo.getLatestIngestedAt(scopedDb, "vault");
          },
          featureGrantService: buildFeatureGrantService({
            connectorsRepository: new ConnectorsRepository(),
            preferencesRepository: new PreferencesRepository()
          }),
          sourceContextService: buildRuntimeSourceContextService({ logger: briefingsLogger }),
          calendarFollowThrough: buildCalendarFollowThroughPort()
        },
        notificationsRepository: new NotificationsRepository(
          quietHoursPortImpl,
          createNotificationPreferencePort()
        ),
        logger: briefingsLogger
      });
    }
  },
  {
    manifest: memoryModuleManifest,
    sqlMigrationDirectories: [memorySqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) => {
      registerMemoryGraphRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext
      });
      registerMemoryDashboardRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext
      });
    }
  },
  {
    manifest: usefulnessFeedbackModuleManifest,
    sqlMigrationDirectories: [usefulnessFeedbackModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) => {
      const cardRepository = new CardRepository();
      const registry = new FeedbackTargetVerifierRegistry();
      registry.register("chat_message", createChatFeedbackTargetVerifier(new ChatRepository()));
      registry.register(
        "briefing_run",
        createBriefingsFeedbackTargetVerifier(
          new BriefingsRepository(),
          usefulnessFeedbackRepository
        )
      );
      registry.register(
        "briefing_item",
        createBriefingsFeedbackTargetVerifier(
          new BriefingsRepository(),
          usefulnessFeedbackRepository
        )
      );
      registry.register("proactive_card", makeProactiveCardVerifier(cardRepository));
      registerUsefulnessFeedbackRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        registry,
        repository: usefulnessFeedbackRepository,
        manualMemoryCandidates: new ManualMemoryCandidateService(),
        cardSideEffects: {
          applyDismiss: (scopedDb, _actorUserId, cardId) =>
            cardRepository.markDismissed(scopedDb, _actorUserId, cardId).then(() => undefined),
          undoDismissCard: (scopedDb, _actorUserId, cardId) =>
            cardRepository.reactivate(scopedDb, _actorUserId, cardId).then(() => undefined)
        },
        calendarFollowThroughSideEffects: buildCalendarFollowThroughSideEffects()
      });
    }
  },
  {
    manifest: structuredStateModuleManifest,
    sqlMigrationDirectories: [structuredStateSqlMigrationDirectory],
    queueDefinitions: []
  },
  {
    manifest: wellnessModuleManifest,
    sqlMigrationDirectories: [wellnessModuleSqlMigrationDirectory],
    queueDefinitions: [...WELLNESS_EXPORT_QUEUE_DEFINITIONS],
    registerRoutes: (server, deps) => {
      const preferencesRepository = new PreferencesRepository();
      registerWellnessRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        resolveActiveModules: deps.resolveActiveModules,
        resolveRequestTimeZone: (request, accessContext) =>
          resolveRequestTimeZoneForRoute(
            request,
            accessContext,
            deps.dataContext,
            preferencesRepository
          )
      });
      registerWellnessExportRoutes(server, {
        boss: deps.boss,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext
      });
    },
    registerWorkers: (boss, deps) => registerWellnessExportWorkers(boss, deps.dataContext)
  },
  {
    manifest: weatherModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerWeatherRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        preferencesRepo: new PreferencesRepository(),
        fetchFn: deps.fetchFn
      })
  },
  {
    // LOADER-SEAM(sports) 1: static import + registration object (manifest, sql dir, routes).
    manifest: sportsModuleManifest,
    sqlMigrationDirectories: [sportsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) => {
      // LOADER-SEAM(sports) 2: DI wiring + construction of the dataset-connector-SDK runtime
      // client (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md) bound to the
      // module's manifest-declared `espn` external source, in the composition root (which
      // concrete adapter/host-pinning config applies lives here, not in the manifest itself).
      // Sports is the sole migration case this slice, so the client is wired inline rather than
      // via a generic per-module map on `BuiltInModuleRegistration`.
      const [espnSource] = sportsModuleManifest.externalSources ?? [];
      if (!espnSource) {
        throw new Error("sports module manifest is missing its `espn` externalSources entry");
      }
      const datasetClient = createDatasetClient(espnSource, createEspnDatasetAdapter(), {
        fetchFn: deps.fetchFn,
        logger: createModuleLogger(server.log, "sports")
      });
      // LOADER-SEAM(sports) 3: the briefing tool (`briefing-tool.ts`) is constructed from
      // static manifest data at import time, before this wiring runs, so it adopts the client
      // via a late-bound setter (mirrors `adoptChatRpcConnection` above for the chat RPC path).
      configureSportsBriefingService(datasetClient);
      registerSportsRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        datasetClient
      });
    }
  },
  {
    manifest: newsModuleManifest,
    sqlMigrationDirectories: [newsModuleSqlMigrationDirectory],
    queueDefinitions: [...NEWS_QUEUE_DEFINITIONS],
    registerRoutes: (server, deps) => {
      // Same dataset-connector-SDK wiring as sports above: the composition root binds the
      // manifest-declared `newsfeeds` external source to the concrete RSS adapter so host
      // pinning and TTLs come from the manifest, not the module code.
      const [feedsSource] = newsModuleManifest.externalSources ?? [];
      if (!feedsSource) {
        throw new Error("news module manifest is missing its `newsfeeds` externalSources entry");
      }
      const datasetClient = createDatasetClient(feedsSource, createRssDatasetAdapter(), {
        fetchFn: deps.fetchFn,
        logger: createModuleLogger(server.log, "news")
      });
      // Briefing tool is constructed at import time; it adopts the client late-bound
      // (mirrors LOADER-SEAM(sports) 3).
      configureNewsBriefingService(datasetClient);
      const discovery = buildNewsDiscoveryPorts(createModuleLogger(server.log, "news"));
      registerNewsRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        datasetClient,
        discovery,
        boss: deps.boss,
        // #953: news receives capability BOOLEANS only — model identity and key material stay
        // behind the AI/Settings public APIs; nothing secret crosses this seam.
        availability: {
          hasJsonModel: async (scopedDb) =>
            (
              await new AiRepository().resolveModelForService(scopedDb, "module.news", {
                capability: "json",
                tierHint: "economy"
              })
            ).model !== null,
          hasWebSearch: async (scopedDb) => (await getWebSearchKeyConfig(scopedDb)).configured
        }
      });
    },
    registerWorkers: (boss, deps) => {
      const discovery = buildNewsDiscoveryPorts(
        deps.logger ? createModuleLogger(deps.logger, "news") : undefined
      );
      return registerNewsJobWorkers(boss, deps.dataContext, {
        ...discovery,
        logger: {
          info: (fields) => deps.logger?.info(fields, "news compilation")
        },
        // #975 Slice 4: revalidation summary notification honors quiet hours and the
        // owner's per-module notification preference like every other module emitter.
        notificationsRepository: new NotificationsRepository(
          quietHoursPortImpl,
          createNotificationPreferencePort()
        ),
        revalidationLogger: {
          info: (fields) => deps.logger?.info(fields, "news revalidation")
        }
      });
    }
  },
  {
    manifest: notesModuleManifest,
    sqlMigrationDirectories: [notesModuleSqlMigrationDirectory],
    queueDefinitions: [...NOTES_QUEUE_DEFINITIONS],
    registerRoutes: (server, deps) =>
      registerNotesSyncRoutes(server, {
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        preferencesRepository: new PreferencesRepository(),
        boss: deps.boss
      }),
    registerWorkers: (boss, deps) =>
      registerNotesJobWorkers(boss, deps.dataContext, {
        embeddingProviderFactory: createRuntimeEmbeddingProvider,
        preferencesRepository: new PreferencesRepository(),
        afterSync: async ({ actorUserId }) => {
          const accessContext = { actorUserId, requestId: "notes-sync:people" };
          const vaultRunner = new VaultContextRunner(getVaultBaseDir());
          const peopleNotes = new PeopleNotesService();
          await vaultRunner.withVaultContext(accessContext, (vaultCtx) =>
            deps.dataContext.withDataContext(accessContext, async (scopedDb) => {
              if (!(await isPeopleNotesSuggestUpdatesEnabled(scopedDb))) {
                return { projected: 0, candidates: 0 };
              }
              return peopleNotes.refreshFromFolder(scopedDb, vaultCtx, actorUserId);
            })
          );
        }
      })
  },
  {
    manifest: proactiveMonitoringModuleManifest,
    sqlMigrationDirectories: [proactiveMonitoringSqlMigrationDirectory],
    queueDefinitions: [PROACTIVE_SCAN_SOURCE_QUEUE],
    registerRoutes: (server, deps) => {
      const allProviders = proactiveMonitorProvidersFor(getBuiltInModuleManifests());
      const registeredSources = new Set<ProactiveSource>(
        allProviders.map((p) => p.provider.source as ProactiveSource)
      );
      registerProactiveMonitoringRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss,
        registeredSources
      });
    },
    registerWorkers: async (boss, deps) => {
      const allProviders = proactiveMonitorProvidersFor(getBuiltInModuleManifests());
      const providers = new Map(
        allProviders.map((p) => [p.provider.source as ProactiveSource, p.provider])
      );
      const preferencesRepository = new PreferencesRepository();
      return registerProactiveMonitoringWorkers(boss, {
        dataContext: deps.dataContext,
        getLocalePreference: async (scopedDb) => {
          const val = await preferencesRepository.get(scopedDb, "locale");
          if (!val || typeof val !== "object" || Array.isArray(val)) return null;
          return val as { timezone?: string };
        },
        providers
      });
    }
  },
  {
    manifest: commitmentsModuleManifest,
    sqlMigrationDirectories: [commitmentsModuleSqlMigrationDirectory],
    queueDefinitions: [{ name: COMMITMENT_EXTRACTION_QUEUE, options: {} }],
    registerRoutes: (server, deps) =>
      registerCommitmentsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss
      }),
    registerWorkers: async (boss, deps) =>
      registerCommitmentExtractionWorker(boss, deps.dataContext, {
        aiRepository: new AiRepository(),
        cipher: createAiSecretCipher(),
        repository: new CommitmentsRepository(),
        providers: [chatCommitmentProvider, notesCommitmentProvider]
      })
  },
  {
    manifest: peopleModuleManifest,
    sqlMigrationDirectories: [peopleModuleSqlMigrationDirectory],
    queueDefinitions: [{ name: PERSON_INDEX_QUEUE }, { name: SYNC_PERSON_MEMORY_QUEUE }],
    registerRoutes: (server, deps) =>
      registerPeopleRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss,
        vaultRunner: new VaultContextRunner(getVaultBaseDir()),
        peopleNotesService: new PeopleNotesService()
      }),
    registerWorkers: async (boss, deps) => {
      const indexId = await registerPersonIndexWorker(boss, deps.dataContext, {
        providers: []
      });
      const syncId = await registerSyncPersonMemoryWorker(boss, deps.dataContext);
      return [indexId, syncId];
    }
  }
];

/**
 * Modules with owned tables that have not yet declared a `dataLifecycle` manifest field
 * (see docs/superpowers/specs/2026-07-04-module-data-lifecycle-ports.md, Phase B). Listed
 * modules skip the mandatory-declaration check in `assertModuleRegistryConsistency` below;
 * any module that HAS a `dataLifecycle` is fully checked regardless of this list. Each
 * Phase B PR removes its module from this list; the final Phase B PR deletes it, making the
 * assertion unconditional. This list only ever shrinks — pinned exactly by a unit test.
 *
 * Declared BEFORE the module-load-time `assertModuleRegistryConsistency(BUILT_IN_MODULES)`
 * call below (rather than after, as originally drafted): that call runs synchronously at
 * import time, and a `const` referenced before its own declaration line throws a
 * temporal-dead-zone ReferenceError — this ordering is load-bearing, not stylistic.
 */
export const LIFECYCLE_MIGRATION_PENDING: readonly string[] = [
  "ai",
  "briefings",
  "calendar",
  "chat",
  "connectors",
  "email",
  "jarvis.commitments",
  "memory",
  "notes",
  "notifications",
  "people",
  "proactive-monitoring",
  "structured-state",
  "tasks",
  "usefulness-feedback",
  "weather"
];

// Compat gate (ADR 0009 §3): validate every built-in's compatibility.jarv1s against
// CORE_VERSION at load time, before any registration path runs. Throws if a module is
// incompatible or not defaultEnabled, naming the offender.
assertModulesCompatible(BUILT_IN_MODULES.map((module) => module.manifest));
assertModuleRegistryConsistency(BUILT_IN_MODULES);

// LOADER-SEAM(sports) 7: the web CSP img-src allowlist is derived from every built-in module's
// manifest-declared `externalSources[].imageHosts` (dataset-connector SDK), not from a single
// hardcoded source factory — so it can never diverge from what routing is actually allowed to
// fetch/render, and automatically picks up any future module that declares image hosts.
export const MODULE_IMAGE_CSP_HOSTS: readonly string[] = Array.from(
  new Set(
    BUILT_IN_MODULES.flatMap((module) =>
      (module.manifest.externalSources ?? []).flatMap((source) => source.imageHosts ?? [])
    )
  )
);

export function assertModuleRegistryConsistency(
  registrations: readonly BuiltInModuleRegistration[] = BUILT_IN_MODULES
): void {
  const moduleIds = new Map<string, string>();
  const queueNames = new Map<string, string>(
    FOUNDATION_QUEUES.map((queue) => [queue.name, "foundation"])
  );
  const routeKeys = new Map<string, string>();
  const ownedTables = new Map<string, string>();
  const externalSourceIds = new Map<string, string>();

  for (const registration of registrations) {
    const moduleId = registration.manifest.id;

    assertUniqueRegistryKey(moduleIds, moduleId, moduleId, "module id");

    for (const queue of registration.queueDefinitions) {
      assertUniqueRegistryKey(queueNames, queue.name, moduleId, "queue name");
    }

    for (const route of registration.manifest.routes ?? []) {
      assertUniqueRegistryKey(routeKeys, `${route.method} ${route.path}`, moduleId, "route");
    }

    const moduleOwnedTables = registration.manifest.database?.ownedTables ?? [];
    for (const table of moduleOwnedTables) {
      assertUniqueRegistryKey(ownedTables, table, moduleId, "owned table");
    }

    // Dataset connector SDK (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md):
    // registration-time validation of every module's declared external data sources. Purely
    // manifest-driven (no adapter needed) so it applies uniformly regardless of whether a
    // module's composition-root wiring has migrated to a `DatasetClient` yet.
    for (const source of registration.manifest.externalSources ?? []) {
      assertUniqueRegistryKey(externalSourceIds, source.id, moduleId, "external source id");
      assertValidFetchHosts(source.id, source.fetchHosts);
      if (source.credential === "api-key") {
        throw new Error(
          `External source "${source.id}" (module "${moduleId}") declares credential "api-key", ` +
            "which is reserved but not yet supported — no secret storage exists for connector " +
            "credentials in this slice (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md)"
        );
      }
    }

    const lifecycle = registration.manifest.dataLifecycle;

    if (moduleOwnedTables.length > 0) {
      if (!lifecycle) {
        if (!LIFECYCLE_MIGRATION_PENDING.includes(moduleId)) {
          throw new Error(
            `Module "${moduleId}" has owned tables but declares no dataLifecycle, and is not on ` +
              "the LIFECYCLE_MIGRATION_PENDING allowlist (packages/module-registry/src/index.ts)"
          );
        }
      } else if (lifecycle.exportSections === undefined) {
        throw new Error(
          `Module "${moduleId}" declares dataLifecycle with owned tables but omits ` +
            'exportSections; declare "exportSections: []" explicitly if there is nothing to export'
        );
      }
    }

    if (lifecycle) {
      const declaredDeletionTables = new Set(lifecycle.deletion.tables.map((entry) => entry.table));
      const missingFromDeletion = moduleOwnedTables.filter(
        (table) => !declaredDeletionTables.has(table)
      );
      if (missingFromDeletion.length > 0) {
        throw new Error(
          `Module "${moduleId}" dataLifecycle.deletion.tables is missing owned table(s): ` +
            missingFromDeletion.join(", ")
        );
      }
    }
  }
}

function assertUniqueRegistryKey(
  seen: Map<string, string>,
  key: string,
  owner: string,
  label: string
): void {
  const existingOwner = seen.get(key);
  if (existingOwner) {
    throw new Error(
      `Duplicate ${label} "${key}" in module registry: ${existingOwner} and ${owner}`
    );
  }
  seen.set(key, owner);
}

export function getBuiltInModuleRegistrations(): readonly BuiltInModuleRegistration[] {
  return BUILT_IN_MODULES;
}

export function getBuiltInModuleManifests(): readonly JarvisModuleManifest[] {
  return BUILT_IN_MODULES.map((module) => module.manifest);
}

/** Default predicate applied when a `ModuleDeletionTable` omits `countPredicate`. */
export const DEFAULT_MODULE_DELETION_COUNT_PREDICATE = "owner_user_id = $1::uuid";

export interface ResolvedModuleDeletionTable {
  readonly table: string;
  readonly countPredicate: string;
}

/**
 * Flattens every built-in module's `dataLifecycle.deletion.tables` into the resolved
 * (default-applied) list `scripts/delete-user-data.ts` sweeps for its before/after counts.
 * Used both by the settings composition root below (API path) and by the deletion script's
 * dynamic `import("@jarv1s/module-registry")` inside its `import.meta.url`-guarded `main()` —
 * never call this from a statically-imported context in `@jarv1s/settings` (that would
 * recreate the package cycle the dynamic import exists to avoid).
 */
export function getModuleDeletionTables(
  manifests: readonly JarvisModuleManifest[] = getBuiltInModuleManifests()
): readonly ResolvedModuleDeletionTable[] {
  return manifests.flatMap((manifest) =>
    (manifest.dataLifecycle?.deletion.tables ?? []).map((entry) => ({
      table: entry.table,
      countPredicate: entry.countPredicate ?? DEFAULT_MODULE_DELETION_COUNT_PREDICATE
    }))
  );
}

/** Module load time snapshot, mirrors the MODULE_IMAGE_CSP_HOSTS precedent above. */
export const MODULE_DELETION_TABLES: readonly ResolvedModuleDeletionTable[] =
  getModuleDeletionTables();

/**
 * External-module counterpart to getModuleDeletionTables (#914, spec D6 "lifecycle derived from
 * structure, no module code"). Built-in modules declare dataLifecycle.deletion.tables explicitly;
 * external modules never carry module code in their manifest, so the platform derives deletion
 * coverage structurally from `database.ownedTables` instead — every owned table is automatically
 * swept with the default owner_user_id predicate, with no per-module deletion declaration to
 * maintain. Manifests are passed in explicitly (unlike MODULE_DELETION_TABLES' eager snapshot)
 * because external modules install post-deploy — the caller (scripts/delete-user-data-cli.ts)
 * reads installed manifests at run time, not from a static import-time snapshot.
 */
export function getExternalModuleDeletionTables(
  installedManifests: readonly JarvisModuleManifest[]
): readonly ResolvedModuleDeletionTable[] {
  return installedManifests.flatMap((manifest) =>
    (manifest.database?.ownedTables ?? []).map((table) => ({
      table,
      countPredicate: DEFAULT_MODULE_DELETION_COUNT_PREDICATE
    }))
  );
}

/**
 * Build the focus-signal provider list from a manifest set. Pass the per-actor ACTIVE
 * manifests (resolveActiveModules(actorUserId)) so a per-user-disabled module is excluded.
 * Generic: any module that declares `focusSignal` participates; no module is special-cased.
 */
export function focusSignalProvidersFor(
  manifests: readonly JarvisModuleManifest[]
): RegisteredFocusSignal[] {
  return manifests.flatMap((manifest) =>
    manifest.focusSignal ? [{ moduleId: manifest.id, provider: manifest.focusSignal }] : []
  );
}

type TimeZonePreferences = {
  get(scopedDb: DataContextDb, key: string): Promise<unknown>;
};

type TimeZoneRunner = {
  withDataContext<T>(
    accessContext: AccessContext,
    work: (scopedDb: DataContextDb) => Promise<T> | T
  ): Promise<T>;
};

export async function resolveRequestTimeZoneForRoute(
  request: { readonly timeZone?: string },
  accessContext: AccessContext,
  dataContext: TimeZoneRunner,
  preferences: TimeZonePreferences
): Promise<string> {
  if (request.timeZone) return resolveTimeZone(request.timeZone, undefined);
  const stored = await dataContext.withDataContext(accessContext, (scopedDb) =>
    preferences.get(scopedDb, "locale")
  );
  return resolveTimeZone(undefined, extractStoredTimeZone(stored));
}

function extractStoredTimeZone(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const timeZone = (value as Record<string, unknown>)["timezone"];
  return typeof timeZone === "string" ? timeZone : undefined;
}

/**
 * Build the proactive-monitor provider list from a manifest set. Any module that declares
 * `proactiveMonitor` participates. Pass per-actor active manifests to exclude disabled modules.
 */
export function proactiveMonitorProvidersFor(
  manifests: readonly JarvisModuleManifest[]
): RegisteredProactiveMonitorProvider[] {
  return manifests.flatMap((manifest) =>
    manifest.proactiveMonitor
      ? [{ moduleId: manifest.id, provider: manifest.proactiveMonitor }]
      : []
  );
}

export function getBuiltInSqlMigrationDirectories(): readonly string[] {
  return BUILT_IN_MODULES.flatMap((module) => module.sqlMigrationDirectories);
}

export function getAllQueueDefinitions(): readonly QueueDefinition[] {
  return [...FOUNDATION_QUEUES, ...BUILT_IN_MODULES.flatMap((module) => module.queueDefinitions)];
}

export function registerBuiltInApiRoutes(
  server: FastifyInstance,
  dependencies: BuiltInRouteDependencies
): void {
  const env = process.env;
  const getChatMultiplexerStatus = makeChatMultiplexerStatusProbe(env);

  // #342 boot-time fork (§3.5): when JARVIS_CLI_RUNNER_SOCKET is set the api drives the cli-runner
  // sidecar over ONE shared socket (§3.4 — one connection per api process). That ONE connection is
  // owned by the chat runtime (it must be constructed WITH the §5.3 onReconcile hook, which needs the
  // manager — see integrationNotes), and adopted here for the onboarding probes via a late-bound ref.
  // The chat runtime surfaces it through `dependencies.chatRpcConnection` (the composition seam); the
  // probes close over this ref, which is populated either synchronously (already provided) or when the
  // chat routes register their runtime. Until populated the probes fall back to the in-process path.
  const socketConfigured = Boolean(env.JARVIS_CLI_RUNNER_SOCKET);
  let rpcConnection: RpcConnection | undefined = dependencies.chatRpcConnection;
  const getRpcConnection = (): RpcConnection | undefined => rpcConnection;

  // Onboarding probes: built synchronously (no boot-time probing) and forwarded to the settings
  // module. Each function probes lazily, per request, bounded by a short timeout. On the RPC path they
  // route through the cli-runner over the socket (§4.8) instead of spawning CLIs in-process; the
  // late-bound `getRpcConnection` lets a connection that is wired AFTER probe construction still be
  // used (the probes only dereference it at call time, which is strictly post-boot).
  const cliPresent = makeCliPresentProbe(getRpcConnection);

  // The factory is resolved asynchronously in onReady (a settings read) on the in-process path, but
  // routes register synchronously. Bridge with a late-bound wrapper: it is only ever invoked when a
  // chat session launches, which is strictly after onReady. Tests/embedders that pass an explicit
  // chatEngineFactory bypass resolution entirely.
  let resolvedChatFactory: ChatEngineFactory | null = null;
  const chatEngineFactory: ChatEngineFactory =
    dependencies.chatEngineFactory ??
    ((provider, key) => {
      if (!resolvedChatFactory) {
        throw new CliChatUnavailableError("chat engine factory is not resolved yet");
      }
      return resolvedChatFactory(provider, key);
    });

  const onboardingProbes = {
    cliPresent,
    testProviderConnection: makeProviderConnectionCheckProbe({
      engineFactory: chatEngineFactory,
      cliPresent,
      skipInstallCheck: dependencies.chatEngineFactory !== undefined,
      connection: getRpcConnection
    }),
    connectorAccountExists: async (scopedDb: DataContextDb) =>
      (await new ConnectorsRepository().listAccounts(scopedDb)).length > 0
  };

  // #342 §A.5: the admin-gated install seam. Built ONLY on the socket path (no in-process install
  // path exists — the CLIs live in the cli-runner container). The one RPC connection is resolved
  // lazily (`getRpcConnection`) since the chat runtime publishes it after routes register. On the
  // host-dev / in-process path this is undefined ⇒ the install route fails closed (500) and the
  // status route serves the Phase-1 presence-only surface. The admin-gated route is then the SOLE
  // install trigger (§A.7.8). #347 stays BLOCKING — multi-user concurrency is not enabled here.
  const onboardingInstall: OnboardingInstallDependencies | undefined = buildOnboardingInstall({
    enabled: socketConfigured,
    getConnection: getRpcConnection,
    repository: new SettingsRepository(),
    logger: { warn: (obj, msg) => server.log.warn(obj, msg) }
  });

  // #342 §L.5: the admin-gated login seam, built ONLY on the socket path (the login CLIs live in the
  // cli-runner container; no in-process login path). On host-dev / in-process this is undefined ⇒ the
  // login routes fail closed (500). The admin-gated routes are then the SOLE login triggers; #347 stays
  // BLOCKING — login is single-active-user (the §L.6.1 unified exclusivity gate is NOT bypassed).
  const onboardingLogin: OnboardingLoginDependencies | undefined = buildOnboardingLogin({
    enabled: socketConfigured,
    getConnection: getRpcConnection,
    repository: new SettingsRepository(),
    // #367: on login `ready`, auto-register a default chat model so chat works with zero manual
    // entry. Best-effort — a failure is logged here and never fails the login.
    autoRegister: new AiAutoRegisterService({
      repository: new AiRepository(),
      cipher: createAiSecretCipher()
    }),
    logger: { warn: (obj, msg) => server.log.warn(obj, msg) }
  });

  const deps: BuiltInRouteDependencies = {
    ...dependencies,
    chatEngineFactory,
    // #342 (§3.5 boot-time fork): on the socket path hand the chat runtime an `engineSelection` so it
    // selects the RPC client itself (fail-fast on a missing §6.6 secret), wires the §5.3 reconciliation
    // hook, and starts the §5.5 idle reaper. The {method,id,sessionKey,bytes}-only debug logger (§6.4)
    // is intentionally omitted (no frame-body logging). Tests that inject an explicit chatEngineFactory
    // bypass this entirely (no socket selection). Undefined on the in-process / host-dev path.
    chatEngineSelection: socketConfigured && !dependencies.chatEngineFactory ? { env } : undefined,
    passiveMemoryRecall: {
      async recall(scopedDb, ownerUserId, query, options) {
        const provider = await createRuntimeEmbeddingProvider(scopedDb);
        return new GraphMemoryRecallService(provider).recall(scopedDb, ownerUserId, query, options);
      }
    },
    getChatMultiplexerStatus,
    onboardingProbes,
    onboardingInstall,
    onboardingLogin,
    // Surface a setter so the chat runtime (constructed inside registerChatRoutes) can publish the ONE
    // RPC connection it owns back to the probes + the boot lifecycle below. On the RPC path the runtime
    // wires reconcile + the idle reaper onto this connection; here we only need the handle to route
    // probes through it and to ensureConnected()/close() it at the composition-root boundary.
    adoptChatRpcConnection: (connection: RpcConnection) => {
      rpcConnection = connection;
    },
    resolveEveningInterviewSeed: async (actorUserId: string, briefingRunId?: string) => {
      const repository = new BriefingsRepository();
      const run = await dependencies.dataContext.withDataContext(
        { actorUserId, requestId: "chat:evening-interview-seed" },
        (scopedDb) => repository.getOwnedEveningRunForInterview(scopedDb, briefingRunId)
      );
      return buildEveningInterviewSeed(run?.summary_text ?? null);
    }
  };

  for (const module of BUILT_IN_MODULES) {
    module.registerRoutes?.(server, deps);
  }

  // In-process (host-dev) path: resolve the tmux/herdr factory in onReady (a settings read). The RPC
  // path skips this — its factory is selected by the chat runtime (RPC client) via engineSelection.
  if (!dependencies.chatEngineFactory && !socketConfigured) {
    server.addHook("onReady", async () => {
      resolvedChatFactory = await resolveChatEngineFactory({
        appDb: dependencies.rootDb,
        env,
        log: (msg) => server.log.info(msg)
      });
    });
  }

  // RPC path: connect on boot so the §5.3 reconciliation runs before the first user turn (§3.5), and
  // tear the socket down on server close. The chat runtime owns the reconcile hook + the idle reaper
  // (it calls runtime.shutdown() / stops the reaper); this composition root manages only the
  // connect-on-boot + close-on-shutdown lifecycle the seam is responsible for.
  if (socketConfigured) {
    server.addHook("onReady", async () => {
      const connection = getRpcConnection();
      if (!connection) return;
      // Best-effort: a failed initial connect backs off internally and the first turn retries; never
      // block readiness on the optional cli-runner being up yet (the "disabled, not crashed" contract).
      void connection.ensureConnected().catch((err) => {
        server.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "cli-runner socket not yet reachable at boot; will connect on first use"
        );
      });
    });
    server.addHook("onClose", async () => {
      getRpcConnection()?.close();
    });
  }
}

export async function registerBuiltInModuleWorkers(
  boss: PgBoss,
  dependencies: BuiltInWorkerDependencies
): Promise<string[]> {
  const workerIds = await Promise.all(
    BUILT_IN_MODULES.map(
      (module) => module.registerWorkers?.(boss, dependencies) ?? Promise.resolve([])
    )
  );

  return workerIds.flat();
}
