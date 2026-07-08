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
  readonly winPercent: number | null; // US leagues; null for soccer
  readonly qualifies: boolean; // advancement/qualification marker
  readonly qualificationNote: string | null; // e.g. "UEFA Champions League"; null when none (#841)
  readonly qualificationColor: string | null; // raw source hex; carried for a later design pass (#841)
}

export type StandingsShape = "table" | "groups" | "record";

export interface StandingsSection {
  readonly label: string | null; // "Group A", "AFC East"; null = single table
  // Parent conference label, e.g. "American Football Conference"; absent/null for flat tables
  // and soccer groups (#839 follow-up).
  readonly conference?: string | null;
  readonly rows: readonly StandingsRow[];
}

export interface Headline {
  readonly id: string;
  readonly competitionKey: string;
  readonly competitionLabel: string; // "NFL", "Premier League" — never render competitionKey raw (#765 M4)
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly imageUrl: string | null; // first "header" image, else first image, else null
  readonly summary: string; // short article blurb from the source; "" when absent (#840)
  readonly teamKeys: readonly string[]; // filled by the service join (Task 4); source emits []
  // Sanitized plaintext excerpt of the full article body (#857). Populated ONLY for the single
  // NewsBand featured story (the service fetches its per-article ESPN body); every other headline
  // omits it and the UI falls back to `summary`. Already stripped of all HTML/tokens and length-
  // capped in the source layer — the client renders it as text, never as HTML.
  readonly body?: string;
}

export interface CompetitionRef {
  readonly competitionKey: string;
  readonly label: string; // "NFL", "Premier League"
  readonly kind: "league" | "tournament";
  readonly marquee: boolean; // World Cup flag
  readonly standingsShape: StandingsShape;
}

export interface SportsFollowDto {
  readonly id: string;
  readonly competitionKey: string;
  readonly teamKey: string | null; // null = whole competition
  readonly createdAt: string;
}

export interface FollowedTeamRef {
  readonly competitionKey: string;
  readonly teamKey: string;
}

// A whole-competition follow (teamKey: null on the DTO) — surfaced separately from
// FollowedTeamCard[] so the client can tell "follows nothing" apart from "follows leagues,
// not teams" (#763).
export interface FollowedLeagueRef {
  readonly competitionKey: string;
  readonly competitionLabel: string;
}

// Composed page (GET /api/sports/overview)
export type OverviewHero =
  | {
      readonly mode: "gameday";
      readonly game: GameSummary;
      readonly competitionLabel: string; // "NFL" — never render competitionKey raw (#765 M4)
      readonly rationale: string;
      readonly alsoToday: string | null;
    }
  | { readonly mode: "story"; readonly headline: Headline | null };

export interface FollowedTeamNews {
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string; // ISO — the ticker ranks idle teams by news freshness (mra54n4h)
  readonly imageUrl: string | null; // small thumbnail on non-live ticker cards (mra5xnt2)
}

export interface FollowedNextMatch {
  readonly opponentName: string; // full name, resolved per D1
  readonly homeAway: "home" | "away";
  readonly startsAt: string; // ISO instant; formatted client-side in the viewer's locale
  // Opponent crest for the ticker's Next footer, which identifies the opponent by logo
  // instead of name (live feedback mrawvc48). Optional: pre-#845 payloads predate it.
  readonly opponentCrestUrl?: string | null;
}

// A finished game rendered on the featured strip's score slot. The opponent crest carries the
// identity (mirroring FollowedNextMatch's crest-leads convention), so `scoreText` is just the
// result + scores with NO "vs <team>" tail — that trailing text read as cheap next to the rest
// of the card (Ben 2026-07-08 /sports annotation #2). Set only for a today game that has gone
// final; live/pre/idle cards leave it null and keep the `primary` string slot.
export interface FollowedResultMatch {
  readonly opponentName: string; // full name; the crest is the primary identifier, this backs a11y
  readonly opponentCrestUrl: string | null;
  readonly scoreText: string; // "L 3–9" — result letter + your–their score, opponent via the crest
}

export interface FollowedTeamCard {
  readonly teamKey: string;
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly name: string;
  readonly crestUrl: string | null;
  readonly status: "live" | "today" | "news";
  readonly primary: string; // "MIN 21 – 14 DAL", "W 4–2 vs NYR", or a headline title
  // For status "today": whether today's game has finished. The ticker keeps a final score in
  // the primary slot but drops the pre-game matchup line — the Next footer already carries the
  // fixture (live feedback mrawrk0e). Optional: older payloads predate it.
  readonly todayGameState?: "pre" | "final";
  // Up to three of the club's own stories, newest first (live feedback mrb0pk1n — "three
  // stories per team… real news for their clubs"). stories[0] is the lead (thumbnail slot);
  // the rest render as text links. Replaces the old single `news` field.
  readonly stories: readonly FollowedTeamNews[];
  readonly form: readonly ("W" | "D" | "L")[];
  readonly standing: string | null;
  readonly nextMatch: FollowedNextMatch | null;
  // A finished today-game's result, rendered as opponent crest + "L 3–9" on the featured strip
  // (Ben 2026-07-08 /sports annotation #2) instead of the cheap-looking "L 3–9 vs Blue Jays"
  // text. Null unless today's game is final. Optional: pre-#864 payloads predate the field, so
  // the client falls back to the `primary` text slot when it's absent.
  readonly resultMatch?: FollowedResultMatch | null;
  // Start time of the team's most recent completed game (ISO), null when the schedule holds no
  // finals. The ticker uses it with nextMatch.startsAt to rank in-season teams (games within ten
  // days) above idle ones (live feedback mra54n4h).
  readonly lastMatchAt: string | null;
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
  readonly standingsShape: StandingsShape;
  readonly sections: readonly StandingsSection[];
}

export interface LeagueNewsGroup {
  readonly competitionKey: string;
  readonly competitionLabel: string;
  readonly headlines: readonly Headline[]; // no hard cap — bounded by the source fetch
}

export interface SportsOverviewResponse {
  readonly hero: OverviewHero;
  readonly followed: readonly FollowedTeamCard[];
  readonly scoreboard: readonly ScoreboardGroup[];
  readonly topStories: readonly Headline[]; // ranked, capped at 6
  readonly leagueNews: readonly LeagueNewsGroup[];
  readonly standings: readonly StandingsGroup[];
  readonly followedTeams: readonly FollowedTeamRef[]; // for is-you marking on the client
  readonly followedLeagues: readonly FollowedLeagueRef[]; // whole-competition follows (#763)
  readonly degraded: boolean; // source failed → cached/empty
}

export interface SportsCatalogResponse {
  readonly competitions: readonly (CompetitionRef & { readonly teams: readonly TeamRef[] })[];
  readonly degraded: boolean; // one or more competitions' teams failed to load (#765 M1)
}

export interface SportsFollowsResponse {
  readonly follows: readonly SportsFollowDto[];
}

/** `GET /api/sports/standings?competitionKey=<key>` response (#842). */
export interface SportsStandingsResponse {
  readonly group: StandingsGroup;
  // Current-round matches for tournaments whose group stage is complete; empty otherwise
  // (#839 follow-up).
  readonly fixtures: readonly GameSummary[];
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
  required: [
    "teamKey",
    "name",
    "rank",
    "points",
    "wins",
    "losses",
    "draws",
    "winPercent",
    "qualifies",
    "qualificationNote",
    "qualificationColor"
  ],
  properties: {
    teamKey: { type: "string" },
    name: { type: "string" },
    rank: { type: "number" },
    points: { type: ["number", "null"] },
    wins: { type: "number" },
    losses: { type: "number" },
    draws: { type: ["number", "null"] },
    winPercent: { type: ["number", "null"] },
    qualifies: { type: "boolean" },
    qualificationNote: { type: ["string", "null"] },
    qualificationColor: { type: ["string", "null"] }
  }
} as const;

const standingsSectionSchema = {
  type: "object",
  additionalProperties: false,
  // `conference` intentionally omitted from `required`: older cached standings tables lack it.
  required: ["label", "rows"],
  properties: {
    label: { type: ["string", "null"] },
    conference: { type: ["string", "null"] },
    rows: { type: "array", items: standingsRowSchema }
  }
} as const;

const headlineSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "competitionKey",
    "competitionLabel",
    "title",
    "url",
    "publishedAt",
    "imageUrl",
    "summary",
    "teamKeys"
  ],
  properties: {
    id: { type: "string" },
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    publishedAt: { type: "string" },
    imageUrl: { type: ["string", "null"] },
    summary: { type: "string" },
    teamKeys: { type: "array", items: { type: "string" } },
    // Optional (not in `required`) — only the featured story carries it (#857). MUST be listed
    // here even though it's optional: this schema is used inside a oneOf (hero.headline), where
    // fast-json-stringify REJECTS the whole object for any emitted key it doesn't know — the same
    // trap documented on `nextMatch`/`stories` below that has 500'd /overview before.
    body: { type: "string" }
  }
} as const;

const competitionRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "label", "kind", "marquee", "standingsShape"],
  properties: {
    competitionKey: { type: "string" },
    label: { type: "string" },
    kind: { type: "string", enum: ["league", "tournament"] },
    marquee: { type: "boolean" },
    standingsShape: { type: "string", enum: ["table", "groups", "record"] }
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
    "stories",
    "form",
    "standing",
    "nextMatch",
    "lastMatchAt",
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
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        // Plain array items (no oneOf — an empty array replaces the old null), but keep every
        // emitted field listed: fast-json-stringify silently DROPS unknown keys outside oneOf,
        // and rejects the whole object inside one — see toPublicHeadline note.
        required: ["title", "url", "publishedAt", "imageUrl"],
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          publishedAt: { type: "string" },
          imageUrl: { type: ["string", "null"] }
        }
      }
    },
    form: { type: "array", items: { type: "string", enum: ["W", "D", "L"] } },
    standing: { type: ["string", "null"] },
    nextMatch: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          // Same oneOf trap as `news` above: a field the service emits but this schema omits
          // makes fast-json-stringify reject the whole object → 500 on /overview (bit us live
          // when opponentCrestUrl shipped in the payload without a schema row, mrawvc48).
          required: ["opponentName", "homeAway", "startsAt"],
          properties: {
            opponentName: { type: "string" },
            homeAway: { type: "string", enum: ["home", "away"] },
            startsAt: { type: "string" },
            opponentCrestUrl: { type: ["string", "null"] }
          }
        }
      ]
    },
    todayGameState: { type: "string", enum: ["pre", "final"] },
    lastMatchAt: { type: ["string", "null"] },
    rationale: { type: "string" }
  }
} as const;

const followedLeagueRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "competitionLabel"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" }
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
  required: ["competitionKey", "competitionLabel", "standingsShape", "sections"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    standingsShape: { type: "string", enum: ["table", "groups", "record"] },
    sections: { type: "array", items: standingsSectionSchema }
  }
} as const;

const leagueNewsGroupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["competitionKey", "competitionLabel", "headlines"],
  properties: {
    competitionKey: { type: "string" },
    competitionLabel: { type: "string" },
    headlines: { type: "array", items: headlineSchema }
  }
} as const;

const overviewHeroSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "game", "competitionLabel", "rationale", "alsoToday"],
      properties: {
        mode: { type: "string", enum: ["gameday"] },
        game: gameSummarySchema,
        competitionLabel: { type: "string" },
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
        "topStories",
        "leagueNews",
        "standings",
        "followedTeams",
        "followedLeagues",
        "degraded"
      ],
      properties: {
        hero: overviewHeroSchema,
        followed: { type: "array", items: followedTeamCardSchema },
        scoreboard: { type: "array", items: scoreboardGroupSchema },
        topStories: { type: "array", items: headlineSchema },
        leagueNews: { type: "array", items: leagueNewsGroupSchema },
        standings: { type: "array", items: standingsGroupSchema },
        followedTeams: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["competitionKey", "teamKey"],
            properties: {
              competitionKey: { type: "string" },
              teamKey: { type: "string" }
            }
          }
        },
        followedLeagues: { type: "array", items: followedLeagueRefSchema },
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
      required: ["competitions", "degraded"],
      properties: {
        competitions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["competitionKey", "label", "kind", "marquee", "standingsShape", "teams"],
            properties: {
              ...competitionRefSchema.properties,
              teams: { type: "array", items: teamRefSchema }
            }
          }
        },
        degraded: { type: "boolean" }
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

export const sportsStandingsResponseSchema = {
  querystring: {
    type: "object",
    additionalProperties: false,
    required: ["competitionKey"],
    properties: {
      competitionKey: { type: "string", minLength: 1, maxLength: 100 }
    }
  },
  response: {
    200: {
      type: "object",
      additionalProperties: false,
      required: ["group", "fixtures"],
      properties: {
        group: standingsGroupSchema,
        fixtures: { type: "array", items: gameSummarySchema }
      }
    },
    400: errorResponseSchema,
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
