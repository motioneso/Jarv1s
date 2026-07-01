# Build Handoff — #652 in-container permission prompts Part 2

**Run:** `2026-06-30-rfa-fleet`
**GitHub issue:** #652
**Work source:** issue #652 + `docs/superpowers/spikes/2026-06-30-cli-permission-interception.md` (Ben approved this source pair for this run because the issue's referenced spec path is absent on `origin/main`)
**Risk tier:** `security` (per-session bearer, permission bridge, fail-closed native-tool gate)
**Worktree:** `~/Jarv1s/.claude/worktrees/652-perm-prompts`
**Branch:** `coord/652-perm-prompts`
**Build skill path:** `~/Jarv1s/.claude/worktrees/652-perm-prompts/.claude/skills/coordinated-build/SKILL.md`
**Coordinator label:** `Coordinator`
**Coordinator session id:** `019f1b3e-bd16-71b3-b753-703cd94e4e70`
**Relay threshold:** countable events: around 80-100k tokens or any compaction summary; then relay immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read `CLAUDE.md`, `docs/DEVELOPMENT_STANDARDS.md`, issue #652, this handoff, and `docs/superpowers/spikes/2026-06-30-cli-permission-interception.md`.
3. Invoke `coordinated-build` by name, or read the build skill path above in full and follow it.
4. Verify the current CLI runner / chat engine / confirmation registry code before planning.
5. Send your plan to `Coordinator` and wait for approval before editing feature code.

## Scope

Build the Part 2 permission bridge:
- Provision one Claude `PreToolUse` hook for interactive CLI/TUI mode and `claude -p` mode.
- Non-allowlisted native tools call a loopback Jarv1s permission endpoint with the existing per-session `jst_` bearer from a `0600` token file.
- Gateway emits existing `action_request` card and blocks on `ConfirmationRegistry.awaitResolution(150_000)`.
- Unsafe native tools surface owner-visible `action_request` and obey approve/deny.
- Timeout, gateway failure, missing/forged token, and hook exceptions all deny fail-closed.

## Collision Notes

- #629 waits for this lane because it relies on action-request behavior for email send/draft UX.
- Do not use `--permission-prompt-tool`; the spike says `PreToolUse` covers both modes.
- Do not use `--dangerously-skip-permissions`.
- Critical spike finding: the hook must own its internal deadline and return explicit deny on every failure. Do not rely on Claude hook `timeout`; killed hooks fail open.
- Keep token file `0600`; no bearer/token in argv, prompt, logs, docs, or frontend responses.

## Non-Negotiables

- Do not touch `docs/coordination/` except this handoff if you need to amend your own report.
- Do not touch board, milestones, merges, or other agents' worktrees.
- No repo-wide `pnpm format`; format/stage only files you changed.
- No `git add .` or `git add -A`.
- Fail closed at every trust boundary.
- Preserve the existing `action_request` UI path; no new bespoke UI unless unavoidable.

## Done

Open a PR, include local command exit codes, then message `Coordinator` with PR number and compact evidence. The coordinator owns QA and merge; this lane requires security-tier QA and Ben merge sign-off.
