// Pure, clock-free ranking (spec "Ranking" — docs/superpowers/specs/2026-07-08-news-module.md;
// same idiom as sports' news-ranking.ts). BROWSER-SAFE: imported by both the service and the
// web mosaic, so no node:* and no ambient clock — order derives only from item fields.

export interface RankableHeadline {
  readonly imageUrl: string | null;
  readonly publishedAt: string | null;
  readonly summary: string;
}

export interface RankInput<T extends RankableHeadline> {
  readonly item: T;
  /** Index within the item's own feed (0 = the source's own lead story). */
  readonly feedPosition: number;
}

/** Editorial weight: art +2, dek +1, source's own lead +2. */
export function storyWeight(item: RankableHeadline, feedPosition: number): number {
  let weight = 0;
  if (item.imageUrl) weight += 2;
  if (item.summary.length > 0) weight += 1;
  if (feedPosition === 0) weight += 2;
  return weight;
}

/** Weight desc → publishedAt desc (nulls last) → input order. Stable. */
export function rankStories<T extends RankableHeadline>(inputs: readonly RankInput<T>[]): T[] {
  return inputs
    .map((input, order) => ({
      item: input.item,
      order,
      weight: storyWeight(input.item, input.feedPosition)
    }))
    .sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      const aTime = a.item.publishedAt ?? "";
      const bTime = b.item.publishedAt ?? "";
      // ISO instants compare correctly as strings; "" (unknown) sorts last under desc.
      if (aTime !== bTime) return aTime < bTime ? 1 : -1;
      return a.order - b.order;
    })
    .map((entry) => entry.item);
}

/**
 * Web-side feature gate, DTO-derivable (the client can't see feed positions after ranking):
 * a feature slot needs both art and a dek to carry broadsheet weight.
 */
export function featureEligible(item: RankableHeadline): boolean {
  return item.imageUrl !== null && item.summary.length > 0;
}
