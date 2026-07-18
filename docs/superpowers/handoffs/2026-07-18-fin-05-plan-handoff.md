# FIN-05 (#1150) plan handoff — successor starts at the plan doc

Spec delta is COMMITTED and binding: `docs/superpowers/specs/2026-07-18-fin-05-reports-delta.md`
(commits `63b1d70e` + amendment `656297f1`). Trust it verbatim — it pins tools, pairing rules,
aggregation semantics, net-worth rules, household merge, web constraints, UAT seed delta, and
testing scope. Standing loop + hard rules: memory `finance-module-epic-resume.md`. Prior grounding:
`docs/superpowers/handoffs/2026-07-18-fin-05-grounding-handoff.md`.

**Your first action: write `docs/superpowers/plans/2026-07-18-fin-05-reports.md` per the
`superpowers:writing-plans` skill (bite-sized TDD tasks, verbatim code), prettier it, commit
docs-only, then build task-by-task via `superpowers:executing-plans` inline.**

## Spec correction (apply while planning — do NOT re-derive)

The spec's "Integration-guard acknowledgements" section says the integration test pins the full
tool list with `toEqual`. Verified wrong: `tests/integration/external-module-finance.test.ts`
uses `toContain` for 4 FIN-01 tool names only → **integration file needs NO FIN-05 changes**
(queue-calls `toEqual` covers 5 queues, unchanged; lossy-layers accounts.list `toEqual` unchanged).
The full-list `toEqual` guards live in `tests/unit/external-module-finance-manifest.test.ts`:
line ~42 `[name, handler]` pairs, line ~59 `[name, risk]` — extend BOTH (+2 tools) in the
manifest-bump commit. Also check that file's params-schema key assertions pattern (lines 196-240)
and add `months` schema assertions for both new tools.

## Grounded API facts (verified this session — save the re-reads)

- `worker/registry.ts`: `export type ToolFactory = (ports: WorkerPorts) => ToolHandler;`
  `HANDLERS` map keys are short names ("accounts.list", "budget.status", ...) → add
  "reports.spending" + "reports.net-worth" pointing at `worker/handlers/reports.ts`.
- `worker/ports.ts`: `WorkerPorts { kv; mirror; plaid; ai; tokens; creds; settings; isAdmin; now(): Date }`
  — window months come from `ports.now()`, never ambient Date.
- `worker/handlers/accounts.ts`: `AccountRecord` load pattern; account views carry `type`
  (needed for credit/loan negation). Shared mirror meta has NO itemStatus/institutionId.
- `worker/handlers/budget.ts`: `loadDerivationInput(kv)` = chunk-load template (all NS.transactions
  keys grouped by `key.slice(-7)` month suffix, `MONTH = /^[0-9]{4}-[0-9]{2}$/`). FIN-05 wires the
  pairing pre-filter here (spec §consumers).
- `worker/handlers/feed.ts`: household merge template (`ports.mirror.list()` → `parseSharedKey` →
  skip own prefix → `toSharedTransaction` allowlist → tag `{ownerUserId, shared: true}`);
  `loadCategories(ports)` exported; `actorUserId` read from tool input (host injects, spread last).
- `worker/handlers/sync.ts:114-129`: `appendSnapshots` — chunk at `monthKey(accountId, today)`,
  first write of day wins.
- Domain: `keys.ts` `monthKey/prevMonthKey`; `kv-port.ts` `NS` map + `SHARED_NS` + both port types;
  `shared-pool.ts` `parseSharedKey/toSharedTransaction/sharedOwnerPrefix`; `envelope.ts:78` null/
  transfers skip stays as defense. New files `domain/transfers.ts`, `domain/reports.ts`,
  `domain/net-worth.ts` must be re-exported from `domain/index.ts`.
- Web: `api.ts` `invokeTool<T>(name, input?) → ToolOutcome<T>` + `fetchUserDirectory()`;
  `store.ts` `useToolQuery<T extends Record<string, unknown>>(name, input)` + `invalidateQueries()`;
  `screens/budget.tsx` = screen template (`outcomeGate`, `EmptyState`, `announce`, month selector
  via `shiftMonth`/`monthLabel`); `format.ts` `formatCents/monthLabel/shiftMonth/currentMonth`;
  `root.tsx` TABS array + bottom route switch (add `/reports`); `household.ts`
  `resolveSharedOwners` fail-closed. Check `styles.ts` file-size headroom before adding fnm-*
  classes (1000-line cap).
- UAT seed `tests/uat/seed/chunks/finance.ts`: ids `uat-acc-checking`/`uat-acc-savings`, balances
  254_317/1_200_000; txns grocer 8_432 groceries / coffee 675 null / rent 185_000 rent-mortgage /
  interest −1_250 null; prior-month LEDGER ONLY (prior-month txns must stay unseeded — feed spec
  asserts empty state). Seed writes via `runner.withDataContext` + `setModuleKvValue`, shapes
  deliberately inlined. Spec pins the transfer-pair + SnapshotChunk delta.
- UAT spec template: `tests/uat/specs/finance-budget.uat.spec.ts` (D7 docker-cp activation,
  Playwright 1.60 `async ({}, testInfo)` + `// eslint-disable-next-line no-empty-pattern`).
  Feed UAT is presence-based → added seed rows safe.

## Suggested task shape (refine in plan, don't re-debate)

1. `domain/transfers.ts` pairing (pure, TDD: new `external-module-finance-transfers.test.ts`)
2. `domain/reports.ts` spending/cash-flow (TDD)
3. `domain/net-worth.ts` (TDD)
4. Manifest v0.4.0 + registry entries + `worker/handlers/reports.ts` (two handlers; spending does
   household merge; net-worth own-only) + manifest/handler unit tests (incl. `toEqual` extensions)
5. Budget `loadDerivationInput` pre-filter wiring (TDD on handlers-budget test)
6. Web `screens/reports.tsx` + TABS + format helpers as needed (CSS bars, SVG polyline
   `stroke="currentColor"`, no chart lib, no raw colors)
7. UAT seed delta + `tests/uat/specs/finance-reports.uat.spec.ts`
8. 12-stage gate on `jarvis_fin05_gate` (recipe in memory) + UAT run (verify `uat-smoke` bundle
   first: `grep -c 'schedule2.id}:' /app/dist/worker.js` must be 0)

## Close-out (unchanged)

Push → PR #1151 comment (per-slice summary + gate record) → issue #1150 note → update memory
`finance-module-epic-resume.md`. Never stage `.claude/context-meter.log`; explicit `git add`
paths only; one commit per task, plan-verbatim messages; prettier before every docs commit;
keep inline code spans single-line (prettier oscillation trap).
