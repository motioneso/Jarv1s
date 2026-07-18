# FIN-05 (#1150) grounding handoff — successor starts at the spec delta

Predecessor closed FIN-04 (#1149) completely: pushed through `02bbd74e`, gate 12/12 exit 0,
PR #1151 comment `5012995418`, issue #1149 comment `5012995681`, memory updated. Nothing
in-flight. **Your first action: write
`docs/superpowers/specs/2026-07-18-fin-05-reports-delta.md` (format template =
`2026-07-18-fin-04-household-shared-pool-delta.md`) and commit it BEFORE any code.**
Standing loop + hard rules live in memory `finance-module-epic-resume.md` — trust it.

## Grounded facts (verified this session — do not re-derive)

- **Snapshots**: `SnapshotChunk = { days: Record<"YYYY-MM-DD", balanceCents> }` in NS
  `finance.snapshots`, key `monthKey(accountId, isoDate)` (`"acc1:2026-07"`), written once
  per day per account by `external-modules/finance/src/worker/handlers/sync.ts:114-129`.
  Snapshots are NOT mirrored to `finance.shared` (mirror carries account meta +
  transaction months only, `domain/shared-pool.ts`) → net worth is own-accounts-only.
- **Transfer exclusion today**: `domain/envelope.ts:78` skips
  `categoryId === null || categoryId === "transfers"`; income = `categoryId === "income"`
  (line 80). Pairing heuristic explicitly deferred to FIN-05 by FIN-03 delta (line ~93):
  "the pairing heuristic lands with reports … and then feeds both surfaces."
- **Aggregation templates**: budget `loadDerivationInput` (all `ledger:` keys + all
  transaction chunks grouped by key month suffix, `worker/handlers/budget.ts`) is the load
  pattern; feed's mirror merge (`worker/handlers/feed.ts` — skip own `sharedOwnerPrefix`,
  re-apply `toSharedTransaction` allowlist, tag `{ownerUserId, shared:true}`) is the
  household-read pattern.
- **Web**: `src/web/root.tsx` TABS gets `{to:"/reports", label:"Reports"}`; reads via
  `invokeTool` (read-risk only, D4), writes via `runQueue` (`src/web/api.ts`, verified).
- **Manifest** at v0.3.0 → bump to 0.4.0. Integration test
  `tests/integration/external-module-finance.test.ts` pins the FULL queue create/update
  call list with `toEqual` AND the full `accounts.list` field set — acknowledge any
  surface change there (FIN-04's batch-3 "failure" was this guard working).
- **UAT seed** (`tests/uat/seed/chunks/finance.ts`): 2 accounts (checking 254_317 /
  savings 1_200_000 cents), 4 current-month txns (groceries 8_432, coffee 675 uncategorized,
  rent 185_000, interest −1_250), prior-month ledger only. NO snapshots seeded → FIN-05
  seed delta must add `SnapshotChunk` rows (and a cross-account transfer pair for the
  pairing proof). Zero credentials, ever — `finance.plaid-tokens` never seeded.
- **UAT spec template**: `tests/uat/specs/finance-budget.uat.spec.ts` (D7 docker-cp
  activation, two restarts, afterEach log+pgboss diagnostics, Playwright 1.60
  `async ({}, testInfo)` + `// eslint-disable-next-line no-empty-pattern`).

## Proposed spec decisions (predecessor's design intent — refine, then pin in the delta)

- **Tools (read risk)**: `finance.reports.spending` — spending by category + payee and
  cash flow (income vs outflow vs net) per month over `{months: 1..24, default 6}` ending
  current month, own + household-shared rows merged feed-style; and
  `finance.reports.net-worth` — daily net-worth series from own snapshots, carry-forward
  for missing days, liabilities (account type `credit`/`loan`) negated. Epic names only
  `reports.spending`; the delta must record adding the second tool (or justify folding
  both into one).
- **Pairing** (pure fn, `domain/transfers.ts`): run over the FULL loaded transaction set
  (pairs straddle month boundaries); a pair = opposite `amountCents`, different
  `accountId`, date distance ≤ 3 days, **at least one side `categoryId === "transfers"`**
  (limits false positives; catches the one-side-miscategorized case). Deterministic greedy
  match (sort by date then id, nearest-date first). Effective transfer set = paired rows ∪
  rows with `categoryId === "transfers"`; both reports AND budget derivation consume it as
  a pre-filter before `deriveBudgetMonths` (also fixes a transfer-in miscategorized as
  income inflating TBB — call that out in the delta; budget numbers may shift, in-scope).
- **Web /reports**: no chart library. jds/local primitives only: CSS-width bars for
  category/payee shares, month selector like the feed's, inline SVG polyline with
  `stroke="currentColor"` for the net-worth trend; raw colors stay in `tokens.css`.
- **Testing section**: TDD unit (pairing, spending/cash-flow/net-worth aggregations,
  handler merges), integration (tool registration + lossy-layers), e2e UAT exit criterion
  (new `finance-reports.uat.spec.ts` on real activated module: seeded snapshots →
  net-worth headline; transfer pair excluded from spending; category breakdown numbers
  derived, not fixtures).

## Then

Plan doc `docs/superpowers/plans/2026-07-18-fin-05-reports.md` (prettier before commit;
keep inline code spans single-line) → build task-by-task, one commit per task → 12-stage
gate on `jarvis_fin05_gate` → push → PR #1151 comment + issue #1150 note → update
`finance-module-epic-resume.md`. FIN-05 touches host packages? None expected (module +
tests only) — but verify the `uat-smoke` bundle before any `JARVIS_UAT_BUILD=0` run per
the memory trap.
