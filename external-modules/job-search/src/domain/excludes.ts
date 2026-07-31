// external-modules/job-search/src/domain/excludes.ts
//
// Task 6 (#1290): stage 1 of matching — the hard-exclude filter. Pure domain code: no SDK
// imports, no network, no database access.
//
// Stage 1 is conservative by design: anything it drops is never read by a model and never
// reaches the user, so a wrong exclude here is invisible and unrecoverable. Only two things
// are objectively disqualifying — a company the user explicitly named, and a URL already
// seen — and NO third reason may be added in this file. Title, location, and compensation
// look like obvious excludes and are exactly what would kill the product: postings outside
// the stated frame are the ones the user cannot already find on their own. That softer cut
// belongs to stage 2 (Task 8), where a slice is deliberately reserved for out-of-frame
// results. Do not add a filter here just because a `SearchCriteria` field looks unused.

import type { Posting, SearchCriteria } from "./records.js";

export interface ExcludeResult {
  kept: Posting[];
  /** Why each drop happened, so the crawl log can answer "where did they go?" — an
   * untracked drop is unauditable by construction. */
  dropped: Array<{ posting: Posting; reason: "excluded-company" | "duplicate-url" }>;
}

/** `trim().toLowerCase()` on both sides — the only normalisation applied. Used for both
 * the company match and the URL dedupe key so `"  Acme Corp "` catches `"acme corp"` and
 * a re-crawled URL with different case or trailing whitespace still dedupes. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function applyHardExcludes(
  postings: readonly Posting[],
  criteria: SearchCriteria
): ExcludeResult {
  const excludedCompanies = new Set(criteria.excludeCompanies.map(normalize));
  const seenUrls = new Set<string>();
  const kept: Posting[] = [];
  const dropped: ExcludeResult["dropped"] = [];

  // Single pass, input order preserved in `kept` — first occurrence of a URL wins, every
  // later duplicate is dropped and recorded, never silently discarded.
  for (const posting of postings) {
    if (excludedCompanies.has(normalize(posting.company))) {
      dropped.push({ posting, reason: "excluded-company" });
      continue;
    }

    const urlKey = normalize(posting.url);
    if (seenUrls.has(urlKey)) {
      dropped.push({ posting, reason: "duplicate-url" });
      continue;
    }
    seenUrls.add(urlKey);
    kept.push(posting);
  }

  return { kept, dropped };
}
