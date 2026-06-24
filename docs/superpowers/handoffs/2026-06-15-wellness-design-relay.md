# Coordinator relay — Wellness design + taxonomy + insights/therapy-notes

**You are the new coordinator** for the Phase-5 Wellness design build (epic #50). The prior
coordinator (Ben's session) relayed to you with full context budget. Read this IN FULL, then invoke
`coordinate`, re-adopt the fleet (`herdr pane list`), confirm you're driving, and reap the old
coordinator pane (`w653f42bef3ac02-4`).

Build engine: **Sonnet agents** (Ben confirmed — specs/plans are solid). You orchestrate; agents build.
Ben is delegating and away/intermittent — proceed autonomously, but do NOT push/PR/merge-to-main
without his OK (he reviews the look/design later — "functionality vs design passes").

## Where the work lives

- **Primary worktree/branch:** `~/Jarv1s/.claude/worktrees/feat+wellness-design` →
  branch `worktree-feat+wellness-design`, HEAD `476f943`. `node_modules` present (skip `pnpm install`).
- **Second worktree (already merged in):** `~/Jarv1s/.claude/worktrees/wellness-web`
  (branch `wellness-web-phase3`). Its Phase-3 commit is merged into the primary branch — **remove it**
  when convenient: `git worktree remove ~/Jarv1s/.claude/worktrees/wellness-web`.
- **Dev DB:** `jarv1s` on `localhost:55433` (superuser `postgres:postgres`). Migrations `0088`/`0089`
  are ALREADY APPLIED to this dev DB — do NOT edit those files (hash-check invariant).

## Reference docs (in the primary worktree)

- Spec: `docs/superpowers/specs/2026-06-14-p5-wellness-design-taxonomy-insights.md`
- Build plan: `docs/superpowers/plans/2026-06-14-wellness-design-taxonomy-build.md`
- **Codex-APPROVED plan:** `PLAN.md` (worktree root) — survived 3 plan-review rounds.
- Codex plan-review transcript: `PLAN-REVIEW-LOG.md`
- Design bundle (read-only reference): `~/.claude/jobs/914af5c0/tmp/design/jarvis-design-system/project/ui_kits/jarvis-app/` (`Wellness.jsx`, `WellnessCheckin.jsx`, `WellnessCharts.jsx`, `wellness.css`, `wellness-data.js`)

## What's done (commits on the branch)

1. `19aa46c` Phase 1 — shared contract (new emotion taxonomy + polarity + moodIndex + DTOs), `packages/db/types.ts`, migrations `0088` (enum swap, fail-loud + re-run-safe) + `0089` (therapy_notes table + SECURITY INVOKER owner trigger + RLS), manifest (routes/ownedTables/`wellness.delete`).
2. `291412c` Phase 2 — `insights.ts`, therapy-notes CRUD, `listLogsRange`, routes, serialize, `tools.ts` moodIndex; integration tests (`wellness.test.ts`, new `wellness-phase2.test.ts`, `wellness-medications.test.ts`, `foundation.test.ts` migration count).
3. `d186cbe` Phase 3 — full web port `apps/web/src/wellness/*` (decomposed <1000 lines), `client.ts`/`query-keys.ts`, CSS split `wellness-1.css`/`wellness-2.css`, e2e `wellness.spec.ts`. Removed dead placeholders. Radial picker deferred (stretch).
4. `476f943` merge of Phase 3 + a pre-existing stale settings unit-test fix (`tests/unit/web-route-metadata.test.ts` — `/settings` subtitle `""`, from the `da992f1` settings pass; NOT a wellness change).

**Gate status:** `pnpm verify:foundation` is **GREEN** (real exit 0 — lint, format:check, check:file-size,
typecheck, test:unit 335 passed, db:migrate idempotent, test:integration 721 passed / 2 skipped).
⚠️ Verification trap already hit once: a wrapper `; echo; tail` masked a real exit 1 — always read the
REAL exit code, never a wrapped one.

## REMAINING WORK (your job)

### 1. Remediate the Codex thermonuclear CODE review — `VERDICT: DO-NOT-MERGE`, `BLOCKERS: 3`

Full critique captured at `~/.claude/jobs/914af5c0/tmp/codex9-full.txt`. Ben approved doing
ALL findings (the 3 LOWs too) with the decisions below. Dispatch a Sonnet remediation agent in the
primary worktree; then re-verify; then a 2nd Codex pass.

- **H1 — `0088` hard-fails if `wellness_checkins` non-empty.** DECISION: **keep fail-loud, do NOT edit `0088`**
  (no data anywhere per Ben; `0088` already applied to dev → editing breaks the migration-hash invariant;
  a forward remap migration is the tool IF ever deploying to a populated env). Just **document** this in the
  spec's Open Risks. No migration edit.
- **H2 — `insights.ts:163` adherence denominator counts only logged rows** (missed doses vanish → can show 100%).
  FIX with H2+M5 combined below.
- **H3 — `wellness-page.tsx:158` "Edit check-in" always POSTs** → duplicates history. DECISION: **add an
  owner-scoped `PATCH /api/wellness/checkins/:id`** (shared req+route schema, `repository.updateCheckin`
  re-validating the feeling path + `feeling_tertiary` null, route handler w/ 404, manifest route under
  `wellness.update`, client `updateWellnessCheckin`, modal calls it when `initial` present). Invalidate
  checkins+insights after.
- **H2 + M5 combined — `/api/wellness/medications/logs` returns raw `dose`+`prnReason`** (overexposes
  sensitive med data) AND insights/chart use wrong denominator. FIX: replace the raw-logs endpoint with a
  **per-day adherence summary** computed SERVER-SIDE by reusing `computeSchedule(meds, logsForDay, day)`
  across the window → per-day `{ date, scheduledCount (expected non-PRN slots), takenCount, doses:[{medicationId,name,status,prn}] }`
  — **no `dose`/`prnReason`**. Chart strip uses taken/scheduled; tooltip uses `doses[]` (names+status).
  `insights.ts` adherence uses the same expected-slot denominator. New DTO in `wellness-api.ts`; update
  `client.ts`/`query-keys`/`wellness-chart.tsx`/`wellness-trends.tsx`.
- **M4 — `routes.ts:263` therapy-note bad/cross-owner `linkedCheckinId` → 500.** The `0089` trigger raises
  `P0001`; a missing id raises FK `23503`. FIX: in the therapy-note POST route, catch `P0001` AND `23503`
  → return **404 "linked check-in not found"** (treat cross-owner == nonexistent; don't reveal ownership).
  Do NOT edit `0089` (applied).
- **M6 — `manage-meds-modal.tsx:80` "Evening (twice daily)"** sends `times_per_day` + `timesPerDay:null` +
  one time → route 400. FIX: make every modal option build a VALID `CreateMedicationRequest`
  (`once_daily`+1 time, `as_needed`, or `times_per_day` with matching `timesPerDay` + N times), or drop the
  bad option.
- **M7 — `wellness-today.tsx:197` mutations invalidate too narrowly** (trends/logs/insights stay stale).
  FIX: after logDose → invalidate schedule + logs + insights; after check-in create/PATCH → checkins +
  insights (+ logs if relevant); after med create/remove → medications + schedule + logs + insights.
- **L8 — `recall-context.ts:55` selects `feeling_core`** (data-min violation; unused). FIX: select only
  `energy`; narrow `deriveEnergyTrend` param to `Pick<WellnessCheckin,"energy">`.
- **L9 — `wellness-insights.tsx:171` error states collapse into empty-state.** FIX: render explicit error
  states for the insights, therapy-notes, trends, and schedule queries (isError ≠ empty).
- **L10 — `wellness-phase2.test.ts:207` insights owner-scoping test is shallow** (only asserts 200+key).
  FIX: seed OTHER-user check-ins/logs/meds and assert the actor's insights/counts contain only their own data.

After fixes: dispatch agent runs `pnpm verify:foundation` (REAL exit) + the cleanup `rg` gate; commit
green (Sonnet trailer). Then **2nd Codex pass** in pane `w653f42bef3ac02-9` (Codex-WellnessReview, in the
primary worktree) — send a single-line follow-up "I fixed all findings, re-review the diff
da992f1..HEAD, end with BLOCKERS:n / VERDICT". Herdr-pane gotchas (see memory `herdr-codex-pane-review`):
placeholder ≠ typed text; large paste needs a 2nd Enter; detect done via `agent_status` not VERDICT grep.

### 2. Only after Codex is MERGE-READY + gate green

- Update GitHub epic #50 (progress comment — this is a slice, not the whole epic; don't close it).
- Save an agentmemory lesson (taxonomy migration, the 9 review fixes, the adherence-summary pattern).
- Remove the `wellness-web` worktree.
- Do NOT push/PR/merge to main without Ben's explicit OK.

### 3. PAUSED side-task (Ben said "wait on my thing")

Make Ben's **dev** account admin: `admin = app.users.is_instance_admin` (boolean). Dev DB `jarv1s`
(localhost:55433, `postgres:postgres`) currently has ONLY integration-test seed users
(`user-a/b@example.test`, `admin@example.test`) — the test runs reseed `jarv1s`, so there is **no Ben
account** to promote yet. When Ben returns: confirm how his dev account is created, then
`UPDATE app.users SET is_instance_admin=true WHERE email=<his>`. ALSO log a GitHub issue: "owner/primary
account shouldn't get stuck as non-admin — the first/owner user should auto-be instance admin."

## Invariants / traps (do not relearn the hard way)

- **Never edit applied migrations** (`0088`/`0089` are applied to dev) — fix at the route/repo layer.
- Migration numbers are GLOBAL by landing order (re-check before any new one).
- **Verification discipline:** never trust an agent's "done"; run the full gate with the REAL exit code.
- StrictMode double-fire: never call mutations inside a setState updater.
- `grill-me-codex` skill now drives Codex via Herdr panes (memory `herdr-codex-pane-review`).
