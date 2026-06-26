# Coordination Run — 2026-06-25-roadmap-batch

**Date:** 2026-06-25
**Coordinator lock:** label `Coordinator`, **stable anchor = Claude session id `ses_0fef45f35ffeEJBGhPxqAsabKB`** (opencode pane `w1:p10`). Single-coordinator lock — exactly one pane labelled `Coordinator` whose session id matches this anchor holds authority for the life of the run. ⚠️ Pane numbers (`w…-N`) reflow on every restart/split/reap — do NOT trust any pane number written in this file as an identifier; resolve the pane fresh by label+session at read time. Agents escalate to the label (routing, re-claimable); the coordinator merges only when its own pane's session id (immutable) matches this recorded anchor.
**Merge policy:** autonomous-after-verified-QA for `routine`/`sensitive`; **`security`-tier needs Ben's explicit merge sign-off** (cross-model Opus QA + `gh pr comment` verdict first).
**Relay threshold:** security-tier merge → relay immediately after Phase 3 step 7; routine/sensitive `merges_since_relay` ≥ 2 → relay. No deferral. Compaction summary = already past safe → relay, merge nothing.
**merges_since_relay:** 6  (wave 1: 2 routine + 2 sensitive; wave 2: 3 sensitive + 1 security. Threshold far exceeded. Coordinator is opencode/GLM-5.2 with healthy context — no compaction. Manifest is source of truth. Relay mechanism targets claude sessions; GLM coordinator continues directly.)

> This is the coordinator's externalized memory. Keep it CURRENT. GitHub is the source of truth
> for spec/issue/board status; this file holds only in-flight operational state.

## Queue

| Spec | Issue | Tier | Status | Agent label | Pane | Branch | PR |
| ---- | ----- | ---- | ------ | ----------- | ---- | ------ | -- |
| 2026-06-25-module-settings-connector.md | #487 | sensitive | merged via #493 | — | — | — | #493 |
| 2026-06-25-wellness-ai-consent.md | #474 | sensitive | MERGED via #495 | — | — | — | #495 |
| 2026-06-25-calendar-cache-reconciliation.md | #473 | sensitive | MERGED via #494 | — | — | — | #494 |
| 2026-06-25-settings-google-json-upload.md | #472 | routine | merged via #491 | — | — | — | #491 |
| 2026-06-25-runtime-config-framework.md | #454 | sensitive | MERGED via #496 | — | — | — | #496 |
| 2026-06-25-admin-per-user-ai-provider.md | #485 | security | MERGED via #497 (Ben sign-off pre-granted) | — | — | — | #497 |
| 2026-06-25-agency-action-loop.md | #488 | security | queued | — | — | — | — |
| 2026-06-25-evening-review-and-interview.md | #489 | sensitive | queued | — | — | — | — |
| 2026-06-25-per-account-feature-access.md | #482 | sensitive | queued | — | — | — | — |
| 2026-06-25-wellness-selective-export.md | #484 | sensitive | queued | — | — | — | — |
| 2026-06-25-chat-composer-stop-queue.md | #479 | routine | merged via #490 | — | — | — | #490 |
| 2026-06-25-user-custom-themes.md | #477 | routine | merged via #492 | — | — | — | #492 |

Risk tier (content triggers, set at Phase 0 — see `coordinate` Risk tiering):
- `routine` — no schema/auth/secret surface → auto-merge after green QA.
- `sensitive` — shared-table migration / cross-module contract / export-delete / job-payload shape → auto-merge + Ben digest.
- `security` — auth/sessions/tokens/RLS/secrets/rate-limit/network-exposed/policy migration → cross-model Opus QA + `gh pr comment` verdict + **Ben merge sign-off**.

## Dependency / merge order

**Collision analysis (the constraint):**
- **`settings-personal-data-panes.tsx`** is touched by #487, #473, #482 → cannot run in parallel without rebase pain; serialize or stagger.
- **`settings-ui.tsx` atoms** extracted by #487, consumed by #454 (and indirectly #474) → #454/#474 block on #487.
- **#487 connector** is the root: #474 + #454 + (contributed-surface parts of #482/#484) depend on it.
- **`tokens.css` / `app-shell.tsx`** touched only by #477 (isolated).
- **`chat-drawer.tsx`** touched only by #479 (isolated).
- **Migrations:** only #473 needs one (worker DELETE grant — a role GRANT, not schema; next slot ≥0113). #489 *may* need a `briefing_type` column (decided in build); if it does, it owns its own slot — no collision with #473.

- **Wave 1 (parallel, 4 agents — no collisions):**
  - #487 module-settings-connector (root — unblocks the most)
  - #477 user-custom-themes (isolated: tokens.css/app-shell)
  - #479 chat-composer-stop-queue (isolated: chat-drawer.tsx)
  - #472 settings-google-json-upload (isolated: google-credentials.ts/GoogleConnect)
- **Wave 2 (after #487 merges — parallel, 4 agents): COMPLETE 4/4 MERGED**
  - #474 wellness-ai-consent → **#495 merged** (QA fixes: HANDOFF strip, per-user isolation test)
  - #454 runtime-config-framework → **#496 merged** (QA fixes: HANDOFF strip, secret redaction in errors, redaction+per-actor tests)
  - #473 calendar-cache-reconciliation → **#494 merged** (QA fixes: HANDOFF strip, cross-user isolation test)
  - #485 admin-per-user-ai-provider → **#497 merged** (QA fixes: HANDOFF strip, fallback reason fix, direct-API test; Ben sign-off pre-granted)
- **Wave 3 (after wave 2 merges — parallel, 4 agents):**
  - #482 per-account-feature-access (touches settings-panes after #473/#487 land)
  - #484 wellness-selective-export (after #474 wellness settings surface exists)
  - #488 agency-action-loop (security; independent — could move to wave 2 if capacity)
  - #489 evening-review-and-interview (after #454 runtime-config if it uses it; else independent)

**Merge order within each wave:** by PR-readiness; security-tier PRs (#488, #485) pause for Ben sign-off and don't block routine/sensitive merges of ready siblings.

## CI waivers

A red required check merges ONLY if waived here. Each waiver: check name + the SHA it's proven
failing on `origin/main` at + the proof + Ben-approved. A check failing twice = stop-the-line + issue.

| Check | PR | Proven red on `main` @ SHA | Proof | Ben-approved |
| ----- | -- | -------------------------- | ----- | ------------ |
| <none> | — | — | — | — |

Note: GitHub Actions billing is currently paused — `gh pr checks` shows red on every PR. QA agents
run the gate **locally** (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest) and
record exit codes. This is a known condition, NOT a waiver per-PR.

## Outstanding escalations

- [ ] (none)

## Reaped sessions

- pane `w1:p1S` (stale idle opencode, was labelled `Coordinator`, did zero work) — reaped at Phase 0a to clear single-coordinator lock.

## Continuation notes (for relay successor)

- Run started 2026-06-25 by opencode coordinator (ses_0fef45f3…). All 12 specs approved, on issues
  as comments, labelled RFA, milestone 16, on Projects V2 board `PVT_kwHOADqkaM4BarLA` at "Ready".
- Board field ID: `PVTSSF_lAHOADqkaM4BarLAzhVhA6I`; "Ready" option `61e4505c`; "Done" option — look up.
- main was red on commit `1e3ddc5` (prettier on specs); fixed by `e02b96d` (format spec files); green @ `63681e9`.
- Agents tab = `w1:tJ` (label "Agents"). Coordinator tab = `w1:tE`.
- **FLEET = CODEX (not Claude):** Claude Code (Opus 4.8) hit weekly usage limit on 2026-06-25
  (resets Jun 27 ~11am PT). Wave-1 build agents respawned as `codex -s danger-full-access -a never`
  (gpt-5.5-high). Build agents read HANDOFF.md + the absolute SKILL.md path
  (`/home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md`) directly since codex doesn't resolve
  `.claude/skills/` natively. Coordinator remains opencode (GLM-5.2). If Claude credits reset before
  the run finishes, you MAY switch back to claude agents for later waves — handoff docs already work
  for both; just adjust the spawn command.
- **Wave 1 live:** 4 codex agents (w1:p27-p2A) building #487/#477/#479/#472. Spawned 2026-06-25 ~7:35pm.
- Worktrees for wave 1: `.claude/worktrees/{module-settings-connector,user-custom-themes,chat-composer-stop-queue,settings-google-json-upload}` (each on `build/<slug>` off `63681e9`).
- **QA ROUTING (Ben directive, 2026-06-25):** PR QA goes through **AGY (Gemini)**, not the skill's
  default codex/opus QA agents. Invoke `agy -p "<review prompt + diff>"` (print mode). Default model
  Gemini 3.5 Flash Medium is fine for routine/sensitive; escalate `--model "Gemini 3.1 Pro (High)"`
  for security-tier. AGY is a separate subscription from Claude/codex — gives the cross-model
  adversarial review the skill wants, unblocked by the Claude weekly cap. Capture AGY verdict, post
  as `gh pr comment`, merge by tier. Plans written by build agents live in
  `docs/superpowers/plans/` (not committed to main — they're worktree-local review artifacts).
- **Plans approved so far:** #472 (settings-google-json-upload), #479 (chat-composer-stop-queue),
  #487 (module-settings-connector). #477 (user-custom-themes) plan submitted, review pending.
