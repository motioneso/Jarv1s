import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  createSportsFollowRequestSchema,
  createSportsFollowResponseSchema,
  deleteSportsFollowResponseSchema,
  sportsCatalogResponseSchema,
  sportsFollowsResponseSchema,
  sportsOverviewResponseSchema
} from "@jarv1s/shared";

import { sportsFollowedFactsTodayExecute } from "./briefing-tool.js";

export const SPORTS_MODULE_ID = "sports";

export const sportsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const sportsModuleManifest = {
  id: SPORTS_MODULE_ID,
  name: "Sports",
  version: "0.1.0",
  publisher: "jarv1s",
  lifecycle: "user-toggleable",
  compatibility: {
    jarv1s: ">=0.0.0"
  },
  availability: {
    defaultEnabled: true,
    required: false,
    supportsUserDisable: true
  },
  database: {
    migrations: ["sql/0133_sports_follows.sql"],
    migrationDirectories: ["packages/sports/sql"],
    ownedTables: ["app.sports_follows"]
  },
  navigation: [
    {
      id: "sports",
      label: "Sports",
      path: "/sports",
      icon: "trophy",
      order: 35,
      permissionId: "sports.view"
    }
  ],
  settings: [
    {
      id: "sports.follows",
      label: "Sports",
      path: "/settings/modules/sports",
      scope: "user",
      order: 35,
      permissionId: "sports.view",
      entry: "./settings"
    }
  ],
  permissions: [
    {
      id: "sports.view",
      label: "View sports",
      description: "Read the active actor's followed competitions/teams and public sports data.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "sports.follow",
      label: "Manage sports follows",
      description: "Create and delete the active actor's own sports follows.",
      scope: "user",
      actions: ["create", "delete"]
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/sports/catalog",
      responseSchema: sportsCatalogResponseSchema,
      permissionId: "sports.view"
    },
    {
      method: "GET",
      path: "/api/sports/overview",
      responseSchema: sportsOverviewResponseSchema,
      permissionId: "sports.view"
    },
    {
      method: "GET",
      path: "/api/sports/follows",
      responseSchema: sportsFollowsResponseSchema,
      permissionId: "sports.view"
    },
    {
      method: "POST",
      path: "/api/sports/follows",
      requestSchema: createSportsFollowRequestSchema,
      responseSchema: createSportsFollowResponseSchema,
      permissionId: "sports.follow"
    },
    {
      method: "DELETE",
      path: "/api/sports/follows/:id",
      responseSchema: deleteSportsFollowResponseSchema,
      permissionId: "sports.follow"
    }
  ],
  assistantTools: [
    {
      name: "sports.followedFactsToday",
      description:
        "List compact, non-sensitive facts about the actor's followed teams/competitions playing today (one short line per follow). Read-only; briefing-oriented, not a live scores/schedule browser.",
      permissionId: "sports.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: sportsFollowedFactsTodayExecute
    }
  ],
  dataLifecycle: {
    // Sports has no full-account export data today (follows are catalog references, not
    // exported); declared explicitly per the parity assertion (owned tables + no export
    // sections still requires an explicit empty exportSections).
    exportSections: [],
    deletion: {
      strategy: "cascade",
      tables: [{ table: "app.sports_follows" }]
    }
  }
} satisfies JarvisModuleManifest;
