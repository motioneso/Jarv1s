# FIN-03 implementation plan — envelope budget engine (#1148)

Executes `docs/superpowers/specs/2026-07-18-fin-03-envelope-budget-delta.md` (committed
11c5ec5f) on branch `worktree-finance-module`. Same execution rules as the FIN-01/02 plan:
TDD, one commit per task with the verbatim message below, explicit `git add <paths>` never
`-A`, prettier before every commit, no subagent fan-out. Single-branch caveat: PR #1151
owns the branch — Task 6 comments the summary there instead of opening a PR.

Standing traps (verified this epic, do not re-learn):

- Queue handlers receive the host job envelope `{actorUserId, jobKind, idempotencyKey,
params}` — ids live in `input.params` (a6023cb7).
- `tests/integration/external-module-finance.test.ts` asserts the FULL queue
  create/update call list with `toEqual` — every manifest queue change must update it
  (78a275aa).
- pg-boss schedule keys are `[\w.\-/]` only (1c2477cb) — no new schedules in FIN-03, but
  never introduce `:` into key material handed to pg-boss.
- UAT: host-code (`packages/*`, `apps/*`) changes require a full image rebuild — no
  `JARVIS_UAT_BUILD=0`. Module-only changes can reuse the image. Detached run:
  `setsid nohup pnpm test:uat <spec> > <scratchpad>/log 2>&1 &` + self-excluding pgrep
  wait. Gate: piecewise foreground, isolated DB, integration in 8 `split -n r/8` batches.

### Task 1: envelope math domain (TDD)

- [ ] **Red:** `tests/unit/external-module-finance-envelope.test.ts` — cases from the
      delta: single-month available; positive carry rolls; cash overspend resets the
      category and debits the NEXT month's TBB; TBB across 3 months; transfers excluded;
      pending included; income sign (−amountCents); assign is set-not-increment;
      determinism (same inputs → same output, no clock).
- [ ] **Green:** `external-modules/finance/src/domain/envelope.ts` — pure
      `deriveBudgetMonths(input: { ledgers: Record<string, Ledger>; chunks:
  TransactionChunk[][ per month ]; months: string[] }) → Record<string,
  BudgetMonthStateCore>` (no `computedAt` in the pure layer — the handler stamps it
      from ctx clock). Export `BudgetLedger`, `BudgetMonthState` types from
      `domain/records.ts` or `envelope.ts` per file-size fit. Month iteration = sorted
      union of ledger + chunk months (delta §envelope math).
- [ ] Verify: module unit suite green; prettier.
- [ ] Commit (verbatim):
      `feat(finance): envelope math domain — carry, overspend, TBB (#1148)`
      body: `Pure YNAB-semantics budget derivation for the Finance module. Not yet user-visible.`

### Task 2: manifest v0.2.0 + reconcile expectations

- [ ] Manifest per delta: version `0.2.0`, `finance.budgets` namespace, 4th queue
      `finance.budget-apply` (retryLimit 1, paramsSchema month/categoryId identifier +
      amountCents integer ±100000000), tools `finance.budget.status` (read, required
      `month`) and `finance.budget.assign` (write).
- [ ] Update `tests/integration/external-module-finance.test.ts` queue call list (+2
      entries: create + `{"retryLimit":1}` update for budget-apply).
- [ ] Verify: `pnpm build:external:finance`; manifest unit test (if it asserts queue
      count, update); single-file integration run
      `pnpm exec tsx scripts/test-integration.ts tests/integration/external-module-finance.test.ts`.
- [ ] Commit (verbatim):
      `feat(finance): manifest v0.2.0 — budgets namespace, budget-apply queue, budget tools (#1148)`
      body: `Declares the budget storage/queue/tool contract. Not yet user-visible.`

### Task 3: budget worker handlers (TDD)

- [ ] **Red:** `tests/unit/external-module-finance-handlers-budget.test.ts` (scripted RPC
      host pattern from the existing handler tests): `budget.status` derives from seeded
      ledger+chunks, writes `state:{month}` cache, serves cache on second call;
      `budget.assign` tool path validates (month format, category exists, bounds) and
      RMWs `ledger:{month}`; queue path reads the HOST ENVELOPE (`input.params`);
      both invalidate `state:` ≥ month; sync handler invalidates `state:` for a written
      month.
- [ ] **Green:** `external-modules/finance/src/worker/handlers/budget.ts` (shared
      `applyAssignment`), registry wiring for the two tools + `finance.budget-apply`
      jobKind, `handlers/sync.ts` cache-invalidation hook.
- [ ] Verify: finance unit suites green; module tsc; prettier.
- [ ] Commit (verbatim):
      `feat(finance): budget status/assign handlers over the envelope domain (#1148)`
      body: `Budget reads with cached derivation; assignments apply via tool and queue paths. Not yet user-visible.`

### Task 4: web budget surface

- [ ] Port the job-search router idiom (`useModulePath`/`ModuleLink`) into
      `external-modules/finance/src/web/router.ts`; root gains Feed (`/`) / Budget
      (`/budget`) tabs.
- [ ] `screens/budget.tsx` per delta: month nav, TBB headline, taxonomy-group rows
      (category / assigned inline-edit / activity / available), assign →
      `runQueue("finance.budget-apply", "finance.budget-apply", { month, categoryId,
  amountCents })` with optimistic override; reads via `finance.budget.status`.
      `tabular-nums` amounts; existing authored empty/danger states only.
- [ ] Verify: `pnpm build:external:finance`; apps/web tsc unaffected; targeted unit tests
      for any new pure web helpers (amount parsing → cents); prettier.
- [ ] Commit (verbatim):
      `feat(finance): budget screen — assign, activity, available, TBB (#1148)`
      body: `New Budget tab on the Finance page: assign every dollar a job and track category balances month to month.`

### Task 5: UAT e2e on the real activated module

- [ ] Seed delta (`tests/uat/seed/chunks/finance.ts`): add a PRIOR-month ledger row
      (proves rollover) — data rows only, no credentials, `finance.plaid-tokens` never
      seeded.
- [ ] `tests/uat/specs/finance-budget.uat.spec.ts` from the finance-feed spec template
      (docker-cp → restart → admin-enable → restart; keep the afterEach diagnostics
      dump verbatim — filtered logs + pgboss.job): Budget tab via real nav; assert
      seeded-derived TBB/available; assign to a category; reload-poll until the derived
      state reflects the worker write.
- [ ] Run detached. Module-only changes since the last green image → `JARVIS_UAT_BUILD=0`
      is acceptable ONLY if no `packages/*`/`apps/*` file changed in FIN-03 Tasks 1–4;
      otherwise rebuild. Iterate on red using the afterEach diagnostics.
- [ ] Commit (verbatim):
      `test(finance): e2e UAT for the envelope budget on a real activated module (#1148)`
      body: `Verifies budget assignment and derived balances end-to-end in a production-shaped stack. Not user-visible.`

### Task 6: FIN-03 gate + summary

- [ ] Full gate, isolated DB `jarvis_fin03_gate`, piecewise foreground (12 stages, 8
      integration batches), every stage exit 0. Drop DB + tmp scripts after.
- [ ] `git push`; comment the FIN-03 summary (what's-new line from the issue, commit
      chain, gate record, UAT result) on PR #1151; note completion on issue #1148.
- [ ] Update epic-resume memory; next slice FIN-04 (#1149).
