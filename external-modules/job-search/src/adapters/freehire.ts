// external-modules/job-search/src/adapters/freehire.ts
//
// Task 11 (#1295): the freehire.me portal. freehire aggregates ~50 ATS boards behind one
// declared host, which is why it goes first — proving the Portal interface here covers the
// widest source before Task 12 does LinkedIn.
//
// Probe results (live `curl`, 2026-07-27) — restated from the plan, re-verified while building
// this file against the live site with the module's own User-Agent:
//   - GET /api/jobs             -> 404. Does not exist.
//   - GET /api/v1/jobs          -> 200, well-formed `{data, meta:{limit,offset,total}}`, but
//     accepts NO filters: every parameter tried returned the byte-identical unfiltered first
//     page of a 3,278,266-row table. This adapter must never fall back to it on a `__data.json`
//     failure — a "fallback" that ignores every filter would present 3.28M irrelevant rows as
//     search results, which is worse than reporting the failure honestly.
//   - GET /__data.json          -> the SvelteKit SSR data route, and the ONLY thing that
//     filters (`work_mode`/`regions` narrow 3.28M -> ~600; free-text `q` works but is fuzzy).
//     This is the endpoint the adapter targets, treated as a fragile internal route rather than
//     a stable public API: an envelope we do not recognise disables the portal (`parse_failed`,
//     L14), it never reports zero results as though the search had simply found nothing.
//
// Re-probed while implementing this task: none of `offset`, `page`, `cursor`, `start`, `skip`,
// `from`, or `after` changed the returned page — every combination echoed page one back
// byte-for-byte against a fixed query. Real server-side pagination for `__data.json` is
// UNCONFIRMED as of 2026-07-27 (flagged to the team lead). `offset` is used below on the
// (unverified) theory that it is the conventional name and may be honoured under conditions
// this probe did not hit. If it never pages, the loop below degrades to refetching page one
// until `PAGE_CAP`, which is wasteful but not incorrect: results are deduped downstream
// (Task 7) and nothing here trusts the source's own ranking (L14) or claims a total was
// exhausted — `hasMore`/`total` are read from whatever page comes back, not assumed.
//
// __data.json envelope shape (SvelteKit's `devalue` flat-array serialization: every value —
// object, array, string, number, boolean, or null — gets its own slot in one flat array, and
// every value *inside* an object or array is an index into that same array, never a literal,
// including small integers like `total`). This adapter walks it by KEY NAME, never by a
// hardcoded index, because the index a field lands on is an artifact of one response and is
// not stable across requests:
//
//   doc.nodes[1].data                          -- the flat pool for this route's page data
//   pool[0]            = { initial: <ref> }    -- resolve "initial" to the results wrapper
//   wrapper            = { items: <ref>, total: <ref>, hasMore: <ref> }
//   items              = <ref> -> array of per-job refs
//   job                = { title, company, location, url, external_id, description,
//                           posted_at, ... }   -- only these seven keys are read; every other
//                                                  key on a real job object (skills, countries,
//                                                  enrichment, vote counts, ...) is ignored
//
// A value that is not a valid in-range pool index, or an object missing an expected key, means
// the payload is not the shape documented above — that is a disabling `parse_failed`, never a
// posting built from a blank field or a stray integer treated as a string.
import type { FailureKind, Posting, SearchCriteria } from "../domain/records.js";
import { describeFailure } from "../domain/records.js";
import type { CrawlResult, FetchLike, Portal } from "./types.js";
import { PAGE_CAP, statusToKind } from "./types.js";

const SOURCE_ID = "freehire";
const SOURCE_LABEL = "freehire.me";
const BASE_URL = "https://freehire.me/__data.json";
const USER_AGENT = "Jarvis-JobSearch/0.1 (personal use)";
/** Matches the fixed page size observed on the live site; used only to compute the (unverified,
 * see header) `offset` step between pages. */
const PAGE_SIZE = 20;

function buildUrl(criteria: SearchCriteria, page: number): string {
  const params = new URLSearchParams();
  if (criteria.titles.length > 0) {
    params.set("q", criteria.titles.join(" "));
  }
  // Only "required" narrows by mode. "preferred" / "no-preference" / "onsite-ok" all leave
  // work_mode unset so remote+hybrid+onsite postings are over-fetched together (L14) and
  // Task 6's excludes / Task 8's triage narrow locally instead of trusting this filter.
  if (criteria.remote === "required") {
    params.set("work_mode", "remote");
  }
  // Always worldwide: SearchCriteria has no field mapping to freehire's region taxonomy, and
  // narrowing by region here would silently drop postings before Task 6 gets a chance to
  // exclude by its own, more precise location logic.
  params.set("regions", "global");
  if (page > 0) {
    params.set("offset", String(page * PAGE_SIZE));
  }
  return `${BASE_URL}?${params.toString()}`;
}

function ref(pool: unknown[], index: unknown): unknown {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= pool.length) {
    throw new Error(`freehire: invalid pool index ${JSON.stringify(index)}`);
  }
  return pool[index];
}

/** Reads `key` off an object value, then resolves the index found there — the one recursion
 * step every field in this format needs. */
function field(pool: unknown[], value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`freehire: expected an object while reading "${key}"`);
  }
  const record = value as Record<string, unknown>;
  if (!(key in record)) {
    throw new Error(`freehire: missing field "${key}"`);
  }
  return ref(pool, record[key]);
}

function asString(value: unknown, key: string): string {
  if (typeof value !== "string") {
    throw new Error(`freehire: expected a string for "${key}"`);
  }
  return value;
}

function asStringOrNull(value: unknown, key: string): string | null {
  if (value === null) return null;
  return asString(value, key);
}

function asBoolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`freehire: expected a boolean for "${key}"`);
  }
  return value;
}

function asArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`freehire: expected an array for "${key}"`);
  }
  return value;
}

/** freehire's descriptions arrive as HTML (SvelteKit renders them straight from the source
 * ATS), but Task 9's scoring prompt wants plain text. A regex strip is deliberately simple —
 * this is throwaway job-ad markup, not content that needs a real HTML parser — and
 * failure-safe: worst case it leaves a stray fragment in the body, never an exception. */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface ParsedPage {
  postings: Posting[];
  hasMore: boolean;
  /** Informational only — enriches a later page's failure summary ("112 of about 190
   * postings"). A missing or malformed total does not fail an otherwise well-formed page. */
  total: number | null;
}

/**
 * Throws on anything that is not the shape documented at the top of this file. The caller
 * turns every throw into a disabling `parse_failed` — this function never returns a posting
 * built from a field it could not resolve, and it never returns an empty list to silently mean
 * "the payload didn't parse" (throwing is what that's for; a genuinely empty `items` array is
 * a real, well-formed zero-results page and is NOT an error — see `crawl`'s test coverage for
 * the distinction).
 */
function parseEnvelope(bodyText: string): ParsedPage {
  const doc: unknown = JSON.parse(bodyText);
  if (typeof doc !== "object" || doc === null) {
    throw new Error("freehire: response body is not an object");
  }
  const envelope = doc as Record<string, unknown>;
  if (envelope.type !== "data") {
    // Covers the "redirect" envelope SvelteKit returns when a request is missing params it
    // expects, and any other envelope type this route might one day return.
    throw new Error(`freehire: unexpected envelope type ${JSON.stringify(envelope.type)}`);
  }
  const nodes = envelope.nodes;
  if (!Array.isArray(nodes) || nodes.length < 2) {
    throw new Error("freehire: envelope missing nodes[1]");
  }
  const pageNode = nodes[1] as Record<string, unknown> | null;
  if (pageNode?.type !== "data") {
    throw new Error(`freehire: unexpected nodes[1] type ${JSON.stringify(pageNode?.type)}`);
  }
  const pool = asArray(pageNode.data, "nodes[1].data");
  if (pool.length === 0) {
    throw new Error("freehire: empty data pool");
  }

  const wrapper = field(pool, pool[0], "initial");
  const itemRefs = asArray(field(pool, wrapper, "items"), "items");
  const hasMore = asBoolean(field(pool, wrapper, "hasMore"), "hasMore");

  let total: number | null = null;
  try {
    const rawTotal = field(pool, wrapper, "total");
    if (typeof rawTotal === "number" && Number.isFinite(rawTotal)) total = rawTotal;
  } catch {
    // total is informational only — see ParsedPage.
  }

  const postings: Posting[] = itemRefs.map((jobRef) => {
    const job = ref(pool, jobRef);
    const title = asString(field(pool, job, "title"), "title");
    const company = asString(field(pool, job, "company"), "company");
    const location = asString(field(pool, job, "location"), "location");
    const url = asString(field(pool, job, "url"), "url");
    const externalId = asString(field(pool, job, "external_id"), "external_id");
    const description = asString(field(pool, job, "description"), "description");
    const postedAt = asStringOrNull(field(pool, job, "posted_at"), "posted_at");

    if (!url.startsWith("http")) {
      throw new Error("freehire: posting url is not absolute");
    }

    return {
      // The store assigns the uuid; the adapter must not invent one.
      id: "",
      sourceId: SOURCE_ID,
      externalId,
      title,
      company,
      location,
      url,
      body: htmlToText(description),
      postedAt
    };
  });

  return { postings, hasMore, total };
}

function buildFailure(
  kind: FailureKind,
  retrieved: number,
  expected: number | null,
  lastOkAt: string | null
) {
  return describeFailure({
    kind,
    sourceId: SOURCE_ID,
    sourceLabel: SOURCE_LABEL,
    retrieved,
    expected,
    lastOkAt,
    // Nothing at this layer knows the actual next-scheduled-crawl time (that lives with
    // Task 14's caller); describeFailure's copy degrades gracefully to "the next scheduled
    // crawl" when retryAt is null, and login_required forces it to null regardless.
    retryAt: null
  });
}

async function crawl(args: {
  fetch: FetchLike;
  criteria: SearchCriteria;
  lastOkAt: string | null;
  now: string;
  deadlineAt: number;
  clock?: () => number;
}): Promise<CrawlResult> {
  const clock = args.clock ?? Date.now;
  const postings: Posting[] = [];
  let expected: number | null = null;

  for (let page = 0; page < PAGE_CAP; page += 1) {
    if (clock() >= args.deadlineAt) {
      return { postings, failure: buildFailure("deadline", postings.length, expected, args.lastOkAt) };
    }

    let response;
    try {
      response = await args.fetch(buildUrl(args.criteria, page), {
        headers: { "User-Agent": USER_AGENT }
      });
    } catch {
      return { postings, failure: buildFailure("network", postings.length, expected, args.lastOkAt) };
    }

    if (!response.ok) {
      const kind = statusToKind(response.status);
      return { postings, failure: buildFailure(kind, postings.length, expected, args.lastOkAt) };
    }

    let parsed: ParsedPage;
    try {
      const bodyText = await response.text();
      parsed = parseEnvelope(bodyText);
    } catch {
      return {
        postings,
        failure: buildFailure("parse_failed", postings.length, expected, args.lastOkAt)
      };
    }

    postings.push(...parsed.postings);
    if (parsed.total !== null) expected = parsed.total;
    if (!parsed.hasMore) break;
  }

  return { postings, failure: null };
}

export const freehirePortal: Portal = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  host: "freehire.me",
  crawl
};
