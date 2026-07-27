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
//
// Ledger N11: title parentheticals are stripped ONLY when the record proves the content is
// a location or a req number — never as a blanket `\([^)]*\)` strip. "Staff Engineer
// (Security)" and "Staff Engineer (ML)" are two different roles and must stay two
// identities; a parenthetical we cannot prove harmless is kept in the identity by default.
// Cost of keeping an unprovable parenthetical: a duplicate row. Cost of stripping a real
// distinguisher: a job the user never sees. Do not "simplify" this back to a blanket regex.

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

// Keywords whose normalised form (lowercased, punctuation collapsed to single spaces)
// unambiguously describes a work arrangement rather than a role — "(Remote)", "(Hybrid)",
// "(On-site)" carry no distinguishing information about the job itself.
const REMOTE_STYLE_KEYWORDS = new Set(["remote", "hybrid", "onsite", "on site", "in office", "wfh"]);

// A req number ("REQ-40185", "40185") is mostly digits. Half-or-more of the alphanumeric
// characters being digits is a cheap, gazetteer-free proxy that doesn't need to recognise
// any particular ticketing system's prefix.
function isDigitDominant(rawParenthetical: string): boolean {
  const alphanumeric = rawParenthetical.replace(/[^a-z0-9]/gi, "");
  if (alphanumeric.length === 0) return false;
  const digitCount = (alphanumeric.match(/[0-9]/g) ?? []).length;
  return digitCount / alphanumeric.length >= 0.5;
}

// Ledger N11's proof, in order: a work-arrangement keyword, a digit-dominant req number, or
// text that the posting's OWN `location` field already names — a parenthetical whose content
// appears in that posting's own location is a location by that posting's own account, no
// gazetteer required. Anything else is unproven and stays in the identity.
function isProvenLocationOrReqNumber(rawParenthetical: string, location: string): boolean {
  const normalizedParenthetical = collapseWhitespace(rawParenthetical);
  if (REMOTE_STYLE_KEYWORDS.has(normalizedParenthetical)) return true;
  if (isDigitDominant(rawParenthetical)) return true;

  const normalizedLocation = collapseWhitespace(location);
  return normalizedLocation.length > 0 && normalizedLocation.includes(normalizedParenthetical);
}

// Deliberately does NOT touch seniority words ("Staff", "Senior", ...), and does NOT strip a
// parenthetical just because it looks like one — only a parenthetical proven harmless by
// `isProvenLocationOrReqNumber` is removed; every other parenthetical passes through into
// the identity, distinguishing text and all.
function normalizeTitle(title: string, location: string): string {
  const withProvenParentheticalsStripped = title.replace(/\(([^)]*)\)/g, (whole, inner: string) =>
    isProvenLocationOrReqNumber(inner, location) ? "" : whole
  );
  return collapseWhitespace(withProvenParentheticalsStripped);
}

/** Stable identity for a posting across portals. */
export function postingIdentity(p: Posting): string {
  return `${normalizeCompany(p.company)}::${normalizeTitle(p.title, p.location)}`;
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
