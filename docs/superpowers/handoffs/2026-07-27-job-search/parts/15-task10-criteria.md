### Task 10: Criteria extraction and surfacing shapes

Two files: the strict criteria parser plus onboarding-progress derivation, and the pure shaping of
what the board and the briefing display.

**Depends on:** Task 5 (`SearchCriteria`, `Match`, `Posting`, `FailureCause`). Task 15 reads
`context_summary`; Task 16 writes it; Task 19 renders the briefing contribution.

**Files**

- Create: `external-modules/job-search/src/domain/criteria.ts`
- Create: `external-modules/job-search/src/domain/surface.ts`
- Test: `tests/unit/job-search-criteria.test.ts`
- Test: `tests/unit/job-search-surface.test.ts`

**Contracts**

```ts
// criteria.ts
export const CRITERIA_SCHEMA: object;
export function parseCriteria(raw: unknown): SearchCriteria; // strict, throws

/** Which onboarding steps the stored criteria satisfy. Drives the progress
 * readout — derived from the record, never from what the model claimed. */
export const ONBOARDING_STEPS: readonly ["role", "want", "where", "comp", "sources"];
export function completedSteps(
  criteria: Partial<SearchCriteria>,
  enabledPortals: number
): Array<(typeof ONBOARDING_STEPS)[number]>;
export function isReadyToCrawl(criteria: Partial<SearchCriteria>, enabledPortals: number): boolean;

/** Hard bound on the profile's `context_summary`. */
export const CONTEXT_SUMMARY_MAX = 1200;
/** Validate a distilled context summary before it is stored. Strict, throws. */
export function parseContextSummary(raw: unknown): string;

// surface.ts
export function newMatchCount(matches: readonly Match[]): number;
export function buildBriefingContribution(input: {
  profiles: ReadonlyArray<{
    id: string;
    name: string;
    matches: readonly Match[];
    postings: ReadonlyMap<string, Posting>;
  }>;
  detail: "count" | "top" | "full";
  degraded: readonly FailureCause[];
}): {
  headline: string;
  items: Array<{ id: string; title: string; detail: string; href?: string }>;
};
```

**Constraints — `criteria.ts`**

- **`parseCriteria` is strict in the same shape as `parseScoreResult`** (Task 9): reject unknown keys,
  reject bad enum values, and default **only** absent list fields to `[]` and absent scalars to
  `null`. It never invents content — an absent `compFloorCents` is `null`, not a guess.
- **Onboarding progress is derived from the stored record, never from the model's claim** that it
  "got" something. If the field is empty the step is not done, whatever the transcript says. Step
  rules: `role` ← `titles.length > 0`; `want` ← non-blank `wantNarrative`; `where` ←
  `locations.length > 0` **or** `remote === "required"`; `comp` ← `compFloorCents` is neither null nor
  undefined; `sources` ← `enabledPortals > 0`.
- **`sources` comes from enabled portals, not from criteria.** It is the one step whose evidence lives
  outside the criteria object.
- **Ready to crawl needs `role`, `want` and `sources` only.** Comp and location stay optional: plenty
  of people genuinely have no floor, and forcing one puts a number in the record the user did not
  mean.
- **`context_summary` has three rules, all enforced in `parseContextSummary` because it is the only
  place the value is admitted:**
  - **Provenance** — model-distilled but user-confirmed. The only writer is Task 16's
    `job-search.profile.set-context` tool, which the user sees and approves like any other tool call.
    Raw transcript is never stored. The record is exportable and deletable under NFR-7, so the user
    has to be able to recognise it as theirs.
  - **Bounds** — 1200 characters. This string rides in `buildScorePrompt` once per posting, so its
    length multiplies across the whole scored batch; it is a budget line, not just a field. Over the
    cap is a **rejection, never a truncation** — a half-sentence fed to the scorer on every posting is
    worse than a distiller that has to try again.
  - **Refresh** — replaced wholesale on every confirmation, never appended. An accreting summary
    drifts out of date, silently outgrows the cap, and ends up asserting things the user has since
    changed their mind about. Clearing it is `null`, which is why the empty string is rejected rather
    than treated as an erase.
- **Control characters are rejected outright**, newlines included. The summary is one flowing
  paragraph by construction, so no control character has a legitimate use, and forbidding the lot is
  easier to reason about than an allowlist. A NUL in particular must never reach Postgres — it aborts
  the statement rather than storing anything. Regex `/[\u0000-\u001f\u007f]/`, with an
  `eslint-disable-next-line no-control-regex` above it.
- **The summary carries exactly the authority of a user turn.** It enters a model prompt; it is not an
  instruction channel, and nothing downstream may treat it as one.
- **`buildScorePrompt` takes `context_summary` or `""`.** Task 15 reads the column, Task 16 writes it;
  until both land the column is dead weight, so do not skip either.

**Constraints — `surface.ts`**

- **Every string it emits is assembled from record fields** (L9). No model prose reaches the briefing
  or the board through this file.
- **`newMatchCount` counts `state === "new"` only** — not `seen`, not `dismissed`, and not `unscored`.
  An unscored match has no numbers yet and announcing it would send the user to an empty row.
- **`detail: "top"` takes the first three matches per profile ordered by `want` descending;
  `"full"` takes all.** Ordered by Want, not Fit and not a blend: Fit is what an employer thinks, Want
  is what the user thinks, and the briefing is for the user.
- **A degraded portal always contributes an item, at every detail level including `"count"`.** A
  silent partial crawl is the failure mode the spec forbids, and the level the user is most likely to
  have selected is the one that would hide it.
- **Out-of-frame matches are flagged, never presented as ordinary hits** — the detail line ends
  `· outside what you asked for`. The recall slice only works if the user can see which results it
  produced.

**Tests**

`tests/unit/job-search-criteria.test.ts`:

1. **An unknown `remote` value is rejected rather than defaulted** — `"maybe"` throws
   `/remote must be one of/`. A defaulting parser silently changes the search.
2. **Absent list fields become `[]` and absent scalars `null`, with nothing invented** — supplied
   `titles` survive, `dealbreakers` is `[]`, `compFloorCents` is `null`.
3. **A step counts as done only when its field actually holds something** —
   `{titles, wantNarrative}` with zero portals yields exactly `["role", "want"]`.
4. **`sources` is counted from enabled portals, not criteria** — `completedSteps({}, 2)` is
   `["sources"]`.
5. **Ready-to-crawl needs a role, a want and at least one source** — true with all three; false with
   zero portals; false with no want. Three assertions, one per required step, so a regression names
   which one.
6. **A short context summary is accepted and trimmed.**
7. **A summary over the cap is rejected, not truncated** — `CONTEXT_SUMMARY_MAX + 1` characters throws
   `/context summary must be 1200 characters or fewer/`.
8. **An empty or whitespace-only summary is rejected** — `"   "` throws. Storing it would read as "we
   have context" while carrying none.
9. **Control characters are rejected, newlines included** — both a literal NUL and a `\n` inside the text throw
   `/must not contain control characters/`. The NUL case is the one that would otherwise abort a
   Postgres statement at write time, far from here.
10. **A non-string is rejected** — `{text: "hi"}` throws.

`tests/unit/job-search-surface.test.ts`:

11. **`newMatchCount` counts only unseen scored matches** — a fixture of `new, new, seen, dismissed,
    unscored` yields 2. Each of the three excluded states is a distinct wrong implementation.
12. **At detail `"count"`, there is a headline and no items** — `"2 new job matches in Software
    Engineer."` and `items` is empty.
13. **At detail `"top"`, every item names both axes separately** — detail is exactly
    `"Fit 82 · Want 91"`, title is `"Staff Engineer at Globex"`. Exact equality is the assertion that
    catches a blended `"87% match"` (L9).
14. **An out-of-frame match is flagged** — `"Fit 74 · Want 88 · outside what you asked for"`.
15. **A degraded portal is reported in the briefing rather than passed over in silence** — with
    `detail: "count"` and one `rate_limited` cause, some item's detail contains the cause summary.
    Deliberately asserted at the quietest detail level.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-criteria.test.ts tests/unit/job-search-surface.test.ts   # exit 0
```

---
