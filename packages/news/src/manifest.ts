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
import {
  newsAddExclusionExecute,
  newsAddTopicExecute,
  newsConfirmSourceExecute,
  newsPreviewSourceExecute,
  newsRemoveSourceExecute,
  newsRemoveTopicExecute,
  summarizeNewsAddExclusion,
  summarizeNewsAddTopic,
  summarizeNewsConfirmSource,
  summarizeNewsRemoveSource,
  summarizeNewsRemoveTopic
} from "./chat-tools.js";
import { collectNewsExportSection } from "./data-lifecycle.js";
import type { NEWS_MODULE_ID } from "./module-id.js";
import { NEWS_FETCH_HOSTS, NEWS_IMAGE_HOSTS } from "./source/catalog.js";

export { NEWS_MODULE_ID } from "./module-id.js";

// Publisher front pages churn on roughly this cadence; matches sports' standings/headlines TTL
// (docs/superpowers/specs/2026-07-08-news-module.md "Caching").
const FEED_TTL_MS = 10 * 60 * 1000;

export const newsModuleSqlMigrationDirectory = fileURLToPath(new URL("../sql", import.meta.url));

export const newsModuleManifest = {
  // Inline literal, not the imported NEWS_MODULE_ID: the settings-ui scanner reads this
  // file statically and resolves only same-file constants, so an imported identifier makes
  // the web scan throw and the settings scan silently drop this module. `satisfies` pins
  // the literal to module-id.ts at compile time so the two can never drift (#975 Slice 4).
  id: "news" satisfies typeof NEWS_MODULE_ID,
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
    },
    // #975 Slice 4 — chat preview/confirm for custom sources. Same two-phase shape as the
    // REST settings flow: preview verifies and stores candidates server-side; confirm writes.
    {
      name: "news.previewSource",
      description:
        "Verify a news publisher (URL or name) the actor wants to follow. Returns a confirmationId plus verified candidates (label + domain) for news.confirmSource. Read-only: verifies and caches candidates server-side, writes nothing.",
      permissionId: "news.prefs",
      risk: "read",
      // Candidate labels are derived from fetched publisher pages/feeds — untrusted
      // external text, so the gateway wraps output in the trust envelope.
      externalContent: true,
      inputSchema: {
        type: "object",
        properties: {
          source: {
            type: "string",
            description: "Publisher homepage/feed URL, bare domain, or publisher name"
          }
        },
        required: ["source"]
      },
      execute: newsPreviewSourceExecute
    },
    {
      name: "news.confirmSource",
      description:
        "Add a previously previewed publisher as a followed custom news source. Requires the confirmationId from news.previewSource plus the chosen candidate's label and domain exactly as previewed.",
      permissionId: "news.prefs",
      // Write risk with NO actionFamilyId: this tool can never be promoted to
      // auto-approve — every call goes through the blocking owner confirmation.
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          confirmationId: { type: "string" },
          candidateId: {
            type: "string",
            description: "Required when the preview returned more than one candidate"
          },
          label: { type: "string", description: "Candidate label exactly as previewed" },
          domain: { type: "string", description: "Candidate domain exactly as previewed" }
        },
        required: ["confirmationId", "label", "domain"]
      },
      summarize: summarizeNewsConfirmSource,
      execute: newsConfirmSourceExecute
    },
    // #975 Task 8 — remaining personalization writes. All four: write risk with NO
    // actionFamilyId (never auto-approvable — every call blocks on owner confirmation),
    // summaries derived from tool INPUT only (execute hasn't run at prompt time).
    {
      name: "news.removeSource",
      description:
        "Stop following a custom news source. Requires the source id (list them via the news personalization surface first). Removal also prunes the source's articles from the current briefing.",
      permissionId: "news.prefs",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          sourceId: { type: "string", description: "Id of the followed custom source to remove" }
        },
        required: ["sourceId"]
      },
      summarize: summarizeNewsRemoveSource,
      execute: newsRemoveSourceExecute
    },
    {
      name: "news.addTopic",
      description:
        "Follow a custom news topic (e.g. 'local climate policy'). The topic is policy-checked before it is added; optional guidance steers article selection.",
      permissionId: "news.prefs",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short human-readable topic label" },
          guidance: {
            type: "string",
            description: "Optional steering for article selection within the topic"
          }
        },
        required: ["label"]
      },
      summarize: summarizeNewsAddTopic,
      execute: newsAddTopicExecute
    },
    {
      name: "news.removeTopic",
      description: "Stop following a custom news topic. Requires the topic id.",
      permissionId: "news.prefs",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          topicId: { type: "string", description: "Id of the followed custom topic to remove" }
        },
        required: ["topicId"]
      },
      summarize: summarizeNewsRemoveTopic,
      execute: newsRemoveTopicExecute
    },
    {
      name: "news.addExclusion",
      description:
        "Exclude a news publisher domain from the actor's briefing (also hides its subdomains). Excluded articles are pruned from the current briefing immediately.",
      permissionId: "news.prefs",
      risk: "write",
      inputSchema: {
        type: "object",
        properties: {
          domain: {
            type: "string",
            description: "Publisher domain to exclude, e.g. example.com"
          }
        },
        required: ["domain"]
      },
      summarize: summarizeNewsAddExclusion,
      execute: newsAddExclusionExecute
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
