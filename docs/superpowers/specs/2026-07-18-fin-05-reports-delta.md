# FIN-05 spec delta — reports + transfer auto-pairing (#1150)

Delta to `docs/superpowers/specs/2026-07-18-finance-module-design.md` §"Reports (FIN-05,
architecture level)" plus the transfer-pairing heuristic that §"Default taxonomy" promised
and the FIN-03 delta explicitly deferred here ("the pairing heuristic lands with reports …
and then feeds both surfaces"). Everything in the epic spec stands; this document pins the
decisions those sections left at architecture level. No host changes — FIN-05 is module +
tests only.

Grounding (verified 2026-07-18, per the FIN-05 grounding handoff):

- Snapshots exist and are own-only: `SnapshotChunk = { days: Record<date, balanceCents> }`
  in namespace `finance.snapshots`, key `monthKey(accountId, isoDate)`, written once per
  day per account by the sync handler. They are NOT mirrored to `finance.shared` (the
  mirror carries account meta + transaction months only).
- Transfer exclusion today is category-only: `deriveBudgetMonths` skips
  `categoryId === null` and `categoryId === "transfers"`; income is
  `categoryId === "income"` with sign flipped (spending-positive convention throughout).
- Reads from the web ride `invokeTool` (D4 permits read-risk only); all web writes ride
  `runQueue`. FIN-05 adds no writes, so no new queues.

## Manifest delta (v0.3.0 → v0.4.0)

Two new assistant tools, both `risk: "read"` (pure aggregation, no mutation — the host
rejects KV writes from read tools, which is exactly the posture reports want):

- `finance.reports.spending` — params `{ months?: number }` (integer 1..24, default 6):
  window of calendar months ending the current month (worker clock via ctx — no ambient
  dates). Returns, per month: spending by category, spending by payee, and cash flow
  (`incomeCents`, `outflowCents`, `netCents`). Own transactions merged with
  household-shared rows feed-style (see "Household merge" below).
- `finance.reports.net-worth` — params `{ months?: number }` (same clamp/default): daily
  net-worth series from the actor's OWN snapshots plus a latest headline value.

The epic spec names only `reports.spending`; this delta records adding the second tool
rather than folding both into one. They differ on every axis that matters: data source
(snapshots vs transaction chunks), household semantics (own-only vs merged — snapshots are
not mirrored, so a merged net worth is impossible without a mirror schema change), and
shape (daily series vs monthly buckets). One tool with a mode flag would paper over the
household mismatch; two tools keep each contract honest. Household net worth is a named
later candidate alongside the joint budget, not silently implied.

No new namespaces, no new queues, no credential surfaces. Web route `/reports` joins the
module TABS.

## Transfer auto-pairing (`domain/transfers.ts`, pure)

The epic promise: "Transfers between connected accounts are auto-paired by
amount/date/account heuristic and excluded from spending reports and budget activity."

Pairing rules (binding):

- A candidate pair is two transactions with opposite nonzero `amountCents`
  (`a.amountCents === -b.amountCents`), different `accountId`, date distance ≤ 3 days,
  and **at least one side already `categoryId === "transfers"`**. Requiring one
  transfers-categorized side keeps false positives out (two unrelated $40 rows three days
  apart never pair) while still catching the real case worth catching: the other side
  miscategorized (or uncategorized) by Plaid/AI.
- Matching is deterministic greedy: sort by `date` ascending then `id` ascending; each
  unmatched transaction takes its nearest-date eligible candidate (ties broken by id).
  Same input, same pairs, every run — replay-safe and testable.
- Pairing runs over the FULL loaded transaction set, not per month — real pairs straddle
  month boundaries (checking debits Jan 31, savings credits Feb 1).
- Pairing never crosses owners: own rows pair among own rows; a shared owner's mirrored
  rows pair among that owner's rows. A transfer between two different users' accounts is
  two independent transactions, not a pair.
- The **effective transfer set** = paired rows ∪ rows with `categoryId === "transfers"`.
  Both consumers below exclude exactly this set.

Consumers (both, per the FIN-03 deferral):

- **Reports**: spending and cash-flow aggregations run on the post-exclusion set.
- **Budget derivation**: the budget handler's `loadDerivationInput` applies the exclusion
  before building `transactionsByMonth`. `deriveBudgetMonths` keeps its internal
  `transfers`/null skip as defense in depth — the pre-filter only ever removes MORE rows
  (paired rows whose category is not `transfers`).

Deliberate consequence (in scope, called out): a transfer-in miscategorized as `income`
currently inflates TBB; after FIN-05 its pair pulls it out of derivation and TBB drops to
the true value. Budget numbers may shift for affected users. Existing `state:{YYYY-MM}`
caches computed pre-FIN-05 stay stale until the next sync or assignment invalidates them
(6-hourly sync sweep bounds the staleness); accepted, no cache-version machinery for this.

## Spending & cash-flow aggregation (`domain/reports.ts`, pure)

Per month in the window, over the post-exclusion transaction set:

- **By category**: signed sum of `amountCents` grouped by `categoryId`, spending-positive
  (refunds net against their category). Unlike budget activity, rows with
  `categoryId === null` are INCLUDED, bucketed as uncategorized — spending is real even
  when uncategorized, and hiding it would make report totals disagree with the feed.
  `income` rows are excluded from the category/payee breakdowns (they belong to cash
  flow, not spending).
- **By payee**: same sums grouped by `merchant ?? name`.
- **Cash flow**: `incomeCents` = Σ `−amountCents` where `categoryId === "income"` (the
  envelope convention); `outflowCents` = signed sum of everything else in the
  post-exclusion set (uncategorized included); `netCents = incomeCents − outflowCents`.

All functions are pure over `(transactions, window)` — no clock, no I/O; the handler
computes the window from the ctx clock and the `months` param.

## Net worth (`domain/net-worth.ts`, pure)

- Input: the actor's own `SnapshotChunk`s for the window plus their `AccountRecord`s
  (for account type). Own-only by design (snapshots are not mirrored — see manifest
  section).
- Daily series: for each account, carry the last known balance forward across days with
  no snapshot; days before an account's first snapshot contribute nothing for that
  account (no back-fill — inventing history would be a lie on the chart).
- Liabilities: accounts with `type` `credit` or `loan` contribute their balance NEGATED.
  All other types contribute as-is.
- Series value per day = sum of contributing accounts; headline = latest series point.
  The headline comes from snapshots, not live `AccountRecord.balanceCents` — one source
  of truth per surface, and the sync writes both on the same sweep anyway.

## Household merge

`finance.reports.spending` merges shared rows exactly feed-style, reusing the FIN-04
posture: read `finance.shared` via list + get, skip keys under the actor's own prefix,
re-apply the shared-transaction allowlist on read, and drop entries whose owner fails the
same deleted-owner fail-closed check the merged feed uses. Merged rows enter the
aggregation identically to own rows (totals are household totals); no per-owner breakdown
in v1 — that is a presentation decision deferred until someone asks for it, not a data
constraint. Read tools cannot write, so the merge does no cache warming and no GC — pure,
same as FIN-04's merged reads.

## Web `/reports` (`src/web/screens/reports.tsx`)

- `root.tsx` TABS gains `{ to: "/reports", label: "Reports" }`.
- Reads via `invokeTool` only (both tools are read-risk, D4-compatible). No writes on
  this screen, ever.
- **No chart library.** jds/local primitives only: CSS-width bars for category and payee
  shares, a month-window selector like the feed's, and an inline SVG polyline with
  `stroke="currentColor"` for the net-worth trend. Raw colors stay in
  `apps/web/src/styles/tokens.css` (module surfaces inherit tokens; no new raw colors
  anywhere). Empty/loading states use the existing authored patterns.

## Integration-guard acknowledgements

`tests/integration/external-module-finance.test.ts` pins the FULL tool registration list
and the full queue create/update call list with `toEqual`. FIN-05 adds two tools and zero
queues — the tool-list assertion must be extended in the same commit that bumps the
manifest, eyes open (FIN-04 batch-3 proved this guard works; treat any other `toEqual`
failure there as a real surface change to acknowledge or fix, never loosen the matcher).

## UAT seed delta (`tests/uat/seed/chunks/finance.ts`)

- Add `SnapshotChunk` rows for both seeded accounts (several days spanning the current
  month, including a gap to exercise carry-forward), values consistent with the seeded
  `balanceCents` so the headline is predictable.
- Add one cross-account transfer pair: checking → savings, checking side
  `categoryId: "transfers"`, savings side `categoryId: null`, dates ≤ 3 days apart.
  Chosen so the EXISTING budget UAT numbers do not move (envelope already skips both
  `transfers` and null rows) while the reports UAT can prove pairing: without pairing the
  savings side would pollute the uncategorized spending bucket; with pairing the bucket
  holds exactly the two already-seeded uncategorized rows (coffee 675 + interest −1,250 =
  −$5.75 net), not the transfer leg.
- Zero credentials, as always — `finance.plaid-tokens` is never seeded.

## Secret hygiene (restated, binding)

FIN-05 adds read-only surfaces. No tokens or credentials are read, written, logged, or
serialized; report responses carry aggregated cents, category/payee labels, dates, and
owner ids already visible on the merged feed — nothing from `finance.plaid-tokens`,
link sessions, item errors, rules, or budget ledgers. The `months` param is metadata-only.

## Testing

- **Unit (TDD)**: pairing — happy pair, cross-month pair, ≤3-day boundary, opposite-sign
  requirement, different-account requirement, one-side-transfers requirement, greedy
  determinism under ties, per-owner isolation, effective-set union; spending/cash-flow —
  category sums with refund netting, uncategorized bucket, payee grouping via
  `merchant ?? name`, income excluded from spending but driving cash flow, window
  clamping; net worth — carry-forward across gaps, no back-fill before first snapshot,
  liability negation, multi-account sum, headline = latest point.
- **Worker fixture tests**: both handlers over a scripted RPC host — window computation
  from ctx clock, months clamp (1..24, default 6), household merge (own-prefix skip,
  allowlist re-application, deleted-owner drop), budget handler pre-filter wiring.
- **Integration**: tool registration `toEqual` extended (+2 tools, queues unchanged);
  manifest hash fixtures updated for v0.4.0.
- **e2e UAT (exit criterion, issue #1150)**: new `tests/uat/specs/finance-reports.uat.spec.ts`
  on a real activated module, same D7 docker-cp activation template — seeded snapshots
  produce a derived net-worth headline (not a fixture echo); the transfer pair is absent
  from spending; the category breakdown shows numbers derived from the seeded
  transactions; existing budget UAT still green (proves budget numbers didn't move).
