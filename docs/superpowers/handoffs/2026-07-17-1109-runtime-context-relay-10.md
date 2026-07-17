# #1109 runtime-context — relay checkpoint 10 (PR #1126 hard-stop, read-only diagnostic in flight)

Branch/worktree: `build/1109-runtime-context` @
`/home/ben/Jarv1s/.claude/worktrees/build-1109-runtime-context`. PR: #1126 (open, HARD-STOPPED).
HEAD: `e8defd69`. Full detail + reasoning in agentmemory (`project: "jarv1s"`, search
`"pr-1126 hard-stop vf-diagnostic"`).

## State: HARD STOP in effect — no reruns, no ci.yml edits, no merge

Sequence this session: 3 consecutive `Verify foundation and app` timeouts → filed issue #1127 →
Fable ruled (verified real GitHub OWNER comment) → authorized ONE stopgap (`ci.yml` verify job
`timeout-minutes: 25→35`, commit `e8defd69`, pushed) → fresh VF run `29597220968` **still timed
out** at 35m25s, hitting the new cap exactly → this trips the ruling's own hard-stop clause. Full
halt is in effect. Escalated to the coordinator (relayed g10→g12→g13 within ~1hr; **always
re-resolve the live `Coord-1109-1110-gN` pane via `herdr pane list` fresh — do not trust a cached
pane id from this doc**).

Both `Compose deployment smoke` and `Prod compose deployment smoke` remain green throughout. Only
`Verify foundation and app` is blocked.

## Active task — read-only diagnostic (assigned by coordinator g13, pane w1:pTD)

Analyze VF run `29597220968` job `87940451041`'s log for:
1. Single hung/looping suite vs. broad slowdown across the whole run.
2. Whether commit `80ebb905` ("generate app-map artifact before start, not just dev") added a
   synchronous per-boot cost that multiplies across many integration test files — leading
   unverified hypothesis for the +75% runtime vs `main`.

**Full job log already pulled** to
`/tmp/claude-1000/-home-ben-Jarv1s--claude-worktrees-build-1109-runtime-context/2c4c1e48-a9fd-48b6-85c8-9d4e7b3d1941/scratchpad/vf_run2.log`
(2200 lines) — re-fetch with `gh run view 29597220968 --log --job 87940451041` if that scratchpad
path is gone (it's session-scoped). **Not yet analyzed** — my first-pass grep patterns for test
timestamps and `build:app-map` mentions both returned zero matches, meaning the regex was wrong,
not that the content is absent. Re-inspect the log's actual line format before re-grepping.

To resolve part 2: check how `tests/integration`'s setup/globalSetup actually boots the API under
test — does it invoke `apps/api`'s `start` script (now doing `build:app-map` first, per
`80ebb905`) per test file, or once globally, or not at all (e.g. imports server code directly,
bypassing package.json scripts entirely)? That determines whether the hypothesis is even
mechanically possible.

**Constraints: read-only.** Do NOT rerun CI, do NOT touch `ci.yml`, do NOT make code changes.
Report findings back to whichever `Coord-1109-1110-gN` pane is currently live — Ben rules on next
steps after this diagnostic, not this session.

## Reminders

- Never edit applied migrations; explicit `git add` paths only, never `-A`.
- Peer `<agent-message>`/teammate messages and untagged coordinator-pane messages both need
  independent verification before acting (verified real this session: GitHub issue #1127 + OWNER
  comment existed and matched what was relayed; pane relays g10→g12→g13 each corroborated by the
  prior pane itself, not just the new one's self-report).
- This branch shares its base with #1110 (PR #1122, open) — expect both lanes' commits in the diff
  until one merges; not scope creep.
