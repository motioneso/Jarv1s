// tests/unit/external-module-finance-web-household.test.ts
import { describe, expect, it } from "vitest";

import { resolveSharedOwners } from "../../external-modules/finance/src/web/household.js";

// FIN-04 (#1149) Task 5: the web-side owner resolution for the merged
// household feed. Workers can't call host routes, so the deleted-owner
// fail-closed drop lives HERE: a shared entry is only rendered when its
// ownerUserId resolves against GET /api/users/directory (active users only).
// Directory unavailable (fetch failed / null) → drop every shared entry
// rather than show unattributed household data.

const OWNER = "00000000-0000-4000-8000-0000000000bb";
const GONE = "00000000-0000-4000-8000-0000000000cc";

// Typed with the optional tag fields (like FeedAccount) but WITHOUT them at
// runtime — production own entries never carry shared/ownerUserId, and the
// weak-type constraint on resolveSharedOwners needs the annotation.
const own: { accountId: string; name: string; shared?: boolean; ownerUserId?: string } = {
  accountId: "acc-1",
  name: "Checking"
};
const sharedBy = (ownerUserId: string) => ({
  accountId: "acc-x",
  name: "Joint Checking",
  shared: true as const,
  ownerUserId
});

describe("resolveSharedOwners (#1149)", () => {
  it("passes non-shared entries through untouched", () => {
    expect(resolveSharedOwners([own], [])).toEqual([own]);
    expect(resolveSharedOwners([own], null)).toEqual([own]);
  });

  it("annotates shared entries with the owner's directory name", () => {
    const result = resolveSharedOwners([own, sharedBy(OWNER)], [{ id: OWNER, name: "Alex" }]);
    expect(result).toEqual([own, { ...sharedBy(OWNER), ownerName: "Alex" }]);
  });

  it("falls back to a neutral label when the owner has no display name", () => {
    const result = resolveSharedOwners([sharedBy(OWNER)], [{ id: OWNER, name: null }]);
    expect(result).toEqual([{ ...sharedBy(OWNER), ownerName: "Household member" }]);
  });

  it("drops shared entries whose owner is not in the directory (deactivated/deleted)", () => {
    const result = resolveSharedOwners([own, sharedBy(GONE)], [{ id: OWNER, name: "Alex" }]);
    expect(result).toEqual([own]);
  });

  it("drops ALL shared entries when the directory is unavailable (fail-closed)", () => {
    const result = resolveSharedOwners([own, sharedBy(OWNER)], null);
    expect(result).toEqual([own]);
  });
});
