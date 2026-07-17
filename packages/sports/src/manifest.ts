import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  createSportsFollowRequestSchema,
  createSportsFollowResponseSchema,
  deleteSportsFollowResponseSchema,
  sportsCatalogResponseSchema,
  sportsFollowsResponseSchema,
  sportsLeagueTeamsResponseSchema,
  sportsOverviewResponseSchema,
  sportsStandingsResponseSchema,
  sportsTeamSearchResponseSchema
} from "@jarv1s/shared";

import { sportsFollowedFactsTodayExecute } from "./briefing-tool.js";
import { ESPN_FETCH_HOSTS, ESPN_IMAGE_HOSTS } from "./source/espn-source.js";

export const SPORTS_MODULE_ID = "sports";

// Same cadence as the pre-connector-SDK `SportsCache` TTL constants (now retired) — this slice
// is a mechanical migration, not a behavior change (docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md).
const TEAMS_TTL_MS = 24 * 60 * 60 * 1000;
const SCOREBOARD_TTL_MS = 3 * 60 * 1000;
const STANDINGS_HEADLINES_SCHEDULE_TTL_MS = 10 * 60 * 1000;
// A published article's body is effectively immutable, so it caches far longer than the feed that
// surfaces it — one fetch per featured article, not per overview (#857). The cache key includes the
// article id, so a new feature just misses and fetches its own body.
const ARTICLE_BODY_TTL_MS = 6 * 60 * 60 * 1000;

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
      description: "Follow scores, schedules, and standings for selected teams.",
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
      description: "Choose the teams and leagues shown in Sports.",
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
      path: "/api/sports/leagues/:competitionKey/teams",
      responseSchema: sportsLeagueTeamsResponseSchema,
      permissionId: "sports.view"
    },
    {
      method: "GET",
      path: "/api/sports/teams/search",
      responseSchema: sportsTeamSearchResponseSchema,
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
      path: "/api/sports/standings",
      responseSchema: sportsStandingsResponseSchema,
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
  },
  externalSources: [
    {
      id: "espn",
      displayName: "ESPN",
      credential: "none",
      fetchHosts: ESPN_FETCH_HOSTS,
      imageHosts: ESPN_IMAGE_HOSTS,
      datasets: [
        { key: "teams", ttlMs: TEAMS_TTL_MS, staleness: "degrade-empty" },
        { key: "scoreboard", ttlMs: SCOREBOARD_TTL_MS, staleness: "degrade-empty" },
        {
          key: "standings",
          ttlMs: STANDINGS_HEADLINES_SCHEDULE_TTL_MS,
          staleness: "degrade-empty"
        },
        {
          key: "headlines",
          ttlMs: STANDINGS_HEADLINES_SCHEDULE_TTL_MS,
          staleness: "degrade-empty"
        },
        { key: "schedule", ttlMs: STANDINGS_HEADLINES_SCHEDULE_TTL_MS, staleness: "degrade-empty" },
        // Per-article body for the NewsBand featured hero (#857). MUST be declared here or the
        // dataset runtime throws "Unknown dataset" the moment the service requests it, 500ing the
        // whole overview — the adapter handling the key is not enough on its own.
        { key: "articleBody", ttlMs: ARTICLE_BODY_TTL_MS, staleness: "degrade-empty" }
      ]
    }
  ]
} satisfies JarvisModuleManifest;
