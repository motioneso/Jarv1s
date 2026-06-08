import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type { PgBoss } from "pg-boss";

import { aiModuleManifest, aiModuleSqlMigrationDirectory, registerAiRoutes } from "@jarv1s/ai";
import { memoryModuleManifest, memorySqlMigrationDirectory } from "@jarv1s/memory";
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
  chatModuleManifest,
  chatModuleSqlMigrationDirectory,
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
import { registerSettingsRoutes, settingsModuleManifest } from "@jarv1s/settings";
import {
  TASKS_QUEUE_DEFINITIONS,
  registerTasksJobWorkers,
  registerTasksRoutes,
  tasksModuleManifest,
  tasksModuleSqlMigrationDirectory
} from "@jarv1s/tasks";

export type { ChatEngineFactory } from "@jarv1s/chat";

export interface BuiltInRouteDependencies {
  readonly appDb: Kysely<JarvisDatabase>;
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly listConfiguredAuthProviders: () => readonly AuthProviderStatusDto[];
  readonly listModuleManifests: () => readonly JarvisModuleManifest[];
  readonly dataContext: DataContextRunner;
  readonly boss: PgBoss;
  /** Override the live-chat engine factory (tests inject a fake); defaults to real tmux. */
  readonly chatEngineFactory?: ChatEngineFactory;
}

export interface BuiltInWorkerDependencies {
  readonly dataContext: DataContextRunner;
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
    sqlMigrationDirectories: [],
    queueDefinitions: [],
    registerRoutes: registerSettingsRoutes
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
    queueDefinitions: [],
    registerRoutes: registerChatRoutes
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
  for (const module of BUILT_IN_MODULES) {
    module.registerRoutes?.(server, dependencies);
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
