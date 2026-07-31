### Task 7: Cross-portal dedupe

The same job appears on LinkedIn and on the company's own ATS board behind freehire. Showing it twice
destroys the board's density argument, and freehire aggregates ~50 ATS boards, so overlap with
LinkedIn is the normal case rather than the exception.

**Depends on:** Task 5 (`Posting`).

**Files**

- Create: `external-modules/job-search/src/domain/dedupe.ts`
- Test: `tests/unit/job-search-dedupe.test.ts`

**Contracts**

```ts
/** Stable identity for a posting across portals. */
export function postingIdentity(p: Posting): string;
export function dedupePostings(
  postings: readonly Posting[],
  sourcePriority: readonly string[]
): Posting[];
```

**Constraints**

- **Identity is `normalizedCompany::normalizedTitle`**, not the URL. Task 6 already collapses
  identical URLs; the same job on two portals has two different URLs and two different `externalId`s,
  which is the entire case this task exists for.
- **Company normalisation strips corporate suffixes** — `inc|llc|ltd|corp|corporation|co|gmbh|plc|
  sa|nv|ab|oy` as whole words — then lowercases and collapses everything non-alphanumeric to single
  spaces. "Globex" and "Globex, Inc." are one company.
- **Title normalisation strips parentheticals** before the same lowercase/collapse pass. Titles
  routinely carry a location or req number that is not part of the role: "Staff Engineer (Seattle)"
  and "Staff Engineer" are one job.
- **Do not normalise seniority words away.** "Staff Engineer" and "Senior Engineer" are two jobs at
  one company, and collapsing them silently hides one.
- **An unranked source sorts last, not first** — `indexOf === -1` maps to `sourcePriority.length`. A
  source we did not rank is one we have no reason to trust over one we did.
- **Ties within one source break on longer `body`.** The fuller description is the more useful record
  and it is what the scoring model in Task 9 reads.
- **Dedupe runs after Task 6's hard excludes, before triage.** Running it first would let an excluded
  company's copy win the identity contest and survive as the kept record.

**Tests**

`tests/unit/job-search-dedupe.test.ts`, from a single `Partial<Posting>` factory:

1. **Identity ignores punctuation, case, and company suffixes** — `"Globex, Inc."` and `"globex inc"`
   produce the same key.
2. **Identity ignores a location qualifier in the title** — `"Staff Engineer (Seattle)"` equals
   `"Staff Engineer"`.
3. **Identity keeps two genuinely different roles at one company apart** — `"Staff Engineer"` and
   `"Senior Engineer"` differ. The guard against an over-aggressive normaliser, whose damage is
   invisible: the dropped posting simply never appears.
4. **The copy from the highest-priority source wins.** With `["freehire", "linkedin"]`, the freehire
   copy survives regardless of input order. Fails against a first-wins map.
5. **When sources tie, the longer body wins.**

**Verify**

```bash
pnpm vitest run tests/unit/job-search-dedupe.test.ts   # exit 0
```

---
