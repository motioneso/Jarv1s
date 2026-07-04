# #721 chat-priority-context-ranking — relay #4 handoff

Branch/worktree: `rfa-721-chat-priority-context-ranking` (this tree). Plan (authoritative,
follow task-by-task): `docs/superpowers/plans/2026-07-04-chat-priority-context-ranking.md`.
Coordinator = Codex pane, resolve fresh via `herdr pane list` (label `Coordinator`; the
`pane_id` is ephemeral, re-resolve every time — do not reuse an id from this doc).

## Guardrails (verbatim, binding)

No new source reads — rank only already-loaded candidates. No second ranking system —
reuse `rankChatContext`/`reorderByPriority`/`rankPriorityCandidates` only; **never modify
`@jarv1s/priority`'s scorer** (`packages/priority/src/scoring.ts`). Do not touch
`packages/email`. Do not edit `docs/coordination/`. No repo-wide `pnpm format`. No
`git add -A`/`.`/broad checkout/reset/stash — exact file staging only. Never persist
priority candidate snapshots, source bodies, secrets, or connector metadata.

## State

- Tasks 1–3: done, committed (`f30f70dc`, `607705c3`, `63052e78`).
- Bonus fix (Coordinator-approved, see pane history): pre-existing concurrency bug in
  `runSourcesWithConcurrencyLimit` (`packages/chat/src/live/cross-tool-reasoning.ts`)
  silently dropped a source's items when two sources settled close together — it deleted
  a settled promise from `inFlight` inside its own `.then()`, racing ahead of the drain
  loop. Fixed + regression test, committed `990a9022`.
- Task 4 (wire priority reorder into `ChatSessionManager.engineText`,
  `packages/chat/src/live/chat-session-manager.ts`): **wired but NOT green, NOT
  committed.** Working tree has uncommitted edits to `chat-session-manager.ts` and a new
  `tests/unit/chat-session-manager-priority.test.ts` (from the plan, verbatim). 3/4 tests
  pass. Failing: `"reorders cross-tool context by the user's priority model (muted
  calendar sinks)"`.

### The remaining Task 4 blocker

`rankPriorityCandidates`'s `mutedSources` handling (`scoring.ts:184`) only **caps** a
muted candidate's score to `<= BANDS.low.max` (34) — it does not force it below an
unmuted candidate that simply has less signal. In the test, the calendar item ("Today
work sync", `startsAt` = soon) scores ~28 ("due today"), already under the cap. The tasks
item ("Write quarterly report") has no `dueAt`/`explicitPriority` in the candidate we
build (`CrossToolEvidenceItem` only carries a `relevance` band, not a raw priority
number), so it scores ~0. Muted calendar (28) still outranks unmuted tasks (0) — backwards
from what the test expects.

Root cause confirmed by reading `computeScore`/`tieBreakKey` in `scoring.ts` — sort key is
`[-score, ...]`, pure score-descending, no separate muted-bucket. **Do not touch that
file.**

**Proposed fix** (in `chat-session-manager.ts`'s own candidate-mapping, before calling
`rankChatContext` — stays inside Task 4's file, doesn't touch the scorer): map
`item.relevance` → `explicitPriority` (e.g. `high=5, medium=3, low=1`) when building the
candidate list, so an unmuted item actually has ranking signal for muting to suppress
against. **Flag this to the Coordinator before implementing** — it's a small interpretive
addition beyond the plan's literal code, not just a typo/shape fix like the Task 4 note
already pre-approved.

No local run-manifest file was found for this coordinated-build; state lives in this
handoff chain + Coordinator pane history only.

## Next steps

1. Propose the `relevance → explicitPriority` mapping to Coordinator, get an ack (or a
   different steer).
2. Implement, re-run `tests/unit/chat-session-manager-priority.test.ts` to green.
3. Regression: `tests/unit/chat-session-manager.test.ts`,
   `chat-session-manager-provenance.test.ts`, `chat-session-manager-resume.test.ts`,
   `chat-cross-tool-reasoning.test.ts` — all currently green, must stay green.
4. Commit Task 4 (`chat-session-manager.ts` + its test) with message
   `"feat(chat): rank cross-tool context with the user's priority model (#721)"`.
5. Task 5: thread `priorityModel` dep through `runtime.ts` → `routes.ts` →
   `module-registry/src/index.ts` (see plan doc, Task 5 section, not yet started).
6. Task 6: `packages/settings-ui/src/priority/index.tsx` muted-source copy fix (see plan
   doc, Task 6 section, independent of 4/5, not yet started).
7. Wrap-up per plan: `pnpm verify:foundation`, pre-push trio, rebase on `origin/main`
   **twice** (once now, again after PR #729 lands — expected overlap in
   `packages/chat/src/routes.ts`), then `coordinated-wrap-up` (push + open PR referencing
   #721, report to Coordinator — no merge/board actions, those are Coordinator-owned).

## Self-monitor

Relay again at ~80–100k tokens or immediately on a compaction summary. Don't wait for a
natural stopping point — checkpoint (memory save + new relay-N handoff + message
Coordinator) as soon as you notice.
