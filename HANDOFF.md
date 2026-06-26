# Build Handoff — settings-google-json-upload

**Spec (approved):** docs/superpowers/specs/2026-06-25-settings-google-json-upload.md
**GitHub issue:** #472
**Risk tier:** `routine` (pure frontend port: extract helpers + inline upload UI; no schema/auth/secret surface. Auto-merge after green QA.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/settings-google-json-upload **Branch:** build/settings-google-json-upload (off origin/main @ 63681e9)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id; re-resolve the live pane by label each time.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (immutable authority. Confirm still live before relying on it.)
**Relay threshold:** ~80–100k tokens OR a compaction summary (then relay immediately).

## Start

1. **Resolve your skills.** Confirm `coordinated-build` resolves by name; else open the absolute
   **Build skill path** above.
2. `pnpm install` — only if `node_modules` missing.
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Grep/read cited files on YOUR
   branch; confirm the gap is still real. If drifted, escalate before proceeding.
5. Invoke **`coordinated-build`**: plan → coordinator approval → build TDD/green → pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + rebase before push →
   **`coordinated-wrap-up`** (PR + report).

## Your compact (non-negotiable)

- **CI STATUS (temporary):** GitHub Actions billing paused. Run gate **locally**
  (`pnpm format:check && pnpm lint && pnpm typecheck` + relevant vitest), record exit codes.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files.
- Plan approval from the **coordinator**. No code before it.
- **Escalate to coordinator label `Coordinator`** on blocker / plan-ready / design-fork / done.
- **Never touch** board, milestones, or merge.
- **Self-monitor context.** ~80–100k tokens or compaction → message coordinator, then **`relay`**.
- Honor every CLAUDE.md Hard Invariant. **No secrets in any doc, payload, log, or prompt** — this
  spec handles Google credentials JSON; be extra careful: never log/commit a real credentials
  payload, even in a test fixture. Use clearly-fake placeholder JSON for tests.
- **Caveman mode** for status/escalations. Commit messages, PR bodies, code stay conventional.

## Collision notes (from the coordinator)

- **You are wave-1, no collisions.** Your files (`apps/web/src/connectors/google-credentials.ts`
  new, `GoogleConnect` component) are touched by NO other spec.
- The extraction targets (`importCredentialsJson` + `extractGoogleClientCredentials`) currently live
  inline in `GoogleConnect` — confirm their exact location on your branch before planning the
  extraction.
- **Never touch** `docs/coordination/` (coordinator-only), never run repo-wide `pnpm format` +
  broad `git add` — scope to your own paths only.
