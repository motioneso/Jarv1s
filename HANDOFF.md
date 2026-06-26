# Build Handoff — wellness-ai-consent

**Spec (approved):** docs/superpowers/specs/2026-06-25-wellness-ai-consent.md
**GitHub issue:** #474
**Risk tier:** `sensitive` (gates BOTH wellness read tools with a consent toggle; default-ON via derive-on-read; new contributed Wellness settings surface; new GET/PUT /api/wellness/ai-consent route. Auto-merge after green QA + Ben digest.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/wellness-ai-consent **Branch:** build/wellness-ai-consent (off origin/main @ ac56457 — INCLUDES the merged #487 module-settings-connector)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Re-resolve the live pane by label each time; pane numbers reflow.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (immutable authority. Confirm still live before relying on it.)
**Relay threshold:** ~80–100k tokens OR a compaction summary (then relay immediately).

## Start

1. **Resolve your skills.** Confirm `coordinated-build` resolves by name; else open the absolute **Build skill path** above.
2. `pnpm install` — only if `node_modules` missing.
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** The #487 connector just merged — confirm its contributed-surface mechanism + `@jarv1s/settings-ui` atoms are present on your branch (they should be, you're on ac56457). Your Wellness settings surface should be the FIRST real consumer of the connector. If the connector's actual API drifted from the spec, escalate with the drift before proceeding.
5. Invoke **`coordinated-build`**: plan → coordinator approval → build TDD/green → pre-push trio (`pnpm format:check && pnpm lint && pnpm typecheck`) + rebase before push → **`coordinated-wrap-up`** (PR + report).

## Your compact (non-negotiable)

- **CI STATUS (temporary):** GitHub Actions billing paused. Run gate **locally** (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest), record exit codes.
- **CI gate:** run `pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest locally and record exit codes; CI also runs via `gh pr checks`.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files.
- Plan approval from the **coordinator**. No code before it.
- **Escalate to coordinator label `Coordinator`** on blocker / plan-ready / design-fork / done.
- **Never touch** board, milestones, or merge.
- **Self-monitor context.** ~80–100k tokens or compaction → message coordinator, then **`relay`**.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for status/escalations. Commit messages, PR bodies, code stay conventional.

## Collision notes (from the coordinator)

- **Dependency cycle invariant:** `packages/wellness` CANNOT import `@jarv1s/module-registry` (registry imports wellness). For the module-active lookup in the derive-on-read consent check, use the **ToolServices injection** pattern the spec describes — do NOT add a registry import to wellness.
- **You consume the #487 connector** (just merged on your base). Your Wellness settings surface (`packages/wellness/src/settings/`) is the first contributed module settings surface — add `entry: "./settings"` to the wellness manifest. If the connector's manifest field shape differs from what the spec assumed, escalate (don't silently adapt).
- **Gate BOTH wellness tools** (checkins + medication adherence) with ONE consent toggle — `wellnessMedicationAdherenceExecute` currently has NO gate; add it. Single switch, single mental model (meds data is sensitive).
- **No migration** (derive-on-read: pref if set, else module-active). Single pref key `wellness.ai_consent_granted`.
- New routes `GET/PUT /api/wellness/ai-consent` — confirm the wellness module's existing route registration pattern and reuse it.
- **Never touch** `docs/coordination/` (coordinator-only), never run repo-wide `pnpm format` + broad `git add` — scope to your own paths only.
