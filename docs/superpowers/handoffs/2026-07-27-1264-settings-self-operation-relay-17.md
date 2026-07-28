# Relay 17 — #1264 settings self-operation

## State: file-size gate fixed + committed, undo-CAS test gap found + fixed + committed. Full gate re-run + wrap-up still needed.

## Coordinator correction (2026-07-27, binding, already applied to pr-body.md — don't re-introduce)

The coordinator independently re-verified both `ece42556` and `1f73ec84` and ACCEPTED both — no
rework needed on the substance. But it banned two words from the PR body for either change:
**never call this lane's own work "pre-existing" or "unrelated."** Both were used as honest
shorthand for "not the task I'm currently on," but to a reviewer at security tier they read as
"inherited, someone else's problem, safe to skim" — the wrong signal. `chat/routes.ts` growing
over the cap was this branch's own Task 8 commit; `notification-preference-application.ts` is a
new 94-line file this PR created, so the undo-entry test gap is this PR's own bug in its own new
code, not something inherited. Describe both plainly as this PR's own work being fixed by this PR.
`pr-body.md` (scratchpad path below) has already been edited to comply — don't undo that language,
and don't use either banned word if you touch the PR body further.

The coordinator also asked for one new correctness point to be stated explicitly in the PR body
(already added, in its own subsection under "What changed"): the undo stack's CAS must record the
**post-mutation** `resultingRevision`, never `previous.revision` — recording the wrong one would
let undo race and clobber a concurrent write instead of refusing. This is now in `pr-body.md`.

Commits since relay-16 (not yet pushed — push happens at wrap-up per skill):
- `ece42556` refactor(chat): extract gateway dependency assembly out of routes.ts (#1264)
- `1f73ec84` fix(settings): fake resultingRevision in notification-preference undo test (#1264)

## What relay-16 got wrong — corrected already, don't re-introduce

The coordinator corrected relay-16 mid-session: the file-size failure was **NOT pre-existing
drift**. `packages/chat/src/routes.ts` is 994 lines on `origin/main`, 1025 on this branch — this
lane's own Task 8 commit (`fc2a42b7`) pushed it over. The PR body (see below) already reflects
this correctly. Do not describe it as inherited/pre-existing anywhere.

## `ece42556` — the extraction (DONE, verified pure move)

Moved `buildChatToolServices`, `buildChatGatewayDependencies`, `resolveYoloMode`,
`buildActionPolicy`, `buildAgencyPrefs` from `packages/chat/src/routes.ts` into new
`packages/chat/src/gateway-services.ts`. `routes.ts` re-exports the three test files need
directly; the `@jarv1s/chat` barrel covers the rest automatically.

Verified and don't need to re-verify:
- Pure move proof: every `server.get/post/put/patch/delete` call site (15 total) extracted from
  `routes.ts` before vs. after — **byte-for-byte identical**, same order, line numbers shifted
  uniformly by exactly -18 (the removed import lines). Comment count preserved exactly (93 → 78+15).
- `prettier --check`, `eslint`, `pnpm --filter @jarv1s/chat typecheck` all clean.
- All 4 dependent test files green: `tests/unit/chat-gateway-dependencies.test.ts` (1),
  `tests/integration/chat-mcp-transport.test.ts` (20), `tests/integration/focus-time.test.ts` (19),
  `tests/integration/notes-write-tools.test.ts` (18) — 58/58.

## `1f73ec84` — undo-CAS test gap in this PR's own new code, found during the first full-gate re-run (DONE, verified)

First `JARVIS_PGDATABASE=jarvis_build_1264 pnpm verify:foundation` re-run (fresh DB) got to
`test:unit` and failed real, deterministic (reproduced in isolation, not order-dependent):
`tests/unit/settings-notification-preference-tool.test.ts` > "pushes an undo entry when the
service reports changed=true". Root cause: the test's fake `setEnabled` omitted
`resultingRevision`; `notificationPreferenceSetEnabledExecute` (`packages/settings/src/
notification-preference-tool.ts:68`) only pushes an undo entry when `resultingRevision !==
undefined`, matching the documented contract ("present only when changed") in
`notification-preference-application.ts:34`. Fixed by adding `resultingRevision: 2` to the fake
and asserting it in the `toMatchObject`. This file doesn't exist on `origin/main` — it's entirely
this lane's own work (`fc2a42b7`/`127156d7`/`277d9e81`), so this is this lane's own bug, not
inherited. Verified: `tests/unit/settings-notification-preference-tool.test.ts` 7/7 green in
isolation.

**This was NOT part of the file-size extraction scope** — it's a separate bug in this PR's own new
`packages/settings/notification-preference-application.ts` code, fixed as its own commit. Mention
it plainly in the PR as this lane's own fix, not as "unrelated" or "pre-existing" (coordinator
correction above) — `pr-body.md` already has the compliant wording in its own subsection.

## Immediate next step: re-run the FULL gate from scratch (not yet done since the fix)

The full-gate exit code you have on file (from before `1f73ec84`) is **1, not 0** — do not trust
any earlier "green" claim. Re-run clean:

```
docker exec jarv1s-postgres psql -U postgres -c "DROP DATABASE IF EXISTS jarvis_build_1264;"
docker exec jarv1s-postgres psql -U postgres -c "CREATE DATABASE jarvis_build_1264;"
JARVIS_PGDATABASE=jarvis_build_1264 pnpm verify:foundation
```

Run as a background task, wait for the **real exit code** (never pipe through `tail`/`head` — it
masks a failing gate as exit 0; this bit relay-16's successor once already via a misleading task-
notification summary line that said "exit code 0" for the *bash wrapper*, not the pnpm command
inside it — always grep the log for `EXIT_CODE=` yourself, don't trust the notification summary
text).

## After the gate is green

Invoke `coordinated-wrap-up`: clean tree, pre-push trio (`format:check && lint && typecheck`),
fresh `git fetch origin main && git rebase origin/main`, push, open PR citing **#1264 and #1272**.

**PR body is fully drafted, corrected, and ready to paste verbatim — no further edits needed:**
`/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-1264-settings-self-operation/6438d10e-47c6-454a-bece-43d6dcd860f0/scratchpad/pr-body.md`
It already includes: the file-size extraction section with route-table proof; a dedicated
undo-CAS subsection under "What changed" stating the post-mutation-`resultingRevision`-not-
`previous.revision` correctness property; an "Undo-CAS test gap" section describing the
`1f73ec84` fix as this PR's own bug in this PR's own new code (never "unrelated"/"pre-existing" —
coordinator correction above); and two `[x]` Test plan lines for the extraction and the test fix.
If that scratchpad path is gone in your session, this doc's git history (`git log -p` on this file)
has the full compliant text to reconstruct from — do not regenerate from relay-16's original
draft, which predates the coordinator's correction.

## After opening the PR

1. Report the PR URL + verified gate evidence (exit codes, test counts) to coordinator `coord-1262`
   — resolve its herdr pane **fresh** via `herdr pane list`, never a cached pane id.
2. **STOP.** Never merge, never touch the project board, never close #1264 — Ben's manual LAN pass
   gates merge regardless of CI green. This is the coordinator's job, not yours.

## Standing bans (unchanged, still binding)

- Never edit `packages/settings/src/app-map-tool.ts` (owned by #1265).
- Never `git add -A` / `git add .` — stage explicit paths only.
- Never commit `.claude/context-meter.log` (currently shows modified in `git status` — leave it).
- Any gate run needs a fresh isolated `JARVIS_PGDATABASE` (`jarvis_build_1264`), never the shared
  dev DB, and never piped through `tail`/`head`.
- Never run a repo-wide `pnpm format` — scope prettier fixes to named files only.
- Rate limiter (Task 13) is in-memory/per-process only; frame as a runaway-loop guard, never a
  security boundary or tier/policy input.
- Inventory-assertion rebase vs #1265 falls on whichever lane lands its PR **second** — not
  settled which; never encode either assumption.
- `packages/settings/src/routes.ts` is at exactly 1000 lines on this branch — passes (cap is
  >1000), but one line from red; don't grow it.
- Don't shave comments to fit a size cap — extraction/fix is the tool, deletion of why-comments is
  not (comment count parity already proven for the extraction: 93 → 93).
- Read spec/plan sections only, never in full.
