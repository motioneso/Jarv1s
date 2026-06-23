import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import {
  AiAutoRegisterService,
  AiRepository,
  HttpApiAdapter,
  aiModuleManifest,
  aiModuleSqlMigrationDirectory,
  createAiSecretCipher,
  parseAiApiKeyCredential,
  registerAiRoutes,
  type ProviderKind
} from "@jarv1s/ai";
import {
  ChatMemoryFactsRepository,
  MemoryRepository,
  MemoryRetriever,
  memoryModuleManifest,
  memorySqlMigrationDirectory,
  type EmbeddingProvider
} from "@jarv1s/memory";
import {
  PreferencesRepository,
  structuredStateModuleManifest,
  structuredStateSqlMigrationDirectory
} from "@jarv1s/structured-state";
import {
  BRIEFINGS_QUEUE_DEFINITIONS,
  briefingsModuleManifest,
  briefingsModuleSqlMigrationDirectory,
  registerBriefingsJobWorkers,
  registerBriefingsRoutes
} from "@jarv1s/briefings";
import {
  calendarModuleManifest,
  calendarModuleSqlMigrationDirectory,
  registerCalendarRoutes
} from "@jarv1s/calendar";
import {
  CHAT_QUEUE_DEFINITIONS,
  chatModuleManifest,
  chatModuleSqlMigrationDirectory,
  CliChatUnavailableError,
  registerChatJobWorkers,
  registerChatRoutes,
  type ChatEngineFactory,
  type ChatRoutesDependencies,
  type RpcConnection
} from "@jarv1s/chat";
import {
  ConnectorsRepository,
  GOOGLE_SYNC_QUEUE_DEFINITIONS,
  connectorsModuleManifest,
  connectorsModuleSqlMigrationDirectory,
  registerConnectorsJobWorkers,
  registerConnectorsRoutes,
  type GoogleApiClient,
  type GoogleConnectionService
} from "@jarv1s/connectors";
import type { ActiveModulesResolver } from "@jarv1s/ai";
import type { AccessContext, DataContextDb, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import {
  emailModuleManifest,
  emailModuleSqlMigrationDirectory,
  registerEmailRoutes
} from "@jarv1s/email";
import { FOUNDATION_QUEUES, type QueueDefinition } from "@jarv1s/jobs";
import { HttpError } from "@jarv1s/module-sdk";
import type { JarvisModuleManifest, RegisteredFocusSignal } from "@jarv1s/module-sdk";
import {
  NotificationsRepository,
  notificationsModuleManifest,
  notificationsModuleSqlMigrationDirectory,
  registerNotificationsRoutes,
  type QuietHoursPort
} from "@jarv1s/notifications";
import {
  renderPersonaText,
  type AuthProviderStatusDto,
  type OnboardingProviderCheckResponse,
  type OnboardingProviderKind
} from "@jarv1s/shared";
import {
  EXPORT_QUEUE_DEFINITIONS,
  createWebSearchSecretCipher,
  readBraveSearchApiKey,
  registerSettingsJobWorkers,
  registerSettingsRoutes,
  registerWebSearchKeyRoutes,
  settingsModuleManifest,
  settingsModuleSqlMigrationDirectory,
  SettingsRepository,
  type HostDiagnosticsProvider,
  type MeSessionsService,
  type PersonaPreviewInput,
  type VerifySelfPasswordPort,
  type HasPasswordCredentialPort,
  type OnboardingInstallDependencies,
  type OnboardingLoginDependencies
} from "@jarv1s/settings";
import {
  TASKS_QUEUE_DEFINITIONS,
  registerTasksJobWorkers,
  registerTasksRoutes,
  tasksModuleManifest,
  tasksModuleSqlMigrationDirectory
} from "@jarv1s/tasks";
import {
  invalidateWebSearchProviderCache,
  setWebSearchKeyResolver,
  webModuleManifest
} from "@jarv1s/web-research";
import {
  registerWellnessRoutes,
  wellnessModuleManifest,
  wellnessModuleSqlMigrationDirectory
} from "@jarv1s/wellness";
import { registerWeatherRoutes, weatherModuleManifest } from "@jarv1s/weather";
import {
  notesModuleManifest,
  notesModuleSqlMigrationDirectory,
  NOTES_QUEUE_DEFINITIONS,
  reconcileNotesSchedule,
  registerNotesSyncRoutes,
  registerNotesJobWorkers
} from "@jarv1s/notes";

import { assertModulesCompatible } from "./compat-gate.js";
import {
  makeCliPresentProbe,
  makeProviderConnectionCheckProbe,
  probeChatMultiplexerAvailability,
  resolveChatEngineFactory
} from "./chat-multiplexer.js";
import { buildOnboardingInstall } from "./onboarding-install.js";
import { buildOnboardingLogin } from "./onboarding-login.js";

export type { ChatEngineFactory } from "@jarv1s/chat";
export type { JarvisModuleManifest } from "@jarv1s/module-sdk";
export { aggregateFocusSignals } from "@jarv1s/module-sdk";

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
  /** Boot-time multiplexer availability snapshot for the admin settings UI. */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
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
  /** TEST-ONLY. Inject a fake fetch for weather (and any other external HTTP) without real network. */
  readonly fetchFn?: typeof fetch;
}

export interface BuiltInWorkerDependencies {
  readonly dataContext: DataContextRunner;
  readonly embeddingProvider: EmbeddingProvider;
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

const _quietHoursPreferencesRepo = new PreferencesRepository();
const quietHoursPortImpl: QuietHoursPort = {
  getSettings: (scopedDb) => _quietHoursPreferencesRepo.get(scopedDb, "quiet-hours"),
  getLocaleTimezone: async (scopedDb) => {
    const locale = await _quietHoursPreferencesRepo.get(scopedDb, "locale");
    if (!locale || typeof locale !== "object" || Array.isArray(locale)) return null;
    const tz = (locale as Record<string, unknown>).timezone;
    return typeof tz === "string" && tz.length > 0 ? tz : null;
  }
};

const PERSONA_PREVIEW_SAMPLE_TURN =
  "Give me a two-sentence morning check-in for a day with one important task and one slipped commitment.";
const PERSONA_PREVIEW_MAX_OUTPUT_TOKENS = 180;

function createDefaultPersonaPreview(
  dataContext: DataContextRunner
): (input: PersonaPreviewInput) => Promise<string> {
  const aiRepository = new AiRepository();
  const cipher = createAiSecretCipher();

  return async (input) =>
    dataContext.withDataContext(
      { actorUserId: input.actorUserId, requestId: "settings:persona-preview" },
      async (scopedDb) => {
        const model = await aiRepository.selectModelForCapability(scopedDb, "chat");
        if (!model) {
          throw new HttpError(503, "No active chat-capable model is configured");
        }

        const provider = await aiRepository.selectProviderWithCredential(
          scopedDb,
          model.provider_config_id
        );
        if (!provider?.encrypted_credential) {
          throw new HttpError(503, "Chat model credential is not configured");
        }

        let apiKey: string;
        try {
          const credential = parseAiApiKeyCredential(
            cipher.decryptJson(provider.encrypted_credential)
          );
          if (!credential) {
            throw new Error("missing api key");
          }
          apiKey = credential.apiKey;
        } catch {
          throw new HttpError(503, "Chat model credential is not configured");
        }

        const personaBlock = renderPersonaText({
          assistantName: input.assistantName,
          personaText: input.personaText,
          userName: input.userName
        });
        const adapter = new HttpApiAdapter(model.provider_kind as ProviderKind, apiKey, {
          baseUrl: provider.base_url ?? undefined
        });
        const { text } = await adapter.generateChat({
          model: {
            provider_kind: model.provider_kind,
            provider_model_id: model.provider_model_id
          },
          messages: [
            {
              role: "user",
              content: `${personaBlock}\n\n${PERSONA_PREVIEW_SAMPLE_TURN}`
            }
          ],
          maxOutputTokens: PERSONA_PREVIEW_MAX_OUTPUT_TOKENS
        });
        return text;
      }
    );
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
        revokeUserSessions: deps.revokeUserSessions,
        meSessions: deps.meSessions,
        verifySelfPassword: deps.verifySelfPassword,
        hasPasswordCredential: deps.hasPasswordCredential,
        bootstrapConnectionString: deps.bootstrapConnectionString,
        chatMultiplexerAvailability: deps.chatMultiplexerAvailability,
        hostDiagnostics: deps.hostDiagnostics,
        onboardingProbes: deps.onboardingProbes,
        onboardingInstall: deps.onboardingInstall,
        onboardingLogin: deps.onboardingLogin,
        personaPreview: deps.personaPreview ?? createDefaultPersonaPreview(deps.dataContext),
        preferencesRepository: new PreferencesRepository(),
        boss: deps.boss,
        // #449: wire the per-actor 15-min notes-sync heartbeat. Injected as a hook
        // (not imported in @jarv1s/settings) because @jarv1s/notes already depends
        // on @jarv1s/settings for resolveNotesRoots — a direct import would cycle.
        reconcileNotesSchedule: deps.boss
          ? (actorUserId, hasPath) => reconcileNotesSchedule(deps.boss!, actorUserId, hasPath)
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
      setWebSearchKeyResolver((scopedDb) =>
        readBraveSearchApiKey(scopedDb as DataContextDb, webSearchCipher)
      );
    },
    registerWorkers: (boss, deps) => registerSettingsJobWorkers(boss, deps.dataContext)
  },
  {
    manifest: connectorsModuleManifest,
    sqlMigrationDirectories: [connectorsModuleSqlMigrationDirectory],
    queueDefinitions: GOOGLE_SYNC_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerConnectorsRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        boss: deps.boss
      }),
    registerWorkers: (boss, deps) =>
      registerConnectorsJobWorkers(boss, { dataContext: deps.dataContext })
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
        focusSignals: deps.focusSignals
      }),
    registerWorkers: (boss, dependencies) => registerTasksJobWorkers(boss, dependencies.dataContext)
  },
  {
    manifest: webModuleManifest,
    sqlMigrationDirectories: [],
    queueDefinitions: []
  },
  {
    manifest: notificationsModuleManifest,
    sqlMigrationDirectories: [notificationsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerNotificationsRoutes
  },
  {
    manifest: calendarModuleManifest,
    sqlMigrationDirectories: [calendarModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerCalendarRoutes
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
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerAiRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        resolveActiveModules: deps.resolveActiveModules
      })
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
        googleConnectionService: deps.googleConnectionService,
        googleApiClient: deps.googleApiClient,
        connectorsRepository: deps.connectorsRepository
      }),
    registerWorkers: (boss, deps) =>
      registerChatJobWorkers(boss, deps.dataContext, {
        embeddingProvider: deps.embeddingProvider,
        extractFactsDeps: {
          aiRepository: new AiRepository(),
          cipher: createAiSecretCipher(),
          factsRepository: new ChatMemoryFactsRepository()
        }
      })
  },
  {
    manifest: briefingsModuleManifest,
    sqlMigrationDirectories: [briefingsModuleSqlMigrationDirectory],
    queueDefinitions: BRIEFINGS_QUEUE_DEFINITIONS,
    registerRoutes: registerBriefingsRoutes,
    registerWorkers: (boss, dependencies) =>
      registerBriefingsJobWorkers(boss, dependencies.dataContext, {
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
          memoryRetriever: new MemoryRetriever(
            dependencies.embeddingProvider,
            new MemoryRepository()
          )
        },
        notificationsRepository: new NotificationsRepository(quietHoursPortImpl)
      })
  },
  {
    manifest: memoryModuleManifest,
    sqlMigrationDirectories: [memorySqlMigrationDirectory],
    queueDefinitions: []
  },
  {
    manifest: structuredStateModuleManifest,
    sqlMigrationDirectories: [structuredStateSqlMigrationDirectory],
    queueDefinitions: []
  },
  {
    manifest: wellnessModuleManifest,
    sqlMigrationDirectories: [wellnessModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerWellnessRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext
      })
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
        embeddingProvider: deps.embeddingProvider,
        preferencesRepository: new PreferencesRepository()
      })
  }
];

// Compat gate (ADR 0009 §3): validate every built-in's compatibility.jarv1s against
// CORE_VERSION at load time, before any registration path runs. Throws if a module is
// incompatible or not defaultEnabled, naming the offender.
assertModulesCompatible(BUILT_IN_MODULES.map((module) => module.manifest));
assertModuleRegistryConsistency(BUILT_IN_MODULES);

export function assertModuleRegistryConsistency(
  registrations: readonly BuiltInModuleRegistration[] = BUILT_IN_MODULES
): void {
  const moduleIds = new Map<string, string>();
  const queueNames = new Map<string, string>(
    FOUNDATION_QUEUES.map((queue) => [queue.name, "foundation"])
  );
  const routeKeys = new Map<string, string>();
  const ownedTables = new Map<string, string>();

  for (const registration of registrations) {
    const moduleId = registration.manifest.id;

    assertUniqueRegistryKey(moduleIds, moduleId, moduleId, "module id");

    for (const queue of registration.queueDefinitions) {
      assertUniqueRegistryKey(queueNames, queue.name, moduleId, "queue name");
    }

    for (const route of registration.manifest.routes ?? []) {
      assertUniqueRegistryKey(routeKeys, `${route.method} ${route.path}`, moduleId, "route");
    }

    for (const table of registration.manifest.database?.ownedTables ?? []) {
      assertUniqueRegistryKey(ownedTables, table, moduleId, "owned table");
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
  const availability = probeChatMultiplexerAvailability(env);

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
    chatMultiplexerAvailability: availability,
    onboardingProbes,
    onboardingInstall,
    onboardingLogin,
    // Surface a setter so the chat runtime (constructed inside registerChatRoutes) can publish the ONE
    // RPC connection it owns back to the probes + the boot lifecycle below. On the RPC path the runtime
    // wires reconcile + the idle reaper onto this connection; here we only need the handle to route
    // probes through it and to ensureConnected()/close() it at the composition-root boundary.
    adoptChatRpcConnection: (connection: RpcConnection) => {
      rpcConnection = connection;
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
