import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import {
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
  type ChatEngineFactory
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
  registerNotificationsRoutes
} from "@jarv1s/notifications";
import {
  renderPersonaText,
  type AuthProviderStatusDto,
  type OnboardingProviderCheckResponse,
  type OnboardingProviderKind
} from "@jarv1s/shared";
import {
  registerSettingsRoutes,
  settingsModuleManifest,
  settingsModuleSqlMigrationDirectory,
  type HostDiagnosticsProvider,
  type MeSessionsService,
  type PersonaPreviewInput
} from "@jarv1s/settings";
import {
  TASKS_QUEUE_DEFINITIONS,
  registerTasksJobWorkers,
  registerTasksRoutes,
  tasksModuleManifest,
  tasksModuleSqlMigrationDirectory
} from "@jarv1s/tasks";
import { webModuleManifest } from "@jarv1s/web-research";
import {
  registerWellnessRoutes,
  wellnessModuleManifest,
  wellnessModuleSqlMigrationDirectory
} from "@jarv1s/wellness";

import { assertModulesCompatible } from "./compat-gate.js";
import {
  makeCliPresentProbe,
  makeMultiplexerUsableProbe,
  makeProviderConnectionCheckProbe,
  probeChatMultiplexerAvailability,
  resolveChatEngineFactory
} from "./chat-multiplexer.js";

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
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  /** Auth-owned current-user session list/revoke service (#237). */
  readonly meSessions?: MeSessionsService;
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
    readonly multiplexerUsable: (kind: "tmux" | "herdr") => Promise<boolean>;
    readonly cliPresent: (kind: OnboardingProviderKind) => Promise<boolean>;
    readonly testProviderConnection: (
      kind: OnboardingProviderKind
    ) => Promise<OnboardingProviderCheckResponse>;
    readonly connectorAccountExists: (scopedDb: DataContextDb) => Promise<boolean>;
  };
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
    queueDefinitions: [],
    registerRoutes: (server, deps) =>
      registerSettingsRoutes(server, {
        rootDb: deps.rootDb,
        dataContext: deps.dataContext,
        resolveAccessContext: deps.resolveAccessContext,
        listConfiguredAuthProviders: deps.listConfiguredAuthProviders,
        listModuleManifests: deps.listModuleManifests,
        revokeUserSessions: deps.revokeUserSessions,
        meSessions: deps.meSessions,
        bootstrapConnectionString: deps.bootstrapConnectionString,
        chatMultiplexerAvailability: deps.chatMultiplexerAvailability,
        hostDiagnostics: deps.hostDiagnostics,
        onboardingProbes: deps.onboardingProbes,
        personaPreview: deps.personaPreview ?? createDefaultPersonaPreview(deps.dataContext),
        preferencesRepository: new PreferencesRepository()
      })
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
        chatEngineFactory: deps.chatEngineFactory,
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
        notificationsRepository: new NotificationsRepository()
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

  // Onboarding probes: built synchronously (no boot-time probing) and forwarded to the
  // settings module. Each function probes lazily, per request, bounded by a short timeout.
  const multiplexerUsable = makeMultiplexerUsableProbe(env);
  const cliPresent = makeCliPresentProbe();

  // The factory is resolved asynchronously in onReady (a settings read), but routes
  // register synchronously. Bridge with a late-bound wrapper: it is only ever invoked
  // when a chat session launches, which is strictly after onReady. Tests/embedders
  // that pass an explicit chatEngineFactory bypass resolution entirely.
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
    multiplexerUsable,
    cliPresent,
    testProviderConnection: makeProviderConnectionCheckProbe({
      engineFactory: chatEngineFactory,
      cliPresent,
      skipInstallCheck: dependencies.chatEngineFactory !== undefined
    }),
    connectorAccountExists: async (scopedDb: DataContextDb) =>
      (await new ConnectorsRepository().listAccounts(scopedDb)).length > 0
  };

  const deps: BuiltInRouteDependencies = {
    ...dependencies,
    chatEngineFactory,
    chatMultiplexerAvailability: availability,
    onboardingProbes
  };

  for (const module of BUILT_IN_MODULES) {
    module.registerRoutes?.(server, deps);
  }

  if (!dependencies.chatEngineFactory) {
    server.addHook("onReady", async () => {
      resolvedChatFactory = await resolveChatEngineFactory({
        appDb: dependencies.rootDb,
        env,
        log: (msg) => server.log.info(msg)
      });
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
