// tests/unit/job-search-dedupe.test.ts
//
// Task 7 (#1291): pins the cross-portal identity function and merge policy. Cases 1-2 prove
// the normaliser collapses cosmetic differences (punctuation, case, corporate suffix, a
// location qualifier in parens proven by the posting's own `location` field); case 3 is the
// guard against an over-aggressive normaliser whose damage is invisible — a
// wrongly-collapsed posting doesn't error, it just never appears. Cases 4-5 pin the merge
// policy: highest-priority source wins regardless of input order, and a same-source tie
// breaks on the longer body.
//
// Ledger N11: a title parenthetical is stripped only when proven to be a location, a
// work-arrangement keyword, or a req number — never by a blanket `\([^)]*\)` strip. The
// track-qualifier cases below ("(Security)" vs "(ML)", the remote keyword, the req number)
// pin that proof directly.
import { describe, expect, it } from "vitest";

import { dedupePostings, postingIdentity } from "../../external-modules/job-search/src/domain/dedupe.js";
import type { Posting } from "../../external-modules/job-search/src/domain/records.js";

// Single Partial<>-override factory so each test states only the field it is about.
function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: "posting-1",
    sourceId: "freehire",
    externalId: "ext-1",
    title: "Staff Engineer",
    company: "Globex",
    location: "Remote",
    url: "https://example.com/jobs/1",
    body: "A short description.",
    postedAt: null,
    ...overrides
  };
}

describe("job-search postingIdentity (#1291)", () => {
  it("ignores punctuation, case, and company suffixes", () => {
    const a = posting({ company: "Globex, Inc." });
    const b = posting({ company: "globex inc" });

    expect(postingIdentity(a)).toBe(postingIdentity(b));
  });

  it("ignores a location qualifier in the title when the posting's own location proves it", () => {
    // N11: the proof is the posting's own `location` field, not a gazetteer. A fixture with
    // a location-bearing title and an unrelated (or empty) `location` is not a case we owe
    // a merge — a real posting titled "(Seattle)" has Seattle in its location field too.
    const a = posting({ title: "Staff Engineer (Seattle)", location: "Seattle, WA" });
    const b = posting({ title: "Staff Engineer", location: "Seattle, WA" });

    expect(postingIdentity(a)).toBe(postingIdentity(b));
  });

  it("keeps two genuinely different roles at one company apart", () => {
    // Fails against an over-aggressive normaliser that treats seniority as noise — the
    // failure mode this guards is invisible: the dropped posting simply never appears.
    const staff = posting({ title: "Staff Engineer" });
    const senior = posting({ title: "Senior Engineer" });

    expect(postingIdentity(staff)).not.toBe(postingIdentity(senior));
  });

  it("keeps two distinct track qualifiers in parens apart (N11)", () => {
    // This is the exact case the ledger exists to prevent: a blanket parenthetical strip
    // would collapse these into one identity and silently hide one of the two roles.
    const security = posting({ title: "Staff Engineer (Security)", location: "Remote" });
    const ml = posting({ title: "Staff Engineer (ML)", location: "Remote" });

    expect(postingIdentity(security)).not.toBe(postingIdentity(ml));
  });

  it("strips a work-arrangement keyword in parens even without a matching location", () => {
    const a = posting({ title: "Staff Engineer (Remote)", location: "United States" });
    const b = posting({ title: "Staff Engineer", location: "United States" });

    expect(postingIdentity(a)).toBe(postingIdentity(b));
  });

  it("strips a req-number parenthetical, proven by being digit-dominant", () => {
    const a = posting({ title: "Staff Engineer (REQ-40185)", location: "Remote" });
    const b = posting({ title: "Staff Engineer", location: "Remote" });

    expect(postingIdentity(a)).toBe(postingIdentity(b));
  });

  it("does not merge an unrelated location-shaped parenthetical the posting's own location doesn't confirm", () => {
    // The proof is specific to this posting's own location field — a title parenthetical
    // that merely looks like a place name, but isn't backed by this posting's location,
    // is unproven and must stay in the identity by N11's default-keep rule.
    const a = posting({ title: "Staff Engineer (Austin)", location: "Seattle, WA" });
    const b = posting({ title: "Staff Engineer", location: "Seattle, WA" });

    expect(postingIdentity(a)).not.toBe(postingIdentity(b));
  });
});

describe("job-search dedupePostings (#1291)", () => {
  it("keeps the copy from the highest-priority source regardless of input order", () => {
    // Fails against a first-wins map: both orderings must land on the freehire copy.
    const freehireCopy = posting({
      id: "freehire-copy",
      sourceId: "freehire",
      externalId: "fh-1",
      url: "https://freehire.example/jobs/1"
    });
    const linkedinCopy = posting({
      id: "linkedin-copy",
      sourceId: "linkedin",
      externalId: "li-1",
      url: "https://www.linkedin.com/jobs/view/1"
    });
    const sourcePriority = ["freehire", "linkedin"];

    const forward = dedupePostings([freehireCopy, linkedinCopy], sourcePriority);
    const reverse = dedupePostings([linkedinCopy, freehireCopy], sourcePriority);

    expect(forward).toHaveLength(1);
    expect(forward[0].id).toBe("freehire-copy");
    expect(reverse).toHaveLength(1);
    expect(reverse[0].id).toBe("freehire-copy");
  });

  it("keeps the longer body when two postings from the same source tie", () => {
    const shortBody = posting({ id: "short-body", externalId: "a", body: "Short." });
    const longBody = posting({
      id: "long-body",
      externalId: "b",
      body: "A much longer and more detailed description of the role and its responsibilities."
    });

    const result = dedupePostings([shortBody, longBody], ["freehire"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("long-body");
  });

  it("sorts an unranked source after every ranked source", () => {
    // An unranked source is one we have no reason to trust over one we did rank — it must
    // sort last (`sourcePriority.length`), not first (a naive `indexOf === -1 -> 0` bug).
    const unrankedCopy = posting({
      id: "unranked-copy",
      sourceId: "mystery-board",
      externalId: "mb-1"
    });
    const rankedCopy = posting({
      id: "ranked-copy",
      sourceId: "linkedin",
      externalId: "li-1"
    });

    const result = dedupePostings([unrankedCopy, rankedCopy], ["freehire", "linkedin"]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("ranked-copy");
  });

  it("preserves first-seen identity order and passes exact duplicates through untouched", () => {
    const first = posting({ id: "first", company: "Acme", title: "Product Manager", externalId: "a" });
    const second = posting({ id: "second", company: "Globex", title: "Staff Engineer", externalId: "b" });
    const secondAgain = posting({
      id: "second-again",
      company: "Globex, Inc.",
      title: "Staff Engineer",
      externalId: "c",
      sourceId: "linkedin"
    });

    const result = dedupePostings([first, second, secondAgain], ["freehire", "linkedin"]);

    expect(result.map((p) => p.id)).toEqual(["first", "second"]);
  });
});
