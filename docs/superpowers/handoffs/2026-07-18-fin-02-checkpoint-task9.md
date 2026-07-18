# FIN-02 checkpoint — Tasks 8–9 committed, resume at Task 10 (#1147)

Pointer handoff for the successor session on epic #1144. Worktree
`~/Jarv1s/.claude/worktrees/finance-module`, branch `worktree-finance-module` (owned by PR #1151 —
never `gh pr create`, never merge, never remove the worktree, never `pnpm install`).

## State

- Plan: `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md`. One commit per
  task, messages verbatim from the plan — `git log --oneline` is the task ledger.
- FIN-01 (#1146) DONE through `ebe449ff`; summary + gate record commented on PR #1151.
- FIN-02 (#1147): Task 8 = `d451f255` (manifest v2, web skeleton, 3 registry stubs). Task 9 =
  `4b797fb9` (categorization pipeline). Both pushed. 79 finance unit tests green across 9 suites.
- Decisions D1–D7 are locked in
  `docs/superpowers/handoffs/2026-07-18-fin-01-02-grounded-decisions.md` — do NOT re-ground.
- Discipline: TDD, explicit `git add <paths>` (never `-A`; `.claude/context-meter.log` is dirty —
  never add it), prettier before commit, no subagent fan-out (token budget).

## Task 9 shape (for reference, all committed)

- `external-modules/finance/src/domain/taxonomy.ts` — 16 `DEFAULT_CATEGORIES` + `PFC_MAP`.
- `src/domain/categorize.ts` — precedence rule → PFC map → AI; settled records
  (`categoryId !== null || categorizedBy !== null`) untouched; AI batches of 40, per-batch
  try/catch, unknown/archived ids dropped. `AiTxInput` = id/payee/amountCents/date ONLY (privacy
  boundary).
- `src/worker/ai-port.ts` — `buildCategorizeAi`, schema enum of live ids, tierHint "economy",
  degrade to `{}`.
- `sync.ts` — `loadCategorizeCtx` seeds `NS.categories`/"taxonomy" on first read; called AFTER the
  items-empty return and the D5 token guard (a test asserts `kv.ops` length 1 on abort — keep the
  ordering).

## Task 10 — feed handlers (next)

Per plan, grounded this session:

- New `src/worker/handlers/feed.ts`:
  - `transactionsQueryHandler` — input month?/accountId?/categoryId?/search?/pendingOnly?/limit?
    (default 50, max 200); month defaults from `ports.now()`; returns
    `{ transactions, categories, accounts }` (one-call feed).
  - `transactionCategorizeHandler` (assistant tool) — sets categoryId + `categorizedBy:"user"`
    (+notes); `createRule` → upsert `NS.rules` at `contentHash(normalizePayee(name))`.
  - `categorizeApplyHandler` (queue path) — the 4 identifier ids only (D6), no notes/createRule.
  - Shared `applyCategory(ports, {transactionId, accountId, month, categoryId})`; unknown tx →
    `InputError("not_found")`, unknown/archived category → `InputError("invalid_category")`.
- Wire registry keys `transactions.query` / `transaction.categorize` / `categorize.apply` (stubs
  exist from Task 8).
- Test `tests/unit/external-module-finance-handlers-feed.test.ts`: month-default/category/search
  (name+merchant)/pending/limit-cap filters; provenance "user"; createRule then pipeline applies;
  apply rejects unknown ids; notes only on the assistant tool.

## Task 11 — web feed (after 10)

- Files: `src/web/api.ts` (port job-search invokeTool + ToolOutcome; add `runQueue(name, params)`
  POSTing `/api/modules/finance/queues/<name>/run` — VERIFY exact route in
  `apps/api/src/external-module-jobs.ts` before writing), `store.ts`, `format.ts` (cents →
  $1,234.56), `root.tsx`, `screens/feed.tsx`, `states.tsx`.
- UX: month picker, filter chips, search, grouped-by-date rows, recategorize via runQueue +
  optimistic update + ~2s refetch, "Sync now", connection pills, "Finish connecting" 30s re-poll
  (D2). jds-\* primitives only, no new CSS colors, `fnm-` prefix layout-only styles.
- ALSO add `landmark: Landmark` to the iconMap in `apps/web/src/shell/app-shell.tsx` (~line 62).
- Step 1 exit = screens build + `pnpm build:external:finance` + bundle test PASS. No web unit
  tests (job-search precedent).

## Then

Task 12 UAT (D7 docker-cp trust activation), Task 13 gate + PR. Gate lesson: background pnpm runs
get killed on this box — run the 12-stage `verify:foundation` chain PIECEWISE IN FOREGROUND
(each stage <600s); integration suite = 8 round-robin batches via `split -n r/8`, each
`JARVIS_PGDATABASE=jarvis_finNN_gate pnpm exec tsx scripts/test-integration.ts $(cat batch)`.
PR fallback: comment summary on PR #1151 + issue #1147. After FIN-02: FIN-03 → FIN-04 → FIN-05.
