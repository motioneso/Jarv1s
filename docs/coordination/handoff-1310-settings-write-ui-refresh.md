# Handoff — #1310: a settings write doesn't reach the UI

**Issue:** #1310 · **PR:** #1276 · **Branch/worktree:** `1264-settings-self-operation` (already
checked out at `/home/ben/Jarv1s/.claude/worktrees/1264-settings-self-operation`, clean and level
with origin) · **Tier:** `security` — this PR does not merge without Ben's explicit sign-off.

**Coordinator:** label `Coordinator`, Claude session `43e5f5e2-0deb-4ab5-9237-436e8795b611`.
Report to the `Coordinator` label via the `herdr-pane-message` skill. Follow `coordinated-build`.

## The defect (found by Ben in a hands-on pass, not by a test)

Asking the assistant to change the theme **persists correctly** — `themes.color-mode` is written —
but the screen does not change until a manual page refresh. The tool reports success, and the user
sees nothing happen. That is the whole bug: the write works, the UI is stale.

Verified fix site, on this branch:

- `apps/web/src/shell/app-shell.tsx:209` reads the themes via React Query
  (`queryKey: queryKeys.settings.themes`).
- `apps/web/src/shell/app-shell.tsx:181` already filters the chat stream for
  `record.kind === "action_result"`. That seam exists and is where a completed tool write becomes
  observable to the shell.

Nothing invalidates the themes query when an `action_result` arrives. Confirm this yourself before
changing anything — do not take this brief's word for it.

## What must be true when you're done

1. A settings write performed through chat is reflected on screen **without a manual refresh**.
2. The invalidation is **not theme-specific**. A generic settings writer is coming (epic #1262) and
   will need this same seam for every setting, so the mechanism must key off the action result, not
   off "this was the theme tool". Do not hardcode a single query key if the seam can carry which
   surface changed.
3. **An e2e UAT proves it.** Drive the real path — chat turn → tool → DOM assertion — against a real
   dev instance, and assert on the words a user actually sees, not internal ids. A test that asserts
   database state does not discharge this; that is exactly how this bug reached Ben's hands.
4. `pnpm verify:foundation` green with a real exit code. Never `| tail` or `| head` a gate command.

## Bans and constraints

- Scope is the refresh path only. **Do not broaden the theme tool's enum** (`theme-mode-tool.ts`
  accepts only `light`/`dark`, and four themes are unreachable) — that gap is deliberately owned by
  the epic #1262 spec, not by this fix.
- **Do not touch `packages/settings/src/app-map-tool.ts`** — owned by #1265.
- Do not edit `docs/coordination/` (coordinator-only). Do not run repo-wide `pnpm format`.
- Never `git add -A` / `git add .` — stage explicit paths only.
- Any test or DB operation must set `JARVIS_PGDATABASE` to an isolated database. Never the shared
  dev DB.
- CLAUDE.md hard invariants apply. Migrations `0175`/`0176`/`0177` are applied and FROZEN.
- Escalate with `[SECURITY]` / `[DESIGN-FORK]` / `[CRIT]` tags so the coordinator routes correctly.
