// packages/shared/src/news-api.ts — BROWSER-SAFE. No node:* imports.
import { errorResponseSchema } from "./schema-fragments.js";

/** Cross-source topic vocabulary; each source maps topics to its own feeds (see news catalog). */
export type NewsTopicKey =
  | "world"
  | "us"
  | "politics"
  | "business"
  | "technology"
  | "science"
  | "health"
  | "culture";

export const NEWS_TOPIC_KEYS: readonly NewsTopicKey[] = [
  "world",
  "us",
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "culture"
];

export interface NewsTopicOption {
  readonly topicKey: NewsTopicKey;
  readonly label: string;
}

export interface NewsCatalogSource {
  readonly sourceKey: string;
  readonly label: string;
  readonly homepageUrl: string;
  /** Enabled for users with no explicit `source` prefs. */
  readonly defaultEnabled: boolean;
  /** Topics this source has a dedicated feed for (empty = top-feed only). */
  readonly topics: readonly NewsTopicKey[];
}

export interface NewsCatalogResponse {
  readonly sources: readonly NewsCatalogSource[];
  readonly topics: readonly NewsTopicOption[];
}

export interface NewsHeadline {
  /** Stable content hash of the article URL (dedupe + React keys). */
  readonly id: string;
  readonly sourceKey: string;
  readonly sourceLabel: string;
  /** Topic feed the item came from; null when it came from a source's top feed. */
  readonly topicKey: string | null;
  readonly topicLabel: string | null;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string | null; // ISO instant; null when the feed omitted/garbled it
  readonly imageUrl: string | null; // https + allow-listed host only, else null
  readonly summary: string; // sanitized plaintext, "" when absent
}

export interface NewsSourceGroup {
  readonly sourceKey: string;
  readonly sourceLabel: string;
  readonly homepageUrl: string;
  readonly headlines: readonly NewsHeadline[];
}

export interface NewsOverviewResponse {
  /** Cross-source ranked selection (weight then recency; see packages/news/src/ranking.ts). */
  readonly topStories: readonly NewsHeadline[];
  /** One group per effective source, in catalog order. */
  readonly sourceGroups: readonly NewsSourceGroup[];
  /** Effective topic restriction ([] = "top" front-page mode). */
  readonly activeTopics: readonly string[];
  /** Effective source set after prefs are applied (settings deep-link copy). */
  readonly enabledSources: readonly NewsEnabledSource[];
  readonly degraded: boolean;
}

export interface NewsEnabledSource {
  readonly sourceKey: string;
  readonly label: string;
}

export type NewsPrefKind = "source" | "source_exclude" | "topic";

export interface NewsPrefDto {
  readonly id: string;
  readonly kind: NewsPrefKind;
  readonly key: string;
  readonly createdAt: string;
}

export interface NewsPrefsResponse {
  readonly prefs: readonly NewsPrefDto[];
}

export interface CreateNewsPrefRequest {
  readonly kind: NewsPrefKind;
  readonly key: string;
}

export interface CreateNewsPrefResponse {
  readonly pref: NewsPrefDto;
}

export interface DeleteNewsPrefResponse {
  readonly ok: boolean;
}

// ---------------------------------------------------------------------------
// JSON schemas (Fastify serialization). additionalProperties:false means any
// emitted field NOT declared here is silently dropped by fast-json-stringify —
// keep these in exact lockstep with the interfaces above.
// ---------------------------------------------------------------------------

const newsTopicOptionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topicKey", "label"],
  properties: {
    topicKey: { type: "string" },
    label: { type: "string" }
  }
} as const;

const newsCatalogSourceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKey", "label", "homepageUrl", "defaultEnabled", "topics"],
  properties: {
    sourceKey: { type: "string" },
    label: { type: "string" },
    homepageUrl: { type: "string" },
    defaultEnabled: { type: "boolean" },
    topics: { type: "array", items: { type: "string" } }
  }
} as const;

const newsHeadlineSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "sourceKey",
    "sourceLabel",
    "topicKey",
    "topicLabel",
    "title",
    "url",
    "publishedAt",
    "imageUrl",
    "summary"
  ],
  properties: {
    id: { type: "string" },
    sourceKey: { type: "string" },
    sourceLabel: { type: "string" },
    topicKey: { type: ["string", "null"] },
    topicLabel: { type: ["string", "null"] },
    title: { type: "string" },
    url: { type: "string" },
    publishedAt: { type: ["string", "null"] },
    imageUrl: { type: ["string", "null"] },
    summary: { type: "string" }
  }
} as const;

const newsSourceGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sourceKey", "sourceLabel", "homepageUrl", "headlines"],
  properties: {
    sourceKey: { type: "string" },
    sourceLabel: { type: "string" },
    homepageUrl: { type: "string" },
    headlines: { type: "array", items: newsHeadlineSchema }
  }
} as const;

const newsPrefDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "key", "createdAt"],
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["source", "source_exclude", "topic"] },
    key: { type: "string" },
    createdAt: { type: "string" }
  }
} as const;

export const newsCatalogResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["sources", "topics"],
      properties: {
        sources: { type: "array", items: newsCatalogSourceSchema },
        topics: { type: "array", items: newsTopicOptionSchema }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const newsOverviewResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["topStories", "sourceGroups", "activeTopics", "enabledSources", "degraded"],
      properties: {
        topStories: { type: "array", items: newsHeadlineSchema },
        sourceGroups: { type: "array", items: newsSourceGroupSchema },
        activeTopics: { type: "array", items: { type: "string" } },
        enabledSources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["sourceKey", "label"],
            properties: {
              sourceKey: { type: "string" },
              label: { type: "string" }
            }
          }
        },
        degraded: { type: "boolean" }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const newsPrefsResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["prefs"],
      properties: {
        prefs: { type: "array", items: newsPrefDtoSchema }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const createNewsPrefRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "key"],
  properties: {
    kind: { type: "string", enum: ["source", "source_exclude", "topic"] },
    key: { type: "string", minLength: 1, maxLength: 100 }
  }
} as const;

export const createNewsPrefResponseSchema = {
  body: createNewsPrefRequestSchema,
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["pref"],
      properties: {
        pref: newsPrefDtoSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const deleteNewsPrefResponseSchema = {
  params: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: {
        ok: { type: "boolean" }
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;
