# Build-agent handoff — Wellness Codex code-review remediation

**You are a BUILD AGENT** under the Wellness dev coordinator (Herdr label
**`Wellness-Coordinator`**, session `ea8e89af`). Invoke the **`coordinated-build`** skill and follow
it. Your job: fix all 9 findings from the Codex thermonuclear code review, get the gate green, and
report back. **Do NOT push, open a PR, merge, or touch `docs/coordination/`** — the coordinator owns
those. **Do NOT run repo-wide `pnpm format` + broad `git add`** — stage only the paths you change
(another session shares concepts here).

## Worktree / branch (shared primary worktree — no new worktree)

- CWD: `~/Jarv1s/.claude/worktrees/feat+wellness-design`
- Branch: `worktree-feat+wellness-design` (HEAD `476f943`). `node_modules` present — **do NOT
  `pnpm install`** (relay confirmed it's there).
- The coordinator is resident in this same tree but will NOT edit feature code while you work.

## Canonical sources (read these IN FULL first)

- **Findings + locked decisions:** `docs/superpowers/handoffs/2026-06-15-wellness-design-relay.md`
  **section "1. Remediate the Codex thermonuclear CODE review"** — the 9 fixes (H1, H2+M5, H3, M4,
  M6, M7, L8, L9, L10) with Ben's decisions. This is authoritative; follow each decision exactly.
- **Full Codex critique:** `~/.claude/jobs/914af5c0/tmp/codex9-full.txt` (read for detail).
- Spec: `docs/superpowers/specs/2026-06-14-p5-wellness-design-taxonomy-insights.md`
- Codex-approved build plan: `PLAN.md` (worktree root).

## Hard constraints (blockers if violated)

- **Never edit applied migrations `0088`/`0089`** — they are applied to dev (hash-checked). Fix at
  the route/repo/client layer only. H1 is **documentation-only** (record fail-loud in the spec's
  Open Risks; no `0088` edit). M4 catches `P0001` AND `23503` at the route layer; no `0089` edit.
- **H2+M5**: replace the raw `/api/wellness/medications/logs` endpoint with a server-side per-day
  adherence summary (`{date, scheduledCount, takenCount, doses:[{medicationId,name,status,prn}]}`)
  computed by reusing `computeSchedule` across the window — **no `dose`/`prnReason` in the
  response**. `insights.ts` adherence uses the same expected-slot denominator. New DTO in
  `wellness-api.ts`; update `client.ts`/`query-keys`/`wellness-chart.tsx`/`wellness-trends.tsx`.
- **H3**: add owner-scoped `PATCH /api/wellness/checkins/:id` (shared req+route schema,
  `repository.updateCheckin` re-validating the feeling path + `feeling_tertiary` null, 404 handler,
  manifest route under `wellness.update`, client `updateWellnessCheckin`; modal calls it when
  `initial` present). Invalidate checkins+insights after.
- No secrets in responses/logs/payloads; owner-only RLS; DataContextDb/VaultContext only.
- 1000-line file-size limit (`pnpm check:file-size`).

## Process

1. **Plan first (brief).** Post a short remediation plan to `Wellness-Coordinator` — ONE line per
   finding: the file(s) you'll touch + the approach. The decisions are already locked in the relay
   doc, so this is a confirmation, not a fork. Wait for the coordinator's approval before editing.
   To message the coordinator use the two-call path:
   `herdr pane send-text <coordinator-pane> "<msg>"` then `herdr pane send-keys <coordinator-pane> Enter`.
   (Resolve the coordinator pane fresh by label `Wellness-Coordinator` via `herdr pane list` — pane
   numbers reflow.)
2. **Build** all 9 fixes. Match surrounding code style. Add/extend tests:
   - L10: seed OTHER-user check-ins/logs/meds and assert the actor's insights/counts contain only
     their own data (not just 200+key).
   - Add coverage for the new PATCH endpoint and the adherence-summary endpoint.
3. **Verify — REAL exit code.** Run `pnpm verify:foundation` and read the **actual** exit status.
   Do NOT wrap it in `; echo; tail` (a wrapper masked a real exit 1 once). Also run the cleanup
   `rg` gate for stale vocabulary/scaffolding. DB is up on `localhost:55433` (`postgres:postgres`,
   db `jarv1s`); migrations `0088`/`0089` already applied.
4. **Commit** green, staging only your changed paths. Commit trailer:
   `Co-Authored-By: Claude <noreply@anthropic.com>`.
5. **Report** to `Wellness-Coordinator` (two-call path): the commit SHA, the REAL gate exit code,
   per-finding one-line status, and any deviation. Do NOT push/PR/merge.

## Escalate (don't guess)

Tag messages `[DESIGN-FORK]` / `[SECURITY]` / `[CRIT]` if you hit anything the relay decisions
didn't settle. If blocked, say so — keep the task in progress, don't fake "done".
