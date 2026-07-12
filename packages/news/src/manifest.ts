import { fileURLToPath } from "node:url";

import type { JarvisModuleManifest } from "@jarv1s/module-sdk";
import {
  confirmNewsSourceSchema,
  createNewsPrefRequestSchema,
  createNewsPrefResponseSchema,
  createNewsSourceExclusionSchema,
  createNewsTopicSchema,
  deleteNewsCustomSourceSchema,
  deleteNewsPrefResponseSchema,
  deleteNewsSourceExclusionSchema,
  deleteNewsTopicSchema,
  getNewsPersonalizationSchema,
  newsCatalogResponseSchema,
  newsOverviewResponseSchema,
  newsPrefsResponseSchema,
  previewNewsSourceSchema,
  triggerNewsRefreshSchema,
  triggerNewsRevalidationSchema,
  updateNewsTopicSchema
} from "@jarv1s/shared";

import { newsTopHeadlinesTodayExecute } from "./briefing-tool.js";
import { collectNewsExportSection } from "./data-lifecycle.js";
import { NEWS_FETCH_HOSTS, NEWS_IMAGE_HOSTS } from "./source/catalog.js";

export const NEWS_MODULE_ID = "news";

// Publisher front pages churn on roughly this cadence; matches sports' standings/headlines TTL
// (docs/superpowers/specs/2026-07-08-news-module.md "Caching").
const FEED_TTL_MS = 10 * 60 * 1000;

export const newsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const newsModuleManifest = {
  id: NEWS_MODULE_ID,
  name: "News",
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
    migrations: [
      "sql/0151_news_prefs.sql",
      "sql/0159_news_personalization.sql",
      "sql/0160_news_discovery.sql",
      // #975 Slice 4 — column-scoped worker UPDATE grants for provider-change revalidation.
      "sql/0161_news_revalidation.sql"
    ],
    migrationDirectories: ["packages/news/sql"],
    ownedTables: [
      "app.news_prefs",
      // #953 Slice 1 personalization tables — owner-only FORCE RLS, no worker grants.
      "app.news_custom_sources",
      "app.news_custom_topics",
      "app.news_source_exclusions",
      "app.news_compilation_snapshots",
      "app.news_refresh_state",
      "app.news_policy_verdicts"
    ]
  },
  navigation: [
    {
      id: "news",
      label: "News",
      path: "/news",
      icon: "newspaper",
      order: 34,
      permissionId: "news.view"
    }
  ],
  settings: [
    {
      id: "news.prefs",
      label: "News",
      path: "/settings/modules/news",
      scope: "user",
      order: 34,
      permissionId: "news.view",
      entry: "./settings"
    }
  ],
  permissions: [
    {
      id: "news.view",
      label: "View news",
      description:
        "Read the active actor's news source/topic preferences and public headlines from the curated feed catalog.",
      scope: "user",
      actions: ["view"]
    },
    {
      id: "news.prefs",
      label: "Manage news preferences",
      description:
        "Create and delete the active actor's own news source and topic preferences, including excluded publisher domains.",
      scope: "user",
      actions: ["create", "delete"]
    }
  ],
  routes: [
    {
      method: "GET",
      path: "/api/news/catalog",
      responseSchema: newsCatalogResponseSchema,
      permissionId: "news.view"
    },
    {
      method: "GET",
      path: "/api/news/overview",
      responseSchema: newsOverviewResponseSchema,
      permissionId: "news.view"
    },
    {
      method: "GET",
      path: "/api/news/prefs",
      responseSchema: newsPrefsResponseSchema,
      permissionId: "news.view"
    },
    {
      method: "POST",
      path: "/api/news/prefs",
      requestSchema: createNewsPrefRequestSchema,
      responseSchema: createNewsPrefResponseSchema,
      permissionId: "news.prefs"
    },
    {
      method: "DELETE",
      path: "/api/news/prefs/:id",
      responseSchema: deleteNewsPrefResponseSchema,
      permissionId: "news.prefs"
    },
    // #953 Slice 1 personalization: reads under news.view, exclusion writes under news.prefs.
    {
      method: "GET",
      path: "/api/news/personalization",
      responseSchema: getNewsPersonalizationSchema,
      permissionId: "news.view"
    },
    {
      method: "POST",
      path: "/api/news/source-exclusions",
      requestSchema: createNewsSourceExclusionSchema.body,
      responseSchema: createNewsSourceExclusionSchema,
      permissionId: "news.prefs"
    },
    {
      method: "DELETE",
      path: "/api/news/source-exclusions/:id",
      responseSchema: deleteNewsSourceExclusionSchema,
      permissionId: "news.prefs"
    },
    {
      method: "POST",
      path: "/api/news/sources/preview",
      requestSchema: previewNewsSourceSchema.body,
      responseSchema: previewNewsSourceSchema,
      permissionId: "news.prefs"
    },
    {
      method: "POST",
      path: "/api/news/sources",
      requestSchema: confirmNewsSourceSchema.body,
      responseSchema: confirmNewsSourceSchema,
      permissionId: "news.prefs"
    },
    {
      method: "DELETE",
      path: "/api/news/sources/:id",
      responseSchema: deleteNewsCustomSourceSchema,
      permissionId: "news.prefs"
    },
    {
      method: "POST",
      path: "/api/news/topics",
      requestSchema: createNewsTopicSchema.body,
      responseSchema: createNewsTopicSchema,
      permissionId: "news.prefs"
    },
    {
      method: "PATCH",
      path: "/api/news/topics/:id",
      requestSchema: updateNewsTopicSchema.body,
      responseSchema: updateNewsTopicSchema,
      permissionId: "news.prefs"
    },
    {
      method: "DELETE",
      path: "/api/news/topics/:id",
      responseSchema: deleteNewsTopicSchema,
      permissionId: "news.prefs"
    },
    {
      method: "POST",
      path: "/api/news/refresh",
      responseSchema: triggerNewsRefreshSchema,
      permissionId: "news.prefs"
    },
    {
      method: "POST",
      path: "/api/news/revalidation",
      responseSchema: triggerNewsRevalidationSchema,
      permissionId: "news.prefs"
    },
    {
      method: "GET",
      path: "/api/news/images/:articleId",
      permissionId: "news.view"
    }
  ],
  assistantTools: [
    {
      name: "news.topHeadlinesToday",
      description:
        "List the actor's top news headlines right now (one short 'Title — Source' line, max 5), composed from their enabled sources and topics. Read-only; briefing-oriented, not a full article browser.",
      permissionId: "news.view",
      risk: "read",
      inputSchema: { type: "object", properties: {} },
      execute: newsTopHeadlinesTodayExecute
    }
  ],
  dataLifecycle: {
    // #953 Task 6: user-authored personalization (custom sources/topics, exclusions) is
    // exported; curated news_prefs stay out (catalog references, reproducible from settings)
    // and compilation snapshots stay out (derived cache, exportable-never — deletion-only).
    exportSections: [
      {
        key: "newsPersonalization",
        displayName: "News personalization",
        collect: collectNewsExportSection
      }
    ],
    deletion: {
      strategy: "cascade",
      tables: [
        { table: "app.news_prefs" },
        // #953 Slice 1 — all four personalization tables key on app.users ON DELETE CASCADE.
        // Snapshots are derived data: deleted with the user, never exported (Task 6 adds the
        // export sections for sources/topics/exclusions only).
        { table: "app.news_custom_sources" },
        { table: "app.news_custom_topics" },
        { table: "app.news_source_exclusions" },
        { table: "app.news_compilation_snapshots" },
        { table: "app.news_refresh_state" },
        { table: "app.news_policy_verdicts" }
      ]
    }
  },
  externalSources: [
    {
      id: "newsfeeds",
      displayName: "News feeds",
      credential: "none",
      fetchHosts: NEWS_FETCH_HOSTS,
      imageHosts: NEWS_IMAGE_HOSTS,
      datasets: [
        // Single dataset keyed by { sourceKey, topicKey|null }. MUST be declared here or the
        // dataset runtime throws "Unknown dataset" the moment the service requests it, 500ing
        // the whole overview — the adapter handling the key is not enough on its own.
        { key: "feed", ttlMs: FEED_TTL_MS, staleness: "degrade-empty" }
      ]
    }
  ]
} satisfies JarvisModuleManifest;
