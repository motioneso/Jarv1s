// external-modules/job-search/src/worker/handlers/opportunities.ts
//
// JS-08 (#937): assistant read surface over the JS-07 feed index. Everything
// here is bounds-first: the REST invoke path degrades any tool result whose
// rendered form exceeds 16,000 chars to a bare {text}
// (boundedAssistantToolResultData in packages/ai), which would destroy the
// structured cards the web UI renders — so list responses are engineered to
// stay under RESPONSE_BUDGET_BYTES by construction. Cards NEVER carry the
// posting description (that's opportunities.get territory, with its own
// byte budget), and every free-text passthrough is truncated on a UTF-8
// boundary, including adapter-supplied publishedAt (defensive: PostingFacts
// strings are adapter-controlled free text).
//
// Budget backstop: the plan's per-field caps (title 160B, company 120B,
// evidence/gap 160B) cannot arithmetically guarantee the 14,000-byte budget
// at a worst-case 15 fully-maxed cards (~17 KB). Rather than shrink the
// approved caps, advisory topEvidence/topGap lines are stripped from the
// LAST (lowest-ranked) cards first until the response fits — structured
// band/confidence fields survive on every card, and a fully-stripped page
// is ~13 KB worst case, provably under budget.
import type {
  FeedBandCode,
  FeedConfidenceCode,
  FeedEntry,
  FeedGateCode,
  OpportunityStatus
} from "../../domain/index.js";
import {
  FEED_BAND_CODES,
  FEED_CONFIDENCE_CODES,
  FEED_GATE_CODES,
  LIST_LIMIT_DEFAULT,
  LIST_LIMIT_MAX,
  LIST_TEXT_MAX_BYTES,
  RESPONSE_BUDGET_BYTES,
  freshnessOf,
  getEvaluation,
  getOpportunity,
  readFeedOrRebuild,
  truncateUtf8
} from "../../domain/index.js";
import type { WorkerPorts } from "../ai-port.js";
import { readEnum, readInt } from "../validate.js";
import type { ToolHandler } from "../wrap.js";

// "active" is deliberately NOT a view: the saved view covers it (an active
// record is a saved one with follow-up state — plan list contract).
const OPPORTUNITY_VIEWS = ["new", "saved", "passed", "stale"] as const;
type OpportunityView = (typeof OPPORTUNITY_VIEWS)[number];

// Plan contract pins company at 120B (below the general 160B text cap);
// publishedAt is a normally-24-char ISO string — 40B only guards against a
// misbehaving adapter blowing the response budget.
const COMPANY_MAX_BYTES = 120;
const PUBLISHED_AT_MAX_BYTES = 40;

// Decode maps: invert the single-char storage codes so cards speak full
// words (the assistant and web UI never see the storage encoding).
function invert<K extends string, V extends string>(codes: Record<K, V>): Record<V, K> {
  const out = {} as Record<V, K>;
  for (const [word, code] of Object.entries(codes) as Array<[K, V]>) {
    out[code] = word;
  }
  return out;
}
const GATE_WORDS = invert<string, FeedGateCode>(FEED_GATE_CODES);
const BAND_WORDS = invert<string, FeedBandCode>(FEED_BAND_CODES);
const CONFIDENCE_WORDS = invert<string, FeedConfidenceCode>(FEED_CONFIDENCE_CODES);

interface OpportunityCard {
  identityHash: string;
  status: OpportunityStatus;
  title: string;
  company: string;
  location?: string;
  workMode?: string;
  source: string;
  publishedAt?: string;
  firstSeenAt: string;
  freshness: string;
  eligibility?: string;
  fitBand?: string;
  confidence?: string;
  evaluationPending: boolean;
  topEvidence?: string;
  topGap?: string;
}

function cap(text: string, maxBytes: number): string {
  return truncateUtf8(text, maxBytes).text;
}

function matchesView(entry: FeedEntry, view: OpportunityView): boolean {
  return view === "saved" ? entry.s === "saved" || entry.s === "active" : entry.s === view;
}

/** In-place backstop: shed advisory snippets tail-first until under budget. */
function enforceBudget(response: Record<string, unknown>, cards: OpportunityCard[]): void {
  let bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  for (let i = cards.length - 1; i >= 0 && bytes > RESPONSE_BUDGET_BYTES; i -= 1) {
    const card = cards[i]!;
    if (card.topEvidence === undefined && card.topGap === undefined) {
      continue;
    }
    delete card.topEvidence;
    delete card.topGap;
    bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  }
}

export function listOpportunitiesHandler(ports: WorkerPorts): ToolHandler {
  return async (input: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const view = readEnum(input, "view", OPPORTUNITY_VIEWS) ?? "new";
    const limit = readInt(input, "limit", { min: 1, max: LIST_LIMIT_MAX }) ?? LIST_LIMIT_DEFAULT;
    const offset = readInt(input, "offset", { min: 0 }) ?? 0;

    const feed = await readFeedOrRebuild(ports.kv, ports.now());
    const matches = feed.entries.filter((entry) => matchesView(entry, view));

    const cards: OpportunityCard[] = [];
    for (const entry of matches.slice(offset, offset + limit)) {
      const job = await getOpportunity(ports.kv, entry.h);
      if (job === null) {
        // Index/record skew: the derived index self-heals on the next
        // rebuild — skipping beats failing the whole page.
        continue;
      }
      const card: OpportunityCard = {
        identityHash: entry.h,
        status: entry.s,
        title: cap(job.posting.title, LIST_TEXT_MAX_BYTES),
        company: cap(job.posting.company, COMPANY_MAX_BYTES),
        ...(job.posting.location !== undefined
          ? { location: cap(job.posting.location, LIST_TEXT_MAX_BYTES) }
          : {}),
        ...(job.posting.workMode !== undefined ? { workMode: job.posting.workMode } : {}),
        source: job.adapterId,
        ...(job.posting.publishedAt !== undefined
          ? { publishedAt: cap(job.posting.publishedAt, PUBLISHED_AT_MAX_BYTES) }
          : {}),
        firstSeenAt: job.firstSeenAt,
        freshness: freshnessOf(job),
        ...(entry.e !== undefined ? { eligibility: GATE_WORDS[entry.e] } : {}),
        ...(entry.b !== undefined ? { fitBand: BAND_WORDS[entry.b] } : {}),
        ...(entry.c !== undefined ? { confidence: CONFIDENCE_WORDS[entry.c] } : {}),
        evaluationPending: entry.b === undefined
      };
      if (entry.b !== undefined) {
        // Advisory one-liners come from the evaluation record; only fetched
        // when the index says a CURRENT evaluation exists.
        const evaluation = await getEvaluation(ports.kv, entry.h);
        const topEvidence = evaluation?.evidence[0]?.evidence;
        const topGap = evaluation?.gaps[0];
        if (topEvidence !== undefined) {
          card.topEvidence = cap(topEvidence, LIST_TEXT_MAX_BYTES);
        }
        if (topGap !== undefined) {
          card.topGap = cap(topGap, LIST_TEXT_MAX_BYTES);
        }
      }
      cards.push(card);
    }

    const response: Record<string, unknown> = {
      status: "ok",
      view,
      total: matches.length,
      limit,
      offset,
      opportunities: cards
    };
    enforceBudget(response, cards);
    return response;
  };
}
