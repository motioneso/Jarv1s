### Task 8: Embedding triage with the reserved recall slice (stage 2)

The cost-control stage, and the one most likely to be implemented wrong. A naive "keep the top N by
similarity to the criteria" implementation silently deletes the product's entire reason for existing.

**Depends on:** Task 5 (`Posting`). Task 14 supplies the similarity maps.

**Files**

- Create: `external-modules/job-search/src/domain/triage.ts`
- Test: `tests/unit/job-search-triage.test.ts`

**Contracts**

```ts
export interface TriageInput {
  postings: readonly Posting[];
  /** Similarity of each posting to the stated criteria, keyed by posting id, 0..1. */
  criteriaSimilarity: ReadonlyMap<string, number>;
  /** Similarity to the user's broader profile — goals, notes, past conversation. */
  profileSimilarity: ReadonlyMap<string, number>;
  /** How many postings the scoring model will read this pass. */
  budget: number;
}
export interface TriageResult {
  /** Ordered: in-frame first, then the reserved recall slice. */
  selected: Array<{ posting: Posting; outsideFrame: boolean }>;
  /** How many postings were considered but not selected. Shown as a count only. */
  deferred: number;
}
export function triage(input: TriageInput): TriageResult;

/** Share of the budget reserved for postings the stated criteria would have missed. */
export const RECALL_SLICE = 0.2;

/** A posting is "outside the stated frame" when it is a poor match for what the
 * user asked for but a strong match for who they are. */
const OUTSIDE_FRAME_CRITERIA_MAX = 0.5;
const OUTSIDE_FRAME_PROFILE_MIN = 0.6;
```

**Constraints**

- **`RECALL_SLICE` is not a tuning knob.** It is the recall case — the whole reason the product beats
  a keyword search. Do not lower it to save tokens.
- **A posting is out-of-frame when `criteria ≤ 0.5` AND `profile ≥ 0.6`.** Both halves are required:
  low criteria similarity alone is just a bad match.
- **The reservation formula is the decision.** With `outside` and `inFrame` bucketed and ranked
  (outside by `profileSimilarity` desc, in-frame by `criteriaSimilarity` desc):
  - no out-of-frame candidates → `reserved = 0`;
  - no in-frame candidates → `reserved = budget` (spend the whole pass on recall);
  - otherwise `reserved = min(max(1, floor(budget * RECALL_SLICE)), budget - 1)`.

  The `max(1, …)` is the floor: at least one recall seat whenever a candidate exists, even at budgets
  where the percentage floors to zero — one seat is the difference between the feature existing and
  not existing. The `budget - 1` is the ceiling: the recall slice is a floor on recall, not a licence
  to spend the user's entire pass on a hunch. At budget 1 with both kinds present, the stated criteria
  win.
- **Whichever pool runs dry hands its unused seats to the other, in similarity order.** Without
  backfill, a reservation held against a pool with one candidate burns seats the scoring model had
  budget for — 1 in-frame + 5 outside at budget 5 would select 2 and defer 4 while the model sits
  idle.
- **Bucket in one pass.** The obvious `postings.filter(p => !outside.includes(p))` is O(n²) over a
  list that routinely holds several hundred postings after a sweep.
- **No similarity value may appear anywhere in the result** (L9). The triage score is a cost-control
  device; if it can be read off the result it will eventually be rendered, and rendering it is a spec
  violation.
- **A missing similarity entry reads as 0**, so a posting that failed to embed degrades to in-frame
  and low-ranked rather than throwing.
- **`budget <= 0` or no postings returns `{selected: [], deferred: postings.length}`** — deferral is
  always reported, never silent.

**Tests**

`tests/unit/job-search-triage.test.ts`. Every case builds explicit similarity maps, so each one names
the exact selection rule it defends.

1. **A slice of the budget is reserved for postings the criteria would have missed.** Eight in-frame
   (criteria 0.9 / profile 0.4) and two out-of-frame (0.2 / 0.95), budget 5 → 5 selected, of which
   exactly `["out0"]` is `outsideFrame` (`floor(5 * 0.2) = 1`). Also pins `RECALL_SLICE === 0.2`, so
   silently tuning it to zero fails a test rather than quietly changing the product.
2. **At least one recall slot exists when a candidate does.** Budget 2, where `floor(2 * 0.2) = 0` —
   one out-of-frame posting still gets a seat. Fails against a pure-percentage implementation, whose
   small-budget behaviour is to drop the feature entirely.
3. **The unused seats of a dry pool are backfilled.** One in-frame, five out-of-frame, budget 5 → 5
   selected, 4 outside, 1 deferred. Fails against the reservation-without-backfill implementation,
   which selects 2 and defers 4.
4. **The last seat goes to the stated criteria.** Budget 1 with both kinds → the in-frame posting,
   `outsideFrame === false`. The other half of case 2: it proves the floor is not also a priority.
5. **With nothing in frame, the whole budget goes to recall** — budget 1, two out-of-frame → one
   selected, `outsideFrame === true`.
6. **With nothing out of frame, the recall slots go to in-frame postings** — four in-frame, budget 3 →
   3 selected, none marked outside. Guards against reserving a seat that no candidate can fill.
7. **Deferrals are reported, not dropped silently** — ten postings, budget 4 → `deferred === 6`. The
   count is what the crawl summary shows; a zero here would tell the user everything was considered.
8. **No similarity value reaches the caller** — `JSON.stringify(result)` does not contain `"0.77"`
   when that was the input similarity. Cheap, and it fails the moment someone adds a debug field.

**Verify**

```bash
pnpm vitest run tests/unit/job-search-triage.test.ts   # exit 0
```

---
