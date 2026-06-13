import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { aiModuleManifest, aiModuleSqlMigrationDirectory, registerAiRoutes } from "@jarv1s/ai";
import {
  memoryModuleManifest,
  memorySqlMigrationDirectory,
  type EmbeddingProvider
} from "@jarv1s/memory";
import {
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
  connectorsModuleManifest,
  connectorsModuleSqlMigrationDirectory,
  registerConnectorsRoutes
} from "@jarv1s/connectors";
import type { AccessContext, DataContextRunner, JarvisDatabase } from "@jarv1s/db";
import {
  emailModuleManifest,
  emailModuleSqlMigrationDirectory,
  registerEmailRoutes
} from "@jarv1s/email";
import { FOUNDATION_QUEUES, type QueueDefinition } from "@jarv1s/jobs";
import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  notificationsModuleManifest,
  notificationsModuleSqlMigrationDirectory,
  registerNotificationsRoutes
} from "@jarv1s/notifications";
import type { AuthProviderStatusDto } from "@jarv1s/shared";
import {
  registerSettingsRoutes,
  settingsModuleManifest,
  settingsModuleSqlMigrationDirectory
} from "@jarv1s/settings";
import {
  TASKS_QUEUE_DEFINITIONS,
  registerTasksJobWorkers,
  registerTasksRoutes,
  tasksModuleManifest,
  tasksModuleSqlMigrationDirectory
} from "@jarv1s/tasks";

import { assertModulesCompatible } from "./compat-gate.js";
import { probeChatMultiplexerAvailability, resolveChatEngineFactory } from "./chat-multiplexer.js";

export type { ChatEngineFactory } from "@jarv1s/chat";

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
  // Raw root handle forwarded to settings' BootstrapHelper (pre-session countUsers).
  // Documented Kysely< exemption — see packages/settings/src/bootstrap.ts. This is the
  // ONLY root-handle escape hatch in the route layer; module admin checks run through
  // DataContextDb (connectors' admin check was converted off appDb in Audit B3) — plus
  // the bounded pre-auth non-secret instance-config reads documented in
  // DEVELOPMENT_STANDARDS.md (registration gate + `chat.multiplexer` boot resolution).
  readonly rootDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders: () => readonly AuthProviderStatusDto[];
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
  readonly revokeUserSessions?: (userId: string) => Promise<number>;
  readonly bootstrapConnectionString?: string;
  /** Boot-time multiplexer availability snapshot for the admin settings UI. */
  readonly chatMultiplexerAvailability?: { readonly tmux: boolean; readonly herdr: boolean };
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
        bootstrapConnectionString: deps.bootstrapConnectionString,
        chatMultiplexerAvailability: deps.chatMultiplexerAvailability
      })
  },
  {
    manifest: connectorsModuleManifest,
    sqlMigrationDirectories: [connectorsModuleSqlMigrationDirectory],
    queueDefinitions: [],
    registerRoutes: registerConnectorsRoutes
  },
  {
    manifest: tasksModuleManifest,
    sqlMigrationDirectories: [tasksModuleSqlMigrationDirectory],
    queueDefinitions: TASKS_QUEUE_DEFINITIONS,
    registerRoutes: registerTasksRoutes,
    registerWorkers: (boss, dependencies) => registerTasksJobWorkers(boss, dependencies.dataContext)
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
    registerRoutes: registerAiRoutes
  },
  {
    manifest: chatModuleManifest,
    sqlMigrationDirectories: [chatModuleSqlMigrationDirectory],
    queueDefinitions: CHAT_QUEUE_DEFINITIONS,
    registerRoutes: (server, deps) =>
      registerChatRoutes(server, {
        resolveAccessContext: deps.resolveAccessContext,
        dataContext: deps.dataContext,
        chatEngineFactory: deps.chatEngineFactory,
        // Task 5 made ActiveModulesResolver async; the real DB-backed resolver lands in
        // Task 6. Until then, adapt the sync manifest list to the async resolver shape so
        // the live surface is byte-for-byte unchanged (every built-in active).
        resolveActiveModules: async () => deps.listModuleManifests(),
        mcpServerUrl: `http://127.0.0.1:${process.env.PORT ?? 3000}/api/mcp`,
        boss: deps.boss
      }),
    registerWorkers: (boss, deps) =>
      registerChatJobWorkers(boss, deps.dataContext, { embeddingProvider: deps.embeddingProvider })
  },
  {
    manifest: briefingsModuleManifest,
    sqlMigrationDirectories: [briefingsModuleSqlMigrationDirectory],
    queueDefinitions: BRIEFINGS_QUEUE_DEFINITIONS,
    registerRoutes: registerBriefingsRoutes,
    registerWorkers: (boss, dependencies) =>
      registerBriefingsJobWorkers(boss, dependencies.dataContext, {
        moduleManifests: getBuiltInModuleManifests()
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
  }
];

// Compat gate (ADR 0009 §3): validate every built-in's compatibility.jarv1s against
// CORE_VERSION at load time, before any registration path runs. Throws if a module is
// incompatible or not defaultEnabled, naming the offender.
assertModulesCompatible(BUILT_IN_MODULES.map((module) => module.manifest));

export function getBuiltInModuleRegistrations(): readonly BuiltInModuleRegistration[] {
  return BUILT_IN_MODULES;
}

export function getBuiltInModuleManifests(): readonly JarvisModuleManifest[] {
  return BUILT_IN_MODULES.map((module) => module.manifest);
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

  const deps: BuiltInRouteDependencies = {
    ...dependencies,
    chatEngineFactory,
    chatMultiplexerAvailability: availability
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
