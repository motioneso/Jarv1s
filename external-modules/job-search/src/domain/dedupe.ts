// external-modules/job-search/src/domain/dedupe.ts
//
// Task 7 (#1291): cross-portal dedupe. Pure domain code: no SDK imports, no network, no
// database access.
//
// Task 6 already collapses two rows sharing one URL. This file exists for the harder case:
// the *same job* posted on freehire (aggregating ~50 ATS boards) and again on LinkedIn has
// two different URLs and two different externalIds, so a URL-keyed dedupe never sees the
// overlap — and overlap with LinkedIn is the normal case for a freehire-sourced posting, not
// the exception.
//
// A wrong merge here is worse than a missed one: two genuinely different roles at one
// company collapsed into a single row is a job the user never sees at all, and the loss is
// invisible — there is no error, just a result that silently isn't there. That is why
// identity keeps seniority words and any non-location title difference apart, and why an
// unranked source is trusted *less* than a ranked one, never more.

import type { Posting } from "./records.js";

// "inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|nv|ab|oy" as whole words, case-insensitive,
// with an optional trailing period ("Inc." and "Inc" both match). Word boundaries matter:
// without them "co" would also strip the "co" inside an unrelated word.
const CORPORATE_SUFFIX_PATTERN =
  /\b(?:inc|llc|ltd|corp|corporation|co|gmbh|plc|sa|nv|ab|oy)\b\.?/gi;

// Shared final pass for both company and title: lowercase, then collapse every run of
// non-alphanumeric characters (commas, periods, extra whitespace, whatever a suffix-strip or
// parenthetical-strip left behind) to a single space, then trim the ends.
function collapseWhitespace(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeCompany(company: string): string {
  return collapseWhitespace(company.replace(CORPORATE_SUFFIX_PATTERN, ""));
}

// Deliberately does NOT touch seniority words ("Staff", "Senior", ...) — only the
// parenthetical is stripped, because a title's parenthetical is assumed to carry a location
// or req number, never the role itself.
function normalizeTitle(title: string): string {
  return collapseWhitespace(title.replace(/\([^)]*\)/g, ""));
}

/** Stable identity for a posting across portals. */
export function postingIdentity(p: Posting): string {
  return `${normalizeCompany(p.company)}::${normalizeTitle(p.title)}`;
}

export function dedupePostings(
  postings: readonly Posting[],
  sourcePriority: readonly string[]
): Posting[] {
  // A source we did not rank is one we have no reason to trust over one we did — it sorts
  // last, not first. `indexOf === -1` maps to `sourcePriority.length`, which is always worse
  // than every ranked index.
  const priorityOf = (sourceId: string): number => {
    const index = sourcePriority.indexOf(sourceId);
    return index === -1 ? sourcePriority.length : index;
  };

  const winners = new Map<string, Posting>();
  // Group-first-seen order, not winner-decided order — so the output order doesn't jump
  // around depending on which portal happened to return the winning copy.
  const identityOrder: string[] = [];

  for (const posting of postings) {
    const identity = postingIdentity(posting);
    const incumbent = winners.get(identity);

    if (!incumbent) {
      winners.set(identity, posting);
      identityOrder.push(identity);
      continue;
    }

    const incumbentPriority = priorityOf(incumbent.sourceId);
    const candidatePriority = priorityOf(posting.sourceId);

    if (candidatePriority < incumbentPriority) {
      winners.set(identity, posting);
    } else if (
      candidatePriority === incumbentPriority &&
      posting.body.length > incumbent.body.length
    ) {
      // Ties within one source break on the fuller description — it's the more useful
      // record, and it's what Task 9's scoring model reads.
      winners.set(identity, posting);
    }
  }

  return identityOrder.map((identity) => winners.get(identity) as Posting);
}
