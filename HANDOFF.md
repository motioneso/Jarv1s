# Build Handoff — user-custom-themes

**Spec (approved):** docs/superpowers/specs/2026-06-25-user-custom-themes.md
**GitHub issue:** #477
**Risk tier:** `routine` (isolated UI: tokens.css/app-shell.tsx/theme-storage + new theme routes; no schema/auth/secret surface. Auto-merge after green QA.)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/user-custom-themes **Branch:** build/user-custom-themes (off origin/main @ 63681e9)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (use this exact path if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `ses_0fef45f35ffeEJBGhPxqAsabKB` (the immutable authority for this coordinator — label is routing, the `…-N` number is ephemeral. Confirm this session id is still live before relying on the coordinator; it survives pane renumbering.)
**Relay threshold:** countable events — ~80–100k tokens OR a compaction summary in your own context (then relay immediately).

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
3. Read the spec above IN FULL.
4. **Verify the spec against the actual branch BEFORE planning.** Specs go stale. For each spec item,
   grep/read the cited files on YOUR branch and confirm the gap/state it describes is still real. If
   any item's premise has already shipped or drifted, **escalate to the coordinator** with the drift
   - your re-scoped plan before proceeding.
5. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → run the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out
   with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- **CI STATUS (temporary):** GitHub Actions billing is paused. `gh pr checks` shows red on every PR —
  **do NOT trust it**. Run the gate **locally**: `pnpm format:check && pnpm lint && pnpm typecheck`
  - relevant vitest, and record exit codes in your wrap-up report.
- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a plan ready for
  approval, a design fork outside this spec, a review request, or done.
- **Never touch** the project board, milestones, or merge — those are the coordinator's.
- **Self-monitor your context.** At ~80–100k tokens, or a compaction summary: message the
  coordinator, then use the **`relay`** skill.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator. Commit messages, PR bodies, and
  code stay normal/conventional.

## Collision notes (from the coordinator)

- **You are wave-1, no collisions.** Your files (`tokens.css`, `app-shell.tsx`, `theme-storage.ts`,
  new `/api/me/themes*` routes, new Appearance settings surface) are touched by NO other spec in
  this run.
- **CLAUDE.md "keep raw CSS colors in `tokens.css` only":** your runtime token-override mechanism
  applies colors as CSS variables via JS from the preference doc — do NOT scatter hex literals into
  component CSS. Document this in your plan.
- **Semantic tokens (red/amber/steel) are LOCKED** — your editor must not let users edit them, and
  the stored theme doc must never include them (structural invariant). This is the CLAUDE.md
  "preserve the authored design system" resolution.
- The spec says the Appearance surface "reuses the Module Settings Connector (#487)". **If #487 has
  not merged yet on your branch, build the Appearance surface as a normal settings pane for now and
  note the connector migration as a follow-up** — do NOT block on #487. Escalate to coordinator if
  unclear.
- **Never touch** `docs/coordination/` (coordinator-only), and never run repo-wide
  `pnpm format` + broad `git add` — scope format/staging to your own changed paths only.
