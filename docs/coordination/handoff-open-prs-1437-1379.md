# Handoff: close open PRs #1437 and #1379

**Date:** 2026-08-06 · **Why now:** both block Moss-rename PR2 (#1442), whose 6,035-reference diff
would conflict with each. Nothing else in the rename epic depends on them.

Two unrelated problems. #1437 is a one-line type error. #1379 is a credentials blocker, not a code
problem. Neither needs a redesign.

---

## PR #1437 — "Batch 1: Chat & Approvals" · CI RED · ~1 line

`fix/batch1-chat-approvals` · 6 files, +66/-14 · worktree already exists at
`.claude/worktrees/batch1-chat-approvals` (at PR head `22369169e`).

**Both failing jobs fail on the same typecheck error** — "Verify foundation and app" and "Prod
compose deployment smoke" (the latter typechecks while building images). "Compose deployment smoke"
passes, so this is not an infrastructure failure.

```
Type '{ kind: "action_request"; text: {}; actionRequestId: string; toolName: string; }[]'
  is not assignable to type 'TranscriptRecord[]'
```

**Site:** `apps/web/src/chat/use-chat-stream.ts:151-155`, in the #1253 reload-rehydration block:

```ts
text: action.inputSummary.text || "Approve this action?",
```

`listPendingActionRequests()` returns `AiAssistantActionDto[]` (`apps/web/src/api/client.ts:1037`),
whose `inputSummary` is loosely typed — so `.text` is not a `string` and the `||` widens to `{}`.

**Fix:** narrow it, e.g.
`typeof action.inputSummary?.text === "string" && action.inputSummary.text ? action.inputSummary.text : "Approve this action?"`.
Confirm the `action_request` variant of `TranscriptRecord` needs no other required field — the error
is array-assignability, so a second missing field would surface the same way.

**Then:** `pnpm verify:foundation` via the **`verify-gate` skill** — never unscoped (it hits the live
dev DB), never piped (a pipe reads red as green). A green local gate still excludes CI's e2e step.

**Before merging, two things the PR body claims that nobody has checked:**

1. Test plan says only "`@jarv1s/chat` tests pass, `@jarv1s/ai` tests pass" — the full gate has never
   been green on this branch. The typecheck error proves it.
2. It closes five issues (#1415, #1414, #1253, #1250, #1135) with **no live-path proof recorded**.
   #1414 (`crossToolGateway` wiring, `packages/chat/src/routes.ts:265`) and #1253 (approval card
   surviving reload) are user-facing, so per the Live-Path Gate the honest status is
   *code-complete, unverified* until exercised through the real UI on a live dev instance. Memory
   note `crosstoolgateway-has-no-producer` is the background for #1414.

#1254 is deferred in-scope and stays open — it needs module-SDK `actionLabel` support.

**Suggested:** one Sonnet 5 build agent for the fix + gate; live-path proof needs a browser session.

---

## PR #1379 — "#1327 briefing action-row UI" · DRAFT · CI fully green · blocked on credentials

`build/1327-action-row-ui` · 72 files, +7,229/-873 · worktree at
`.claude/worktrees/1327-action-row-ui`.

**All CI passes** — foundation, both compose smokes, images. Unit 3,524 passed; Playwright 91
passed / 22 skipped; lint, format, typecheck, file-size green.

**It is a draft for exactly one reason,** stated honestly in its own body: the live-path proof was
never obtained. The agent's Firefox session hit the real sign-in gate, it had no credentials, and it
correctly refused to fabricate an account or guess rows. Blocker artifacts are under
`/tmp/webwright-1327-task7/final_runs/run_1/` (screenshot, video, log) — note `/tmp`, so they may
already be reaped.

**This is not a code defect.** The unblock is credentials, which exist: see memory
`dev-instance-lan-spinup-trusted-origins` — Ben's dev login is recorded there, along with the
trusted-origins trap you must clear before the browser can reach the instance.

**To close it:**

1. Bring up the dev instance (`dev-preview-recipe` for ports; **prod is off-limits**).
2. Sign in as Ben's dev user; confirm the account actually has briefing rows — an empty briefing
   proves nothing, and `dev-google-account-has-calendar-scope-only` is a live example of mistaking a
   scope gap for a dead worker.
3. Exercise the five states the PR claims: prose placement/truncation, action controls, reply
   confirmation, suppression, allowed resurfacing. Record the artifact on the PR.
4. Mark ready for review, then merge.

**Two risks worth pricing before starting.** It has been open since 2026-07-31 and its green CI run
is from **2026-08-05 22:08** — re-run CI against current `main` before trusting it; see
`long-branch-merge-hazards`. And at 72 files it is the single largest merge conflict surface for
Moss PR2, so it should land **first** of the two.

**Suggested:** Opus — this is live UAT judgement (does the surface actually behave), not mechanical
work. Read `uat-reload-poll-and-psql-seed-traps` and `agentation-overlay-steals-first-textarea`
first.

---

## Order

**#1379 first** (bigger conflict surface, and its work is verification not coding), then **#1437**,
then unblock Moss PR2 #1442. #1437's fix can proceed in parallel — it touches chat files that #1379
does not.

## Do not

- Do not `git add -A` / bare-`git commit` in `~/Jarv1s`; other sessions share it. Use the
  `shared-checkout` skill, or work in the existing per-branch worktrees above.
- Do not merge either on green CI alone. Both close user-facing issues; both need live-path proof.
- Do not run any DB-touching test command without the `verify-gate` skill.
