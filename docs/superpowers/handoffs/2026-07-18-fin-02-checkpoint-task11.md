# FIN-02 checkpoint — Task 11 done, resume at Task 12 (UAT)

Pointer handoff for the successor session on epic #1144 (FIN-02 #1147).
Worktree: `~/Jarv1s/.claude/worktrees/finance-module`, branch `worktree-finance-module`.
Plan: `docs/superpowers/plans/2026-07-18-fin-01-02-finance-connect-sync-feed.md` (executing-plans, inline, TDD, one commit per task, verbatim commit messages, explicit `git add <paths>`).

## State

- Commits (all pushed): FIN-01 done at `ebe449ff`; FIN-02 `d451f255` (T8 manifest v2 + web skeleton) → `4b797fb9` (T9 categorize pipeline) → `cc5060c0` (T10 feed handlers) → `2ec3d3cb` (T11 web feed surface).
- T11 delivered: `external-modules/finance/src/web/{api,store,format,states,styles}.{ts,tsx}` + `screens/feed.tsx` + rewritten `root.tsx`, plus `landmark: Landmark` in `apps/web/src/shell/app-shell.tsx` iconMap. Module build clean, module tsc clean, apps/web tsc clean, 86 finance unit tests green (10 suites).
- Do NOT: `pnpm install`, remove the worktree, merge PR #1151, or `git add` `.claude/context-meter.log` (always dirty).

## Grounded web-contract facts (trust, do not re-derive)

- Queue run route: `POST /api/modules/finance/queues/:queueName/run`, body EXACTLY `{jobKind, params?}`; 202 `{jobId}` (null ⇒ already queued); rate limit 6/min; singleton `manual:finance:{queueName}:{userId}` 5s.
- Params are ONLY legal when the queue declares a paramsSchema ⇒ `finance.sync-run` / `finance.connect-poll` runs MUST omit `params` (jobKinds `finance.sync-run-now` / `finance.connect-poll-now`); `finance.categorize-apply` params = `{transactionId, accountId, month, categoryId}` — all identifier-typed, month `"YYYY-MM"` fits the regex.
- Web invokes ONLY read tools (D4): `finance.transactions.query` (one-call feed: transactions + categories + accounts ride-along), `finance.accounts.list`. All writes via queue runs.
- Pending-link visibility gap: no read tool exposes link sessions ⇒ "Finish connecting" button is a caller-driven bounded loop (30s × 10 rounds), stop signal = refetched accounts fingerprint (ids+statuses) changes vs baseline (D2).
- Mono is retired app-wide ⇒ amounts use `font-variant-numeric: tabular-nums` (`.fnm-amount`), not mono, despite the plan's wording.

## Resume: Task 12 — UAT e2e on a REAL activated module (D7)

Plan section "Task 12" has the full recipe; key points:

- Activation is `docker cp` of the built module dist + trust-set into the UAT container (D7) — the module is NOT baked into the image.
- Follow the #1000-harness Playwright pattern; see memory `uat-spec-gotchas` (onboarding Skip, `getByLabel {exact:true}`, read `error-context.md` on failure) and `uat-seed-shared-db-no-reset`.
- Watch disk: UAT images ~3.14GB each, reap `jarv1s:uat-*` (memory `dev-box-disk-full-uat-images`).

Then Task 13: FIN-02 gate PIECEWISE IN FOREGROUND (background pnpm runs get killed on this box; integration = 8 round-robin batches via `split -n r/8`, per-batch `JARVIS_PGDATABASE=jarvis_finNN_gate`), then PR #1147 — `gh pr create` will refuse (PR #1151 owns the branch); fallback = summary comment on PR #1151.

Then FIN-03/04/05 per the epic.
