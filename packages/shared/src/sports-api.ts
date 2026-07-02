// packages/shared/src/sports-api.ts — BROWSER-SAFE. No node:* imports.
import { errorResponseSchema } from "./schema-fragments.js";

export type IsoDate = string; // "YYYY-MM-DD"

export interface TeamRef {
  readonly teamKey: string; // stable within a competition, e.g. "dal" or ESPN team id
  readonly competitionKey: string;
  readonly name: string;
  readonly shortName: string;
  readonly crestUrl: string | null;
}

export interface GameSide {
  readonly teamKey: string;
  readonly name: string;
  readonly shortName: string;
  readonly crestUrl: string | null;
  readonly score: number | null; // null pre-game
  readonly record: string | null; // "10-2"
  readonly winner: boolean;
}

export interface GameSummary {
  readonly id: string;
  readonly competitionKey: string;
  readonly startsAt: string; // ISO instant
  readonly state: "pre" | "live" | "final";
  readonly statusDetail: string; // "7:20 PM", "Q3 4:12", "FT"
  readonly home: GameSide;
  readonly away: GameSide;
}

export interface StandingsRow {
  readonly teamKey: string;
  readonly name: string;
  readonly rank: number;
  readonly points: number | null; // soccer
  readonly wins: number;
  readonly losses: number;
  readonly draws: number | null;
  readonly qualifies: boolean; // advancement/qualification marker
}

export interface Headline {
  readonly id: string;
  readonly competitionKey: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly imageUrl: string | null; // first "header" image, else first image, else null
  readonly teamKeys: readonly string[]; // filled by the service join (Task 4); source emits []
}

export interface CompetitionRef {
  readonly competitionKey: string;
  readonly label: string; // "NFL", "Premier League"
  readonly kind: "league" | "tournament";
  readonly marquee: boolean; // World Cup flag
}

export interface SportsFollowDto {
  readonly id: string;
  readonly competitionKey: string;
  readonly teamKey: string | null; // null = whole competition
  readonly createdAt: string;
}

// Composed page (GET /api/sports/overview)
export type OverviewHero =
  | {
      readonly mode: "gameday";
      readonly game: GameSummary;
      readonly rationale: string;
      readonly alsoToday: string | null;
    }
  | { readonly mode: "story"; readonly headline: Headline | null };

export interface FollowedTeamCard {
  readonly teamKey: string;
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly name: string;
  readonly crestUrl: string | null;
  readonly status: "live" | "today" | "news";
  readonly primary: string; // "MIN 21 – 14 DAL", "W 4–2 vs NYR", or a headline title
  readonly form: readonly ("W" | "D" | "L")[];
  readonly standing: string | null;
  readonly nextMatch: string | null;
  readonly rationale: string;
}

export interface ScoreboardGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly games: readonly GameSummary[];
}

export interface StandingsGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly rows: readonly StandingsRow[];
}

export interface SportsOverviewResponse {
  readonly hero: OverviewHero;
  readonly followed: readonly FollowedTeamCard[];
  readonly scoreboard: readonly ScoreboardGroup[];
  readonly headlines: readonly Headline[];
  readonly standings: readonly StandingsGroup[];
  readonly followedTeamKeys: readonly string[]; // for is-you marking on the client
  readonly degraded: boolean; // source failed → cached/empty
}

export interface SportsCatalogResponse {
  readonly competitions: readonly (CompetitionRef & { readonly teams: readonly TeamRef[] })[];
}

export interface SportsFollowsResponse {
  readonly follows: readonly SportsFollowDto[];
}

export interface CreateSportsFollowRequest {
  readonly competitionKey: string;
  readonly teamKey?: string | null;
}

// ---------------------------------------------------------------------------
// Fastify route JSON schemas — mirror weather-api.ts (`as const`,
// additionalProperties: false, response 200 + errorResponseSchema).
// ---------------------------------------------------------------------------

const teamRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamKey", "competitionKey", "name", "shortName", "crestUrl"],
  properties: {
    teamKey: { type: "string" },
    competitionKey: { type: "string" },
    name: { type: "string" },
    shortName: { type: "string" },
    crestUrl: { type: ["string", "null"] }
  }
} as const;

const gameSideSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamKey", "name", "shortName", "crestUrl", "score", "record", "winner"],
  properties: {
    teamKey: { type: "string" },
    name: { type: "string" },
    shortName: { type: "string" },
    crestUrl: { type: ["string", "null"] },
    score: { type: ["number", "null"] },
    record: { type: ["string", "null"] },
    winner: { type: "boolean" }
  }
} as const;

const gameSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "competitionKey", "startsAt", "state", "statusDetail", "home", "away"],
  properties: {
    id: { type: "string" },
    competitionKey: { type: "string" },
    startsAt: { type: "string" },
    state: { type: "string", enum: ["pre", "live", "final"] },
    statusDetail: { type: "string" },
    home: gameSideSchema,
    away: gameSideSchema
  }
} as const;

const standingsRowSchema = {
  type: "object",
  additionalProperties: false,
  required: ["teamKey", "name", "rank", "points", "wins", "losses", "draws", "qualifies"],
  properties: {
    teamKey: { type: "string" },
    name: { type: "string" },
    rank: { type: "number" },
    points: { type: ["number", "null"] },
    wins: { type: "number" },
    losses: { type: "number" },
    draws: { type: ["number", "null"] },
    qualifies: { type: "boolean" }
  }
} as const;

const headlineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "competitionKey", "title", "url", "publishedAt", "imageUrl", "teamKeys"],
  properties: {
    id: { type: "string" },
    competitionKey: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    publishedAt: { type: "string" },
    imageUrl: { type: ["string", "null"] },
    teamKeys: { type: "array", items: { type: "string" } }
  }
} as const;

const competitionRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "label", "kind", "marquee"],
  properties: {
    competitionKey: { type: "string" },
    label: { type: "string" },
    kind: { type: "string", enum: ["league", "tournament"] },
    marquee: { type: "boolean" }
  }
} as const;

const followDtoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "competitionKey", "teamKey", "createdAt"],
  properties: {
    id: { type: "string" },
    competitionKey: { type: "string" },
    teamKey: { type: ["string", "null"] },
    createdAt: { type: "string" }
  }
} as const;

const followedTeamCardSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "teamKey",
    "competitionKey",
    "competitionLabel",
    "name",
    "crestUrl",
    "status",
    "primary",
    "form",
    "standing",
    "nextMatch",
    "rationale"
  ],
  properties: {
    teamKey: { type: "string" },
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    name: { type: "string" },
    crestUrl: { type: ["string", "null"] },
    status: { type: "string", enum: ["live", "today", "news"] },
    primary: { type: "string" },
    form: { type: "array", items: { type: "string", enum: ["W", "D", "L"] } },
    standing: { type: ["string", "null"] },
    nextMatch: { type: ["string", "null"] },
    rationale: { type: "string" }
  }
} as const;

const scoreboardGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "competitionLabel", "games"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    games: { type: "array", items: gameSummarySchema }
  }
} as const;

const standingsGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "competitionLabel", "rows"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    rows: { type: "array", items: standingsRowSchema }
  }
} as const;

const overviewHeroSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "game", "rationale", "alsoToday"],
      properties: {
        mode: { type: "string", enum: ["gameday"] },
        game: gameSummarySchema,
        rationale: { type: "string" },
        alsoToday: { type: ["string", "null"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "headline"],
      properties: {
        mode: { type: "string", enum: ["story"] },
        headline: { oneOf: [headlineSchema, { type: "null" }] }
      }
    }
  ]
} as const;

export const sportsOverviewResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: [
        "hero",
        "followed",
        "scoreboard",
        "headlines",
        "standings",
        "followedTeamKeys",
        "degraded"
      ],
      properties: {
        hero: overviewHeroSchema,
        followed: { type: "array", items: followedTeamCardSchema },
        scoreboard: { type: "array", items: scoreboardGroupSchema },
        headlines: { type: "array", items: headlineSchema },
        standings: { type: "array", items: standingsGroupSchema },
        followedTeamKeys: { type: "array", items: { type: "string" } },
        degraded: { type: "boolean" }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const sportsCatalogResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["competitions"],
      properties: {
        competitions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["competitionKey", "label", "kind", "marquee", "teams"],
            properties: {
              ...competitionRefSchema.properties,
              teams: { type: "array", items: teamRefSchema }
            }
          }
        }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const sportsFollowsResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["follows"],
      properties: {
        follows: { type: "array", items: followDtoSchema }
      }
    },
    401: errorResponseSchema
  }
} as const;

export const createSportsFollowRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey"],
  properties: {
    competitionKey: { type: "string", minLength: 1, maxLength: 100 },
    teamKey: { type: ["string", "null"], maxLength: 100 }
  }
} as const;

export const createSportsFollowResponseSchema = {
  body: createSportsFollowRequestSchema,
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["follow"],
      properties: {
        follow: followDtoSchema
      }
    },
    400: errorResponseSchema,
    401: errorResponseSchema
  }
} as const;

export const deleteSportsFollowResponseSchema = {
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: {
        ok: { type: "boolean" }
      }
    },
    401: errorResponseSchema
  }
} as const;
