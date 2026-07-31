// external-modules/job-search/src/adapters/linkedin.ts
//
// Task 12 (#1296): the LinkedIn guest jobs adapter. Indeed is cut from v1 (probed live,
// 2026-07-27: returns a 403 Cloudflare challenge that wants a real browser — a research task,
// not a v1 task), which makes LinkedIn's public guest search the second source: no auth, no key,
// no cookie.
//
// Probed live (2026-07-27, this module's own User-Agent) against
// `GET /jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=...&location=...&start=N`:
//   - Each page is an HTML fragment, one `<li>...</li>` per posting, no nesting — safe to split
//     on `<li>` rather than needing a real HTML parser (the module bundle has no DOM dependency
//     and must not gain one for this).
//   - The plan's part file says "30 base-card entries per page"; live probing found exactly 10,
//     consistently, across five separate requests. Flagged to the team lead as a correction, not
//     assumed — `start` below is advanced by however many cards a page actually returned, not by
//     a hardcoded 10 or 30, so a future change in page size self-corrects instead of silently
//     skipping or repeating results.
//   - `location` is optional — omitting it entirely still returns results, so `criteria.locations`
//     is only sent when non-empty rather than defaulting to a guessed value like freehire's
//     "global". `remote`/`work_mode` has no probed equivalent parameter here (unlike freehire),
//     so it is not sent; over-fetching and narrowing downstream (L14) already covers this.
//   - Consecutive `start` values do not always return a clean, non-overlapping window — repeat
//     requests a few seconds apart at `start=0` and `start=10` once returned byte-identical card
//     sets, while `start=25` returned an entirely different, non-overlapping set. LinkedIn's
//     guest search appears to be a live, recency-ranked feed rather than a stable paginated
//     table (matching the plan's own note that it "reports no total and no next cursor"). This is
//     harmless here: Task 7's dedupe absorbs any repeat, and nothing in this module trusts the
//     source's ordering as relevance (L14) — the loop below simply keeps advancing `start` until
//     a page comes back with zero cards, which is the one signal the API does give honestly.
//   - A genuine end-of-results page is a near-empty document with no cards and no surrounding
//     page chrome (`<!DOCTYPE html>` plus an HTML comment, nothing else) — this is the sentinel
//     the loop stops on, not a `parse_failed`.
//
// Auth-wall detection (200 OK carrying a sign-in interstitial instead of results) is a real,
// probed fact from the plan, but I could not safely re-trigger the actual interstitial myself:
// doing so live would mean deliberately hammering LinkedIn until it blocks this IP, which is not
// a proportionate way to verify one code path. The detector below instead keys on markers publicly
// documented as LinkedIn's own wall routing (`authwall`, `join now`, a sign-in-flavoured `<title>`)
// and the test fixture for it is a synthetic constructed interstitial, not a live capture — flagged
// to the team lead as unverified against the real page and worth a one-time manual spot-check
// (the same "fixtures rot" reasoning the plan gives for `parse_failed` applies here too: a
// misclassified real wall degrades to `parse_failed` — enabled, retried, never silently 0 postings
// — which is the safe direction to be wrong in, not a silent failure).
import type { FailureKind, Posting, SearchCriteria } from "../domain/records.js";
import { describeFailure } from "../domain/records.js";
import { htmlToText } from "./freehire.js";
import type { CrawlResult, FetchLike, Portal } from "./types.js";
import { pagesPerQuery, queriesFor, statusToKind } from "./types.js";

const SOURCE_ID = "linkedin";
const SOURCE_LABEL = "LinkedIn";
const BASE_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";
const DETAIL_BASE_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";
const USER_AGENT = "Jarvis-JobSearch/0.1 (personal use)";

/** Case-insensitive markers of LinkedIn's own sign-in interstitial. Unverified against a live
 * capture (see header) — deliberately narrow so an unrecognised 200 body defaults to the safer
 * `parse_failed` (enabled, degraded) rather than over-eagerly disabling the portal on a false
 * match. */
const AUTH_WALL_MARKERS = [/authwall/i, /join\s+now\s+to\s+view/i, /sign in to linkedin/i];

/** A genuine end-of-results page has no job cards and none of a real document's structure either
 * — this module's own probe found it to be `<!DOCTYPE html>` plus a stray HTML comment, nothing
 * else. Checking for the *absence* of `<html`/`<head` rather than an exact byte match means a
 * trivial whitespace change on LinkedIn's side doesn't turn a real end-of-results page into a
 * `parse_failed`. */
function looksLikeEmptyResultsPage(body: string): boolean {
  return body.length < 500 && !/<html[\s>]/i.test(body) && !/<head[\s>]/i.test(body);
}

function isAuthWall(body: string): boolean {
  return AUTH_WALL_MARKERS.some((marker) => marker.test(body));
}

export class LinkedInDescriptionError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string
  ) {
    super(message);
  }
}

export async function fetchLinkedInDescription(
  fetch: FetchLike,
  externalId: string
): Promise<string> {
  let response;
  try {
    response = await fetch(`${DETAIL_BASE_URL}/${encodeURIComponent(externalId)}`, {
      headers: { "User-Agent": USER_AGENT }
    });
  } catch {
    throw new LinkedInDescriptionError("network", "linkedin: public detail request failed");
  }
  if (!response.ok) {
    throw new LinkedInDescriptionError(
      statusToKind(response.status),
      `linkedin: public detail returned ${response.status}`
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new LinkedInDescriptionError("network", "linkedin: public detail body failed");
  }
  if (isAuthWall(body)) {
    throw new LinkedInDescriptionError("login_required", "linkedin: auth-wall interstitial");
  }
  const description =
    /<div[^>]*class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      body
    )?.[1];
  if (description === undefined) {
    throw new LinkedInDescriptionError("parse_failed", "linkedin: missing public job description");
  }
  const plainText = htmlToText(description);
  if (plainText.length === 0) {
    throw new LinkedInDescriptionError("parse_failed", "linkedin: empty public job description");
  }
  return plainText;
}

/** One title per call — see `queriesFor` for why the titles are never joined into one
 * `keywords`. LinkedIn's guest search is the same token-fuzzy shape freehire's is. */
function buildUrl(criteria: SearchCriteria, query: string, start: number): string {
  const params = new URLSearchParams();
  if (query.length > 0) {
    params.set("keywords", query);
  }
  if (criteria.locations.length > 0) {
    params.set("location", criteria.locations.join(" "));
  }
  params.set("start", String(start));
  return `${BASE_URL}?${params.toString()}`;
}

/** LinkedIn escapes card text as HTML entities (`&amp;`, `&#39;`, ...); this module has no DOM
 * dependency to lean on, so entities are decoded by hand — the same small, deliberately-simple
 * approach freehire's `htmlToText` takes for the same reason (throwaway markup, not content that
 * needs a real parser). */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

/** Job links carry `position`/`pageNum`/`refId`/`trackingId` query params that identify this
 * specific search session — stripped entirely rather than allow-listed, so a future tracking
 * param LinkedIn adds doesn't need a matching update here. */
function stripTrackingParams(url: string): string {
  const parsed = new URL(url);
  parsed.search = "";
  return parsed.toString();
}

class AuthWallDetected extends Error {}

interface ParsedCard {
  externalId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt: string | null;
  body: string;
}

/** Splits a page of the guest fragment into one block per `<li>...</li>` card. Probed live: no
 * card nests another `<li>`, so this plain split is safe and does not need a real HTML parser. */
function splitCards(body: string): string[] {
  const blocks = body.split("<li>");
  return blocks.slice(1).map((block) => block.split("</li>")[0] ?? "");
}

function matchOrThrow(pattern: RegExp, block: string, label: string): string {
  const match = pattern.exec(block);
  if (!match || match[1] === undefined) {
    throw new Error(`linkedin: missing ${label}`);
  }
  return match[1];
}

/**
 * Pulls the posting url out of a card, which LinkedIn renders in one of **two** shapes,
 * interleaved on the same page:
 *
 *   A) `<div class="base-card …" data-entity-urn=…>` wrapping a separate overlay anchor
 *      `<a class="base-card__full-link …" href="…">` — the common shape.
 *   B) `<a href="…" … class="base-card … job-search-card" data-entity-urn=…>` — the card root
 *      *is* the link. No `base-card__full-link` anywhere in the block, and `href` comes before
 *      `class`.
 *
 * Both are stable renderings of a healthy result set, not a layout change and not a malformed
 * card. Probed live 2026-07-29 against the real endpoint: a single shape-B card sat on page 4 of
 * a two-title crawl, and because only shape A was recognised it discarded that whole page and
 * reported "LinkedIn's page layout changed" on a board whose search was working fine.
 *
 * Shape B is read off the block's own opening tag rather than by pattern-matching the attribute
 * order, because the order is not something this adapter should depend on: shape B happened to
 * put `href` first, and a class-anchored pattern like shape A's is exactly what missed it.
 *
 * Still throws when neither shape yields a url — a card with no link at all is a real parse
 * failure, and the strict page-level detector below depends on that staying true.
 */
function extractPostingUrl(block: string): string {
  const overlayLink = /base-card__full-link[^"]*"\s+href="([^"]+)"/.exec(block)?.[1];
  if (overlayLink !== undefined) return overlayLink;

  const rootTag = /^\s*<a\s[^>]*>/.exec(block)?.[0];
  if (rootTag !== undefined && /\bbase-card\b/.test(rootTag)) {
    const rootHref = /\shref="([^"]+)"/.exec(rootTag)?.[1];
    if (rootHref !== undefined) return rootHref;
  }

  throw new Error("linkedin: missing url");
}

/**
 * Pulls the company name out of a card. The same two shapes described on `extractPostingUrl`
 * differ here too: shape A links the company (`<h4 class="base-search-card__subtitle"><a …>Acme
 * </a></h4>`), shape B renders it as plain text in the same heading, with no anchor at all.
 *
 * The linked form is tried first so the anchor's text is preferred over anything else the
 * heading might wrap, and the plain-text form is read up to the next tag. Throws when the
 * heading itself is absent, which is a genuinely unreadable card.
 */
function extractCompany(block: string): string {
  const linked = /base-search-card__subtitle">\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/s.exec(block)?.[1];
  if (linked !== undefined) return linked;

  const plain = /base-search-card__subtitle">\s*([^<]+?)\s*</.exec(block)?.[1];
  if (plain !== undefined) return plain;

  throw new Error("linkedin: missing company");
}

/** Throws on any card missing a field this adapter depends on — mirrors freehire's
 * fail-the-whole-page behaviour on a malformed record rather than emitting a posting with a
 * blank field. One bad card is treated as the whole page being unrecognised; postings already
 * kept from earlier pages are not affected, and the remaining titles are still searched (see
 * `crawl`). */
function parseCard(block: string): ParsedCard {
  const externalId = matchOrThrow(/data-entity-urn="urn:li:jobPosting:(\d+)"/, block, "job id");
  const rawUrl = extractPostingUrl(block);
  const rawTitle = matchOrThrow(/base-search-card__title">\s*([^<]+?)\s*<\/h3>/, block, "title");
  const rawCompany = extractCompany(block);
  const rawLocation = matchOrThrow(
    /job-search-card__location">\s*([^<]+?)\s*<\/span>/,
    block,
    "location"
  );
  const dateMatch = /job-search-card__listdate"\s+datetime="([^"]+)"/.exec(block);
  const benefitsMatch = /job-posting-benefits__text">\s*([^<]*)/.exec(block);

  const url = stripTrackingParams(decodeEntities(rawUrl));
  if (!url.startsWith("https://")) {
    throw new Error("linkedin: posting url is not absolute");
  }

  // noUncheckedIndexedAccess: a truthy `xMatch` narrows the match object, not the capture-group
  // element access, so `xMatch[1]` is still `string | undefined` even inside `xMatch ? … : …`.
  // Reading the group into a local first (or `?.[1] ?? …`) is the proper narrowing — see #1320.
  const rawDate = dateMatch?.[1];
  const rawBenefits = benefitsMatch?.[1];

  return {
    externalId,
    title: decodeEntities(rawTitle),
    company: decodeEntities(rawCompany),
    location: decodeEntities(rawLocation),
    url,
    postedAt: rawDate ?? null,
    // The guest fragment carries no job description — the plan's own "snippet text" is, in
    // practice, at most one short benefits badge line ("Be an early applicant") and is often
    // absent entirely (flagged to the team lead: there is no distinct snippet field to fall
    // back on, only this). Falling back to "" rather than inventing filler text is deliberate:
    // Task 8's triage genuinely has less signal from this source than from freehire, and that
    // is a real asymmetry, not an oversight.
    body: rawBenefits ? decodeEntities(rawBenefits) : ""
  };
}

interface ParsedPage {
  postings: Posting[];
  hasMore: boolean;
}

function parsePage(bodyText: string): ParsedPage {
  if (isAuthWall(bodyText)) {
    throw new AuthWallDetected("linkedin: auth-wall interstitial");
  }
  const blocks = splitCards(bodyText);
  if (blocks.length === 0) {
    if (looksLikeEmptyResultsPage(bodyText)) {
      return { postings: [], hasMore: false };
    }
    throw new Error("linkedin: no cards and body does not match the known empty-results shape");
  }

  const postings: Posting[] = blocks.map((block) => {
    const card = parseCard(block);
    return {
      id: "",
      sourceId: SOURCE_ID,
      externalId: card.externalId,
      title: card.title,
      company: card.company,
      location: card.location,
      url: card.url,
      body: card.body,
      postedAt: card.postedAt
    };
  });

  return { postings, hasMore: true };
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
    // Nothing at this layer knows the next-scheduled-crawl time; that lives with Task 14's
    // caller. describeFailure's copy degrades gracefully to "the next scheduled crawl" when
    // retryAt is null, and login_required forces it to null regardless.
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
  // No `total` is ever reported by this source (see header) — `expected` stays null throughout,
  // matching freehire's ParsedPage contract but with nothing to ever assign to it here.
  const expected: number | null = null;
  // Overlapping titles return overlapping cards, and LinkedIn's job-posting urn is stable, so a
  // job seen under one title is not emitted again under the next.
  const seen = new Set<string>();

  const queries = queriesFor(args.criteria.titles);
  const pageBudget = pagesPerQuery(queries.length);

  // Set when a page came back unreadable. A parse failure is *per page* — one card shape this
  // adapter has not met yet (see extractPostingUrl) discards the page it appeared on, and
  // returning from the whole crawl at that point handed every remaining title zero requests.
  // That is the exact failure `pagesPerQuery` exists to prevent ("a title that gets no request
  // at all is a silently narrower search"), so it is recorded here and the loop moves on to the
  // next title instead. The failure record is built after every query has run, so its retrieved
  // count is the whole crawl's rather than the count at the moment of the first bad page.
  //
  // Deliberately narrower than the other failure kinds: `deadline` has no time left to spend,
  // `login_required` cannot succeed on any later request, and `rate_limited`/`network` mean the
  // next request is likely to fail the same way — those all still stop immediately.
  let sawParseFailure = false;

  for (const query of queries) {
    // `start` is an offset into *this* query's result set. It used to be `postings.length`, which
    // was the same number only because one crawl ran exactly one query; carried over unchanged it
    // would have started every title after the first partway into its own results.
    let offset = 0;

    for (let page = 0; page < pageBudget; page += 1) {
      if (clock() >= args.deadlineAt) {
        return {
          postings,
          failure: buildFailure("deadline", postings.length, expected, args.lastOkAt)
        };
      }

      let response;
      try {
        response = await args.fetch(buildUrl(args.criteria, query, offset), {
          headers: { "User-Agent": USER_AGENT }
        });
      } catch {
        return {
          postings,
          failure: buildFailure("network", postings.length, expected, args.lastOkAt)
        };
      }

      if (!response.ok) {
        const kind = statusToKind(response.status);
        return { postings, failure: buildFailure(kind, postings.length, expected, args.lastOkAt) };
      }

      let parsed: ParsedPage;
      try {
        const bodyText = await response.text();
        parsed = parsePage(bodyText);
      } catch (error) {
        if (error instanceof AuthWallDetected) {
          // The one case where a 200 status is still a login wall: LinkedIn answers with a
          // sign-in interstitial instead of a 401/403. Classified identically to statusToKind's
          // 401/403 case for the same reason — a retry can never succeed no matter what this
          // module ships, so it is terminal by policy, unlike parse_failed (N16).
          return {
            postings,
            failure: buildFailure("login_required", postings.length, expected, args.lastOkAt)
          };
        }
        sawParseFailure = true;
        break;
      }

      offset += parsed.postings.length;
      for (const posting of parsed.postings) {
        if (seen.has(posting.externalId)) continue;
        seen.add(posting.externalId);
        postings.push(posting);
      }
      if (!parsed.hasMore) break;
    }
  }

  if (sawParseFailure) {
    return {
      postings,
      failure: buildFailure("parse_failed", postings.length, expected, args.lastOkAt)
    };
  }
  return { postings, failure: null };
}

export const linkedinPortal: Portal = {
  id: SOURCE_ID,
  label: SOURCE_LABEL,
  host: "linkedin.com",
  crawl
};
