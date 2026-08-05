// external-modules/job-search/src/domain/surface.ts
//
// Task 10 (#1294): pure shaping of what the board and the briefing display. Pure domain
// code — no SDK imports, no network, no database access.
//
// Every string this file emits is assembled from record fields (L9). No model prose reaches
// the briefing or the board through this file — a screenshot of either is reproducible from
// the underlying `Match`/`Posting`/`FailureCause` rows alone.

import type { FailureCause, Match, Posting } from "./records.js";

/** Counts `state === "new"` only — not `seen`, not `dismissed`, and not `unscored`. An
 * unscored match has no numbers yet, and announcing it would send the user to an empty row. */
export function newMatchCount(matches: readonly Match[]): number {
  return matches.filter((match) => match.state === "new").length;
}

function headline(totalNew: number, profiles: ReadonlyArray<{ name: string }>): string {
  const noun = totalNew === 1 ? "match" : "matches";
  if (profiles.length <= 1) {
    const name = profiles[0]?.name ?? "your search";
    return `${totalNew} new job ${noun} in ${name}.`;
  }
  const names = profiles.map((profile) => profile.name).join(", ");
  return `${totalNew} new job ${noun} across ${names}.`;
}

type BriefingItem = { id: string; title: string; detail: string; href?: string };

/** `want` descending, nulls treated as lowest — Fit is what an employer thinks, Want is
 * what the user thinks, and the briefing is for the user. */
function byWantDescending(a: Match, b: Match): number {
  return (b.want ?? -1) - (a.want ?? -1);
}

function matchItem(
  profileId: string,
  match: Match,
  postings: ReadonlyMap<string, Posting>
): BriefingItem | null {
  const posting = postings.get(match.postingId);
  if (!posting) {
    // No record to name the match by — skip rather than guess at a title.
    return null;
  }

  const axes = `Fit ${match.fit} · Want ${match.want}`;
  return {
    id: match.id,
    title: `${posting.title} at ${posting.company}`,
    // Out-of-frame matches are flagged, never presented as ordinary hits — the recall slice
    // only works if the user can see which results it produced.
    detail: match.outsideFrame ? `${axes} · outside what you asked for` : axes,
    href: `/m/job-search/${profileId}/matches/${match.id}`
  };
}

function degradedItem(cause: FailureCause): BriefingItem {
  return {
    id: `degraded:${cause.sourceId}`,
    title: `${cause.sourceId} is degraded`,
    // The cause's own copy, verbatim — a silent partial crawl is the failure mode the spec
    // forbids, and the level the user is most likely to have selected is the one that would
    // hide it, so this item is added at every detail level, including "count".
    detail: cause.summary
  };
}

export function buildBriefingContribution(input: {
  profiles: ReadonlyArray<{
    id: string;
    name: string;
    matches: readonly Match[];
    postings: ReadonlyMap<string, Posting>;
  }>;
  detail: "count" | "top" | "full";
  degraded: readonly FailureCause[];
}): { headline: string; items: BriefingItem[] } {
  const { profiles, detail, degraded } = input;

  const perProfileNew = profiles.map((profile) => ({
    profile,
    newMatches: profile.matches.filter((match) => match.state === "new")
  }));
  const totalNew = perProfileNew.reduce((sum, entry) => sum + entry.newMatches.length, 0);

  const items: BriefingItem[] = [];

  // Degraded portals are surfaced first — a partial crawl is the thing the user is most
  // likely to miss if it sits below a long list of matches.
  for (const cause of degraded) {
    items.push(degradedItem(cause));
  }

  if (detail === "top" || detail === "full") {
    for (const { profile, newMatches } of perProfileNew) {
      const ordered = [...newMatches].sort(byWantDescending);
      const selected = detail === "top" ? ordered.slice(0, 3) : ordered;

      for (const match of selected) {
        const item = matchItem(profile.id, match, profile.postings);
        if (item) {
          items.push(item);
        }
      }
    }
  }

  return {
    headline: headline(totalNew, profiles),
    items
  };
}
