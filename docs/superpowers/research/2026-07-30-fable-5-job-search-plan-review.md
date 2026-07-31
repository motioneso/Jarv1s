# Fable 5 Review — Job Search Post-Onboarding UX Plan (#1375)

**Date:** 2026-07-30
**Reviewer:** Fable 5, independent adversarial plan review (read-only)
**Reviewed documents:** spec `docs/superpowers/specs/2026-07-30-job-search-post-onboarding-ux-corrections.md`,
plan `docs/superpowers/plans/2026-07-30-job-search-post-onboarding-ux-corrections.md`, both evidence
reports, and the approved module design spec.
**Code base inspected:** this worktree at `814da226` (review branch = `90013f12` + #1246's three
implementation commits + the research/spec/plan commits). Where the plan's base differs
(`feat/job-search` at `5eaf9560`), that is noted per finding.

## Verdict: approve with changes

The plan names real files, real seams, and real contracts — nearly every claim I checked against
source is true. Two findings are blocking. Both are omissions the existing code documents loudly
enough that the build agent would either ship a regression (B1) or ship a slice that cannot meet its
own success criteria on the live board (B2). Neither requires redesign; both are bounded edits to
Task 1/Task 11 and one honest sentence in the spec.

## Blocking findings

### B1 — The 16 000-character render cap will destroy `match.get` once `body` is added (severity: blocker)

**Verified fact.** The board's REST route ends at `boundedAssistantToolResultData`
(`packages/ai/src/routes.ts:712`), which **throws away the entire structured result** and
substitutes `{text: "…truncated"}` once the rendered form passes 16 000 characters. This is
documented as ruling N5 at the top of the very file Task 1 modifies
(`external-modules/job-search/src/worker/handlers/matches.ts:15-22`), and every constant in that
file is sized against it. `MatchDetail` is currently exempt from the bounding arithmetic _only
because it is small_ (`matches.ts:104-108`: "one record … nothing here needs `truncateText`").

Task 1 adds an unbounded `body` to that response. LinkedIn and freehire descriptions routinely run
3 000–10 000+ characters; stacked on the already-untruncated `fitReason`/`wantReason`, a single long
posting crosses the cap — and the failure mode is not a shortened description but a **null
inspector**: no reasons, no scores, no body. This module has already lost a live board to this exact
cap class once (the 16k budget guard applied to a browser read).

**Required change.** Task 1 must bound the description on the wire (and preferably at storage):
a `BODY_MAX_CHARS` sized by the same arithmetic as the existing worst-case render-survival test in
`tests/unit/job-search-match-handler.test.ts`, plus a new worst-case test with `body`, both reasons,
and every identity field at cap, asserting the rendered detail stays under the cap. Task 6's
"unavailable" fallback then also covers the truncated-tail case honestly (a capped body is still a
body; only the substitution must be made impossible).

### B2 — Spec §6.2's "existing matches are corrected on their next ordinary scoring pass" is false; the live false positives never self-correct (severity: blocker for the spec's success criteria)

**Verified fact.** `runScore` selects candidates from exactly two sets
(`external-modules/job-search/src/worker/stages/score.ts:158-188`): `"unscored"` — postings with no
match row yet (`listUnscoredPostingsWithEmbeddings`) — and `"unfitted"` — matches with `fit IS NULL`,
which only the résumé-replacement refit path populates. **A scored match never re-enters an ordinary
pass.** The Jacobs "Strong fit / different profession" row that motivates this whole slice keeps its
Strong band forever after this ships, unless the user happens to replace their résumé. Spec success
criterion 1 ("explicit mismatch/dealbreaker evidence cannot coexist with a Strong fit band") is
therefore not met by the plan as written for any pre-existing row, and Task 11's live proof would
still show the contradiction on the live board.

**Required change — pick one, explicitly:**

1. _Smallest real fix:_ reuse the existing refit machinery (`candidates: "unfitted"` and the
   résumé-replace precedent of nulling `fit`) to enqueue a one-time re-score of existing scored
   matches after deploy — a targeted `fit = NULL` pass over the profile's scored rows, not a new
   subsystem. Budget/deadline behavior is already handled by `runScore`.
2. _Honest deferral:_ amend spec §6.2 to state that already-scored rows retain stale bands until a
   refit event, and change Task 11's live proof to demonstrate coherence on newly crawled rows only.

Either is acceptable; silently shipping with the current sentence is not. (Related memory: the
résumé-refit path itself was once broken precisely because `fit IS NULL` found zero rows on a scored
board — the refit route is the proven vehicle here.)

## Important non-blocking findings

Ranked by severity.

### N1 — Task 1 puts a network fetch and a DB write inside a `risk: "read"` tool

`match.get` is read-classified precisely so the browser can call it — a `write` tool 403s with
`confirmation_required` before `execute` (`matches.ts:180-186`, `317-330`). Enrichment adds
`fetch` + `upsertPostings` inside that read path. As a cache-fill of public data this is defensible,
but the plan should say so out loud (in the handler comment and spec §9), because it deliberately
bends a documented platform boundary. Concretely required: the enrichment fetch needs its own
timeout well inside the invocation deadline — `deadlineAt` is the instant the host kills the
invocation with zero headroom (the same trap `stages/score.ts:69-71` documents) — so a slow LinkedIn
response degrades to `body: ""` instead of killing the whole detail read. Concurrent double-opens
double-fetch harmlessly (idempotent upsert); worth one sentence, not machinery.

### N2 — Failed enrichment retries on every inspector open, unbounded

Plan: "A failed enrichment still returns the match with `body: ''`" — nothing records the failure,
so every subsequent open of that match re-fetches LinkedIn (auth wall, removed posting, parse
failure, 429 — all permanent or slow-changing). A user paging through dozens of old rows generates
that many LinkedIn hits; this module has already been rate-limited by LinkedIn mid-crawl. Smallest
fix: persist a "description fetch attempted" marker on the posting (a timestamp or structured cause
field within the existing row, or an in-invocation KV entry) and skip re-fetching for a bounded
period. Also state explicitly that an enrichment 429/auth-wall must **not** write portal-level
failure state — it is a per-posting read, not a crawl.

### N3 — Task 5's row Save/Pass will target unscored rows that have no real match id

Unscored rows carry a synthetic posting-id "match id" that is "never a real row"
(`matches.ts:275-278`), and `match.set-state`'s settable states deliberately exclude `unscored`
(`matches.ts:79-84`). "Add Save and Pass buttons to each undecided row" must exclude
unscored/queued rows or the queue write fails after the optimistic update. Add one behavior line
and one unit test.

### N4 — Task 3 asserts "three successful gateway execution sites"; the gateway has eight `action_result` emit sites

`packages/ai/src/gateway/gateway.ts` emits `action_result` at lines 167, 187, 226, 309, 344, 356,
560, 581. The success/denial/error split may well reduce to three success sites, but the task should
require enumerating them at implementation time and testing that denial/error sites carry no result
data — not inherit the count from the plan. Also `tests/unit/gateway-action-result-invalidation.test.ts`
does not exist (every other named test file does); mark it Add, not Test-modify. The persistence
mechanism itself is sound: `tool_metadata.activity` is already read back through `readActivity`
(`packages/chat/src/route-serializers.ts:47`), and `TranscriptRecord.result` exists
(`packages/chat/src/live/types.ts:23`), so the reload-survival design rides an existing pattern.
One addition: require that persisted `statusText` is capped _and_ provably module-authored (from the
tool's return contract, never echoed input) so the secrets-never-escape review stays mechanical.

### N5 — Band thresholds get a second, hand-synced copy in the worker

The caps 84/39 encode `fitBand`'s boundaries (strong ≥ 85, weak < 40) from
`external-modules/job-search/src/web/keyline.tsx:115-120` — a file whose own header calls those
thresholds "a starting point, not a locked decision." Putting 84/39 as literals in
`stages/score.ts` recreates the two-literals-drift problem this module already solved once with
`MATCHES_LIST_MAX_LIMIT` (ruling N43, `matches.ts:40-48`). Export the band boundaries from one
domain module and derive both the caps and `fitBand` from it.

### N6 — Branch preparation: two corrections

Verified: `1a2b3648`/`05cd594c`/`e76e199d` touch `jarvis.module.json`, `packages/module-registry`,
`packages/module-sdk`; `b3ba0152` touches `apps/worker` — no file overlap, so the cherry-picks onto
`5eaf9560` should be clean. But: (1) **`origin/feat/job-search` is at `85ac3512`; `5eaf9560` exists
only in the local clone.** The build worktree must fetch from the local repo or the base must be
pushed first — record which. (2) The cherry-pick list includes the spec commits but omits the plan's
own commit (`ba935305`); either add it or drop the doc cherry-picks entirely — the build branch
needs the #1246 grants to function, but it does not need research documents to build.

### N7 — Verification gaps against the live evidence (review question 8)

The proposed tests catch most of the evidence-report failures (bucket divergence, "every morning,"
unnamed switch, scroll loss, contradiction persistence for _new_ rows). Three gaps: (a) no
render-cap survival test for the enriched detail (B1); (b) no live-proof step demonstrating the
coherence fix (B2); (c) filter tests should run against a fixture larger than one page (25 rows) so
"filters only filter page one" can never ship — the client-side-filtering premise holds only because
`read-board.ts` walks every page to `hasMore: false`, and its `truncated: true` outcome needs a
defined filter-row behavior (filtering a knowingly-truncated list should say so).

### N8 — Minor spec/plan mismatches

- Spec §9 lists source, posting date, and location in the inspector identity block, but
  `MatchDetail` carries none of them and Task 1 adds only `body`/`scoredAt`. That is fine — the
  inspector already renders identity from the `BoardMatch` row (`inspector.tsx:42-43`, `187-188`) —
  but the row's values are truncated (location 40, company 60, source 24). State that identity
  stays row-sourced so nobody "fixes" it by widening the detail payload past B1's budget.
- Capped Fit is a normalized number the model never produced (model said 88, user sees ≤ 39). The
  disposition itself is not persisted (no-migration constraint), so the _band_ is coherent but the
  numeral's provenance is invisible except via the reason prose. Acceptable under the spec's own
  precision goals; worth one sentence in spec §6.2 acknowledging it.
- Task 7 asserts ceremony absent "in active state"; spec §10.1 covers active _or paused_ profiles —
  keep paused/blocked rendering actionable blockers, and test that state too.
- Much of the verification weight sits in `.tsx` suites, which are not typechecked (#1335) —
  fixture drift is silent. Mitigation: keep the bucket helper and filter predicate in a `.ts`
  module (`board-types.ts`, as planned) with `.ts` tests carrying the logic assertions.

## What the plan gets right

- **The seams are real.** Every named file exists; `fetchHosts` already includes
  `www.linkedin.com` (`jarvis.module.json:26`) so enrichment needs no manifest change;
  `match.get` declares no `outputSchema`, so `body`/`scoredAt` won't be schema-stripped;
  freehire's `htmlToText` exists to export (`freehire.ts:143`); the `FetchLike` bridge exists
  (`worker/ports.ts:12`); `AUTH_WALL_MARKERS` and the structured failure vocabulary exist
  (`adapters/linkedin.ts:58`); `Posting.body`, `Posting.externalId`, and `Match.scoredAt` are
  already stored (`domain/records.ts:67-86`). The "no migration, no new route" claim is true.
- **The bucket-divergence diagnosis is exact.** `board.tsx:165-169` buckets everything
  non-seen/dismissed as New; `overview.tsx` counts literal `state === "new"` — precisely the
  53-vs-47 defect. One shared helper is the right size of fix.
- **Client-side filtering is legitimate** because `read-board.ts` already walks all pages.
- **Extracting the filter component is required, not optional** — `board.tsx` is at 856 lines
  against the 1000-line gate.
- **The chat design completes an existing seam instead of inventing one**: `action_result` kind,
  `result` field, `affectsQueryKeys`, `tool_metadata.activity` round-trip, and the "Behind the
  scenes" grouping (`message-row.tsx:66,102,121`) are all present today; statusText is genuinely
  new and genuinely small.
- **Fit-disposition answers review question 3 correctly**: Fit-only, Want untouched, no combined
  verdict, strict schema (`SCORE_SCHEMA` is `additionalProperties: false` with a strict parser),
  reasons preserved so the inspector explains the cap. The 84/39 caps map correctly onto the
  existing bands (modulo N5).
- **Scope discipline is good throughout**: no Kanban, no rich-HTML renderer, no navigation store,
  tab roles removed rather than half-implemented, deletion preferred on Overview/Profile/Monitors.
  I looked for overbuilding (review question 9) and found little; the plan's most complex task
  (Task 3) is complexity the spec genuinely demands.

## Exact proposed edits

1. **Plan Task 1, Behavior** — add: "Cap the returned and stored description at `BODY_MAX_CHARS`,
   sized against the 16 000-character render cap with every other detail field at maximum; add a
   worst-case render-survival test for `match.get` mirroring the existing list test." (B1)
2. **Spec §6.2, last paragraph** — replace "Existing matches are corrected on their next ordinary
   scoring pass" with either the one-time refit decision or the honest statement that scored rows
   keep stale bands until a refit event; if the former, add a matching plan task reusing the
   `unfitted` candidate path. Extend plan Task 11's live proof accordingly. (B2)
3. **Plan Task 1, Behavior** — add: enrichment fetch has its own timeout inside the invocation
   deadline; on failure, persist a bounded retry-suppression marker; enrichment failures never
   write portal state; document the read-tool-with-cache-write exception at the handler. (N1, N2)
4. **Plan Task 5, Behavior** — add: "Rows without a real scored match (synthetic unscored ids)
   render no Save/Pass controls," with a unit test. (N3)
5. **Plan Task 3, Checks** — change "all three successful gateway execution sites" to "every
   successful execution site (enumerate at implementation; verify denial/error sites attach no
   result)"; mark `gateway-action-result-invalidation.test.ts` as Add; require persisted
   `statusText` be capped and module-authored. (N4)
6. **Plan Task 2, Behavior** — derive the 84/39 caps and `fitBand` boundaries from one exported
   domain constant. (N5)
7. **Branch preparation** — note that `5eaf9560` is local-only (push or fetch locally), and either
   add `ba935305` to the cherry-pick list or drop the doc-commit cherry-picks. (N6)
8. **Plan Task 4, Checks** — filter tests use a >25-row fixture; define and test filter behavior
   when `read-board` reports `truncated: true`. (N7)
9. **Spec §9 / Plan Task 6** — one sentence: inspector identity metadata remains row-sourced
   (truncated caps apply); the detail payload adds only `body` and `scoredAt`. (N8)

## Items explicitly reviewed and accepted as-is

- Lazy (on-open) LinkedIn enrichment rather than per-result crawl-time fetches — correct cost
  shape, and the guest job-detail endpoint stays inside the existing host allowlist and auth-wall
  stop rules (review question 4, subject to N1/N2).
- Reload-survival design for chat outcomes via `tool_metadata` (review question 5) — genuinely
  workable against the current serializer; structured results stay live-only.
- Client-side filters + row actions + scroll/focus restoration preserving the paged reader, the
  25-row page contract, and the existing match-state queue reconciliation (review question 6,
  subject to N3/N7).
- Overview/Profile/Monitors task-led rewrites (review question 7) — deletion-first, keeps résumé,
  briefing, Run now, structured causes, and actionable blockers; "Checks automatically" copy
  matches the schedule-metadata reality (`crawl-sweep` runs `17 */6 * * *`).
- Removing faux `tablist`/`tab` roles in favor of `aria-current` (honest semantics over
  half-implemented roving focus).
- `h1`/`h2` correction; Want as `N/100`; removal of the "doesn't store the full posting text"
  paragraph (verified present at `inspector.tsx:233`).
- No-migration constraint: all needed columns already exist; verified.
- The commit-existence and file-existence claims in Branch preparation (all ten commits resolve).

## Facts vs hypotheses

Everything cited with a `file:line` above was read in this worktree and is fact. Hypotheses, labeled
as such: the exact success-site count in the gateway (N4); whether real LinkedIn descriptions will
exceed the render budget in practice (B1 is sized from the cap arithmetic and typical posting
lengths, not from a live fetch); cherry-pick cleanliness (inferred from disjoint file sets, not
performed).
