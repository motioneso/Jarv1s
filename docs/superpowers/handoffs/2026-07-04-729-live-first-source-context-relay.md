# Relay — #729 live-first source context (2026-07-04)

Self-handoff: predecessor hit the 70% context meter mid-T16 (final gate task). You are the
successor build agent. Resume via `coordinated-build`.

## Where you are

- **Spec:** issue #729 / `docs/superpowers/specs/2026-07-04-live-first-source-context.md`
- **Plan (source of truth, 16 tasks):** `docs/superpowers/plans/2026-07-04-live-first-source-context.md`
- **Worktree:** `~/Jarv1s-wt/729-live-first-source-context`, branch `feat/729-live-first-source-context`, grounded `afd897b2`
- **Commits:** `355a9165` (plan) → `f9f1a875` (T16 partial). Tasks T1–T15 done and committed; T16 in progress.
- **Working notes:** `/tmp/claude-1000/-home-ben-Jarv1s/c5b2d22f-a703-491c-805d-45e89b72c172/scratchpad/grounding-notes.md`
  — read the `T16 RELAY POINT` section for exact split guidance.
- Skip `pnpm install`: `[ -d node_modules ] || pnpm install`.

## T16 status

Done: integration fix pass (full `test:integration` green — 109 files, 1296 pass / 2 skip),
new `tests/integration/source-context-briefing.test.ts` (3/3) + `source-context-helpers.ts`,
tasks-suggested-status DB-uniqueness tests (6/6), connectors monitor-queue expectation fix,
lint + format clean, 2 of 4 file-size splits (briefings-compose harness; settings
EmailTaskCreationRow).

## Remaining steps (in order)

1. **File-size splits** (`check:file-size` caps everything at 1000 lines):
   - `apps/web/src/today/today-page.tsx` (1009): extract T15's "Suggested from email" section
     (component + its triage accept/reject mutation) to `apps/web/src/today/today-suggested-email.tsx`.
   - `packages/tasks/src/routes.ts` (1006): extract T13's email-feedback wiring
     (`EmailTriageFeedbackPort` + feedback recording) to `packages/tasks/src/email-feedback.ts`.
     `module-registry` imports `EmailTriageFeedbackPort` from `@jarv1s/tasks` — keep the public
     export stable via `packages/tasks/src/index.ts`.
   - Per split: eslint, prettier, tsc, rerun touched unit/integration suites.
2. **Full gate:** `pnpm verify:foundation > /tmp/gate.log 2>&1; echo "GATE_EXIT=$?"` — NEVER pipe
   to `tail` (masks the exit code; bit this run twice). Repeat until exit 0.
3. **Commit** with exact paths only — another session may share state; never `git add -A`.
4. **Ship:** push branch, open PR "feat: live-first email/calendar source context (#729)" — body
   maps spec sections → plan tasks + verification evidence; note the spec's "near-term refresh
   before briefings" is satisfied by compose-time live reads. Then
   `superpowers:finishing-a-development-branch`.
5. **Report to coordinator** (herdr-pane-message, reads bounded `--source recent --lines 12`).

## Traps (all hit this run)

- Vitest with NO env prefix (`JARVIS_PGDATABASE=` empty string defeats the `?? "jarv1s"` default).
- Shell cwd resets every Bash call — prefix `cd ~/Jarv1s-wt/729-live-first-source-context &&`.
- `email_messages` RLS INSERT needs full `'https://www.googleapis.com/auth/gmail.modify'` scope;
  seeds use unified `'google'` provider_id (legacy `google-email`/`google-calendar` →
  `unsupported_provider`).
- `foundation.test.ts` asserts the FULL migration list with `toEqual` — 0140/0141 rows already added.
- Do NOT weaken the read tools' fail-closed behavior (`narrowSourceContext` throws) to make
  anything pass; cache fallback is for transient failures only.
- prettier --write any handoff/doc file before committing (format:check gates docs too).

## Coordinator context

Coordinator instruction outstanding: report successor pane/session (predecessor does this at
spawn) and the collision analysis — **#732 collides hard** with #729 (settings panes,
email/calendar manifests, packages/email tools/repository, sync-now removal; hold until #729
merges). **#721 mostly disjoint** (soft overlap: `packages/chat/src/routes.ts`,
`packages/briefings/src/compose.ts` + `signals.ts`; release with rebase-after-#729 note).
Predecessor sends this report; you only need to answer follow-ups.
