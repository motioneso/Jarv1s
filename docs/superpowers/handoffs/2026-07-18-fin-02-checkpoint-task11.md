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

Plan section "Task 12" has the full recipe. **Grounding is COMPLETE** (2nd checkpoint) — trust
these facts, do not re-derive; go straight to writing files:

**Harness facts (all read in full this window):**

- Spec file: `tests/uat/specs/finance-feed.uat.spec.ts` (harness naming; plan's `.test.ts` name is
  outdated). Must `export const uatLevel = { level: "admin+data", without: [] } as const` — parsed
  by REGEX in `tests/uat/run-uat.ts`; `without` entries validated against its CHUNKS set.
- Playwright (`tests/uat/playwright.uat.config.ts`): timeout 60s/test, expect 10s, retries 0,
  trace retain-on-failure. The activation test needs `test.setTimeout(300_000)` (cp + restart +
  enable + possible 2nd restart won't fit 60s).
- Template = `tests/uat/specs/job-search-install.uat.spec.ts` (read in full previously): login via
  `getByLabel("Email")`/`("Password")` + `form.auth-form` Sign in; `.jds-usermenu__trigger` proves
  login; nav Settings & permissions → Admin/Setup → Instance modules; `restartUatStack(projectName,
baseURL)` imported from `../provisioner.js`; env `JARVIS_UAT_PROJECT_NAME`/`JARVIS_UAT_BASE_URL`;
  real-nav only.
- Seed runs INSIDE compose network (postgres publishes NO host port) via ops-profile `seed` service
  (`tests/uat/seed/cli.ts`, guarded by `JARVIS_UAT_SEED_CONFIRM=1` + ephemeral-target check).
  **To seed finance KV: add a `finance` chunk** — extend `UatSeedChunk` + `UAT_SEED_CHUNKS` in
  `tests/uat/seed/types.ts`, CHUNKS in `run-uat.ts`, wire into the admin+data list in
  `seed/levels.ts` (default-on is fine: the chunk writes ONLY module-KV rows via
  `setModuleKvValue` from `@jarv1s/settings` — invisible to other specs since the module row
  doesn't exist. Do NOT call `setExternalModuleEnabled` — the job-search fake-hash path violates
  D7).
- Seed content (shapes in `external-modules/finance/src/domain/{records,keys,kv-port}.ts`): item
  at `itemKey(itemId)` in `finance.connections` (status "connected"); 2 AccountRecords keyed by
  accountId in `finance.accounts`; one TransactionChunk at `` `${accountId}:${month}` `` in
  `finance.transactions` (sorted date desc, id asc; include one uncategorized txn). Month must be
  CURRENT month at seed time (`new Date().toISOString().slice(0, 7)`) — feed opens on browser
  current month. Skip taxonomy key (feed falls back to DEFAULT_CATEGORIES). Prev month left empty
  → serves the empty-state + month-narrowing assertions.

**Activation facts (D7):**

- In-container modules dir = **`/data/modules`** (`JARVIS_MODULES_DIR` in
  `infra/docker-compose.prod.yml`; NOT /app/data/modules). Volume `<project>_jarv1s-modules`.
- Host package is cp-ready at `external-modules/finance/` (`jarvis.module.json` + `dist/` +
  `package.json` all present). Hash trust-set (`packages/module-registry/src/external/hash.ts`) =
  `jarvis.module.json` + `dist/worker.js` + `dist/web/**` + `sql/**`; other files ignored.
- Copy via `docker compose -p $JARVIS_UAT_PROJECT_NAME -f infra/docker-compose.prod.yml cp
external-modules/finance jarv1s:/data/modules/finance` — VERIFY docker-cp dir semantics (SRC dir
  into existing DEST may nest; may need cp to `/data/modules/` or an exec mv).
- **Reconcile is FAIL-CLOSED** (`packages/module-registry/src/external/reconcile.ts:36`): disk
  files + restart → virtual status "discovered", INACTIVE. The spec MUST then enable via the real
  admin UI (Instance modules card) — that's where real hashes are recorded (trust anchor at
  admin-enable). Mirror job-search-install's enable flow incl. its post-enable restart.
- `restartUatStack` = `docker compose restart jarv1s` + `/health/ready` poll (NOT `up -d` — no-op
  trap).

**Spec assertions (plan):** feed renders seeded txns + balances header; month nav to prev month →
authored empty state, back → rows (narrowing); search narrows; recategorize: pick category on the
uncategorized txn → categorize-apply job runs → `page.reload()` (clears optimistic state) → chip
persists (proves the worker wrote KV).

**Commit (verbatim):** `test(finance): e2e UAT for the transaction feed on a real activated module (#1147)` / body `Verifies the Finance feed end-to-end in a production-shaped stack. Not user-visible.`

**Gotchas:** memory `uat-spec-gotchas` (onboarding Skip — admin+data lands on AppShell though;
`getByLabel {exact:true}`; read `error-context.md` on failure); reap `jarv1s:uat-*` images
(~3.14GB each, memory `dev-box-disk-full-uat-images`); `pnpm test:uat finance-feed` to run.
Remaining small unknowns: exact module nav label/route in shell, module build script name
(check root package.json), whether enable needs the 2nd restart (job-search spec shows it).

Then Task 13: FIN-02 gate PIECEWISE IN FOREGROUND (background pnpm runs get killed on this box; integration = 8 round-robin batches via `split -n r/8`, per-batch `JARVIS_PGDATABASE=jarvis_finNN_gate`), then PR #1147 — `gh pr create` will refuse (PR #1151 owns the branch); fallback = summary comment on PR #1151.

Then FIN-03/04/05 per the epic.
