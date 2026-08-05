### Task 6: Hard-exclude filter (stage 1)

Stage 1 removes only what is objectively disqualifying. It must be conservative: anything it drops is
never read by a model and never reaches the user, so a wrong exclude is invisible.

**Depends on:** Task 5 (`Posting`, `SearchCriteria`).

**Files**

- Create: `external-modules/job-search/src/domain/excludes.ts`
- Test: `tests/unit/job-search-excludes.test.ts`

**Contracts**

```ts
export interface ExcludeResult {
  kept: Posting[];
  /** Why each drop happened, so the crawl log can answer "where did they go?" */
  dropped: Array<{ posting: Posting; reason: "excluded-company" | "duplicate-url" }>;
}
export function applyHardExcludes(
  postings: readonly Posting[],
  criteria: SearchCriteria
): ExcludeResult;
```

**Constraints**

- **Exactly two drop reasons exist, and no third may be added here.** A company the user named, or the
  same URL twice. Title, location and compensation look like obvious excludes and are the exact thing
  that would kill the product: the postings outside the stated frame are the ones the user cannot find
  on their own. Relevance is stage 2's job (Task 8), where the cut is soft and a slice is reserved for
  out-of-frame results.
- **Never exclude on a missing field.** Most postings omit compensation; excluding on absent comp
  deletes the market.
- **Company matching is normalised** — `trim().toLowerCase()` on both sides. A user typing
  `"Acme Corp"` must catch `"  acme corp "`.
- **URL dedupe is first-wins and normalised the same way.** Order of `kept` follows input order.
- **Every drop is recorded, never silently discarded** — `dropped` is what lets the crawl log answer
  "where did they go?", and an untracked drop is unauditable by construction.

**Tests**

`tests/unit/job-search-excludes.test.ts` — build `Posting` and `SearchCriteria` from small
`Partial<>`-override factories so each case states only the field it is about.

1. **A company on the exclude list is dropped, case- and whitespace-insensitively.** Company
   `"  acme corp "` against `excludeCompanies: ["Acme Corp"]` — zero kept, reason
   `"excluded-company"`. Fails against a naive `includes`/exact-match implementation.
2. **A posting far from the stated location is kept.** A Dublin posting against
   `locations: ["Seattle, WA"]` survives. This is the recall case the product exists to catch, and the
   assertion is what stops a later "obvious optimisation" from deleting it.
3. **A posting with no salary listed is kept**, even under a high `compFloorCents`. Guards the
   missing-field rule above.
4. **A posting whose title does not match the stated titles is kept** — `"Forward Deployed Engineer"`
   against `titles: ["Software Engineer"]`. The adjacent-title case; a title filter here would look
   correct in every demo and quietly remove the best results.
5. **Two postings sharing a URL collapse to one**, with reason `"duplicate-url"` on the second.

Cases 2–4 are the load-bearing ones: they assert what this function must **not** do, and they are the
only defence against a plausible, well-meaning implementation that filters on the criteria it is
handed.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-excludes.test.ts   # exit 0
```

---
