# #1311 install-grant — relay 11

Worktree: `/home/ben/Jarv1s/.claude/worktrees/1311-install-grant`, branch `1311-install-grant`.
`node_modules` already present — do NOT `pnpm install`.

Coordinator's Herdr label is literally `Coordinator`. **Resolve it fresh via `herdr pane list`
before every escalation — never cache a pane id.** Identify yourself to it by your OWN session id,
never a pane number.

Resume via the `coordinated-build` skill. Do NOT re-read the plan doc
(`docs/superpowers/plans/2026-07-27-1311-install-grant-default-enabled.md`) front-to-back — read it
by section only for what you need.

## State as of this handoff

HEAD is `177c8754` ("docs(uat): #1311 satisfy Coordinator's two fixme conditions"). Working tree
clean except `.claude/context-meter.log` (telemetry noise — stash it with
`git stash push -- .claude/context-meter.log` before any rebase, pop after).

Task 4 (UAT spec + both fixme conditions) is DONE and committed. Task 5 (PR) is NOT started —
the Coordinator explicitly said "do not start Task 5" until the items below are resolved.

## 1. COLLISION — resolve this first, before anything else

PR #1276 (issue #1264 + #1310) merged to `main` as `7c820342`. It touched
`packages/chat/src/routes.ts` — the exact file this lane's `a8696992` extracted
`route-serializers.ts` out of. It may also touch `packages/chat/src/gateway-notifier.ts` and
`packages/chat/src/live/types.ts` (#1276 added an `affectsQueryKeys` field to `TranscriptRecord`
and spread it in `toTranscriptRecord`).

Rebasing onto `origin/main` WILL conflict in `routes.ts`, and possibly the other two files.

- **You own resolving this conflict.** The Coordinator does not hand-edit feature code.
- **Keep BOTH sides**: their `affectsQueryKeys` plumbing on `TranscriptRecord`/`toTranscriptRecord`,
  AND this lane's `route-serializers.ts` extraction (the serializer functions moved out of
  `routes.ts`, all importers updated, no behavior/signature change).
- After resolving, **re-check the 1000-line file-size gate on `routes.ts`**
  (`pnpm check:file-size` or read the script at `scripts/check-file-size.ts`). #1276's additions
  land on top of this lane's extraction and can push it back over 1000 lines even though the
  extraction fixed it before.
  - If it's red again: **extend the same move-only extraction pattern** (move more
    serializer/helper functions into `route-serializers.ts`, update importers, no behavior change).
  - Do **NOT** invent a second extraction pattern.
  - Do **NOT** add a re-export shim.

## 2. Gate ruling — the pre-rebase run does NOT count

A full `verify:foundation` run completed pre-rebase with `### FINAL rc=0` (443/443 unit test files,
3387 passed/2 skipped; 11/11 uat-seed files, 23/23 passed; 160/160 integration files, 1731
passed/2 skipped). **The Coordinator has ruled this does not count as the merge gate** — it predates
the rebase in item 1. Report it to the Coordinator for the record only.

After resolving the collision (item 1) and passing the pre-push trio, you must run
`verify:foundation` **again**, on a **freshly DROP/CREATEd isolated gate DB**
(`jarvis_gate_1311installgrant`), with `JARVIS_PGDATABASE` **exported, not inline**. Launch it
durably:

```bash
docker exec jarv1s-postgres psql -U postgres -c 'DROP DATABASE IF EXISTS jarvis_gate_1311installgrant;'
docker exec jarv1s-postgres psql -U postgres -c 'CREATE DATABASE jarvis_gate_1311installgrant;'
export JARVIS_PGDATABASE=jarvis_gate_1311installgrant
nohup bash -c 'pnpm verify:foundation; echo "### FINAL rc=$?"' > /tmp/.../verify-foundation-1311-postrebase.log 2>&1 &
disown
```

**Never pipe the gate through `tail`/`head`** — grep the log for the literal `### FINAL rc=` marker
when checking. Report the literal exit code to the Coordinator. Only this post-rebase run is the
merge gate.

## 3. Task 4 fixme conditions — already satisfied in code (committed at `177c8754`)

Documenting verbatim since they were only in chat before this handoff:

> CONDITION 1 — every `test.fixme` in `tests/uat/specs/1311-install-grant.uat.spec.ts` must carry
> an inline comment that (a) names issue #1121 as the cause and (b) names the specific existing
> test file+path that DOES prove the deferred behaviour. Same shape as the precedent:
> `tests/uat/specs/runtime-context.uat.spec.ts:110,121` and
> `tests/uat/specs/1133-chat-attachments.uat.spec.ts:154`. A bare `test.fixme` with no pointer is
> not acceptable — it reads as untested rather than proven-elsewhere.
>
> CONDITION 2 — at least one half of that spec must ACTUALLY RUN live, not be fixmed. The
> install-grant assertions that do not require a real model reply have no #1121 dependency and
> must execute against a real dev instance. Paste the real Playwright output for that run into the
> PR body. If every test in the spec ends up fixmed, the live-path gate is NOT satisfied and the PR
> does not merge — do not let a fully-fixmed spec stand in for live proof.

Both are done: the fixme's comment is self-contained (cites #1121 and
`tests/integration/mcp-gateway-self-operation.test.ts` "first use after install grant runs without
an action card"); the non-fixme test ran live against a real Docker dev instance —
`1 passed (4.7s)`, `1 skipped` for the fixme. Real Playwright output is already captured in the
scratchpad PR-body draft (item 4 below). No further action needed on this item unless the rebase
touches this spec file (it shouldn't — it's not in the collision list).

## 4. Task 5 — PR description (do this after items 1-2 are clean)

A full draft already exists (written by the predecessor, not committed anywhere — scratchpad paths
are per-session so it will NOT be visible to you). Recreate it at
`docs/superpowers/handoffs/pr-body-1311-draft.md`(or your own scratchpad) with these sections; the
content is reproduced in full below so nothing is lost.

<details>
<summary>Full PR body draft (fill in the Gate section's rc from your POST-REBASE run)</summary>

```markdown
## Summary

Fixes #1311: `granted_at_install` action-permission families never got their install-time trust
grant applied unless a module traversed an explicit enable PATCH. `defaultEnabled`/`required`
modules (which never traverse that PATCH) were stuck asking for confirmation on every dispatch of
a tool that was supposed to be auto-trusted from install. User-visible effect: install-time-trusted
actions (e.g. tasks self-management) kept showing an Approve/Reject confirmation card instead of
running silently, as if they'd never been granted.

**Correction to the original handoff:** the initial write-up said tasks "appears to work" and was
unaffected. That was wrong — tasks has the identical bug in its own code path
(`TasksCompatibilityHelper.getResolvedTaskChangesPolicy`), just not caught until this lane's
investigation. This PR fixes both the generic chat choke point and the tasks-specific path.

## What changed

- **`packages/ai/src/gateway/self-operation.ts`** — new exported `selfHealGrantedAtInstallTier`
  primitive: on a missing action-policy row, re-derives whether the family is
  `granted_at_install`, grants it via the existing absence-safe `grantSelfOperationForModule`
  (`insertActionPolicyIfAbsent`, never `setActionPolicy`), then **re-reads storage** and returns
  the stored tier — never asserts the outcome. Returns `null` (fail closed) on any throw or if the
  family isn't `granted_at_install`.
- **`packages/chat/src/routes.ts`** — wires the above into `getFamilyTier`'s choke point so any
  `defaultEnabled`/`required` module's `granted_at_install` tool self-heals its grant on first
  dispatch, no explicit enable action required.
- **`packages/tasks/src/action-policy.ts`** — the tasks-specific bug: `getResolvedTaskChangesPolicy`'s
  both-keys-absent branch now calls the existing `grantInstallTimeTrustIfUnset` (unchanged — it
  uniquely guards the legacy `tasks.agency_auto_execute` preference key that the generic primitive
  doesn't know about) and **re-reads** the stored value rather than asserting `"trusted_auto"`.
  This re-read discipline matters: `grantInstallTimeTrustIfUnset`'s insert is insert-if-absent and
  succeeds silently even when a row already exists — including one the user explicitly set to
  `always_confirm` via the legacy key. Asserting the outcome instead of re-reading would have been
  a fail-open under that race.
- Two related boot-invariant hardenings surfaced during this work (see Security findings below).
- `packages/chat/src/route-serializers.ts` — mechanical, non-functional extraction from
  `routes.ts` (move-only, no behavior/signature change, every importer updated) to bring the file
  back under the repo's 1000-line file-size gate after earlier #1311 commits pushed it to 1007
  lines. Committed separately from behavior work; verified with a fresh full `verify:foundation`
  run, which is what caught the overage in the first place.
  **[Successor: note here if you extended this extraction further to absorb PR #1276's additions.]**

## Why two paths, not one collapsed path

`getFamilyTier` (chat's generic choke point) and `getResolvedTaskChangesPolicy` (tasks' own
compatibility layer) both decide the same kind of question — "has this family's install-time
trust been granted?" — but tasks has a legacy preference key (`tasks.agency_auto_execute`) that
predates the generic action-policy table and must keep being checked. Collapsing tasks onto the
generic path would silently stop honoring that legacy key for existing installs. The tasks compat
helper stays load-bearing; the fix mirrors the generic path's *behavior* (self-heal + re-read) in
tasks' own code, rather than replacing tasks' code with a call into the generic primitive.

## Over-grant-by-design (not a bug)

`grantSelfOperationForModule` grants **every** `granted_at_install` family declared in a module's
manifest, not just the one family whose tool was dispatched. This is correct by design: an
install-time grant is a property of the *install*, not of any single tool call, and the underlying
primitive is insert-if-absent so it can never clobber a family the user already set explicitly. A
reviewer scanning the diff without this note could misread it as an over-broad grant; it isn't.

## Security findings surfaced during this work

Both are boot-time invariant hardenings, not behavior changes to any live grant/policy:

1. **Finding #1** (`3aaff890`) — `assertBuiltInSelfOperationManifests` didn't forbid a
   `granted_at_install` family from declaring `defaultTier: "trusted_auto"` directly in its
   manifest (which would bypass the self-heal path's `insertActionPolicyIfAbsent`-only guarantee
   via the `?? manifest.defaultTier` fallback). Added the guard + boot-time assertion.
2. **Finding #2** (`63af893c`) — tasks/`task_changes` was falling through to the *generic*
   self-heal path in `getFamilyTier` before Task 3 fixed the tasks-specific path properly; fixed
   so tasks' family is never handled generically.
3. **Coordinator's residual question** (`54d02e03`) — could the same `null → defaultTier`
   fallback fail open for a `user_promotable` family whose `defaultTier` happens to be
   `trusted_auto`? Yes, a real structural gap (finding #1's assert only covered
   `granted_at_install`). Widened the same assert to cover `user_promotable`. `confirm_always` is
   separately safe by construction: its promotability check already forces `trusted_auto` out of
   `allowedTiers`, and `defaultTier` must be one of `allowedTiers` — it can never be
   `trusted_auto` either, no code change needed there. No built-in manifest hit this gap live
   today (verified: tasks/calendar families all default to `ask_each_time`/`always_confirm`) — this
   closes a structural hole, not a live bug.

## Coordinator's six binding conditions → enforcement

| # | Condition | Enforced by |
|---|---|---|
| 1 | Self-heal MUST call `insertActionPolicyIfAbsent`, never `setActionPolicy` | Structural: Path A reuses `grantSelfOperationForModule` (absent-safe only); Path B reuses `grantInstallTimeTrustIfUnset` (same primitive) |
| 2 | Fail closed on insert throw | `tests/unit/self-heal-granted-at-install.test.ts` test 3; tasks path try/catch |
| 3 | Tier comes from manifest declaration only, never tool input/caller | Structural: both primitives hardcode `"trusted_auto"` |
| 4 | Heal ONLY `granted_at_install` families, never `user_promotable`/`confirm_always` | `tests/unit/self-heal-granted-at-install.test.ts` test 2 |
| 5 | Revocation-survival test required | `tests/integration/chat-action-policy-self-heal.test.ts` test 2; `tests/integration/tasks-action-policy-self-heal.test.ts` test 2 |
| 6 | Keep exit criterion 4 as a real test, not just structural reasoning | `tests/integration/chat-action-policy-self-heal.test.ts` test 3 |

`confirm_always` negative control: proven via DB evidence (a `confirm_always` family with no
prior row still returns `null`, never healed) — no screenshot needed, this is a storage-layer
assertion, not a UI state.

## Live-path proof

Per the Coordinator's two conditions on this PR's UAT spec (`tests/uat/specs/1311-install-grant.uat.spec.ts`):

**Condition 1** — every `test.fixme` in that file now carries an inline comment naming #1121 as
the blocking cause and naming the specific existing test (file + test name) that proves the
deferred behavior for real, matching the precedent shape in `runtime-context.uat.spec.ts` and
`1133-chat-attachments.uat.spec.ts`.

**Condition 2** — the half of the spec that doesn't need a real chat model **actually runs live**,
not fixmed: `tasks agency-auto-execute self-heals to enabled on first read, no prior enable
action` — a real, cookie-authed `fetch("/api/tasks/agency-auto-execute")` against a real dev
instance and a real seeded owner with no prior `task_changes` row. Real Playwright output pasted
below (also posted as a separate `gh pr comment`).

The other half — a real chat turn dispatching a `granted_at_install` tasks tool and observing no
confirmation card — needs a real, instruction-following chat model, which no UAT seed level
provisions (tracked in #1121). That mechanism is proven for real without a model at the
integration layer: `tests/integration/mcp-gateway-self-operation.test.ts` ("first use after
install grant runs without an action card") drives the real `AssistantToolGateway.callTool`
dispatch path through the same `resolvePolicy` choke point (`packages/ai/src/gateway/policy.ts`)
a live chat dispatch would hit.

Added rows to `.claude/skills/coordinate/uat-trigger-map.tsv` for
`packages/chat/src/routes.ts`, `packages/ai/src/gateway/self-operation.ts`, and
`packages/tasks/src/action-policy.ts` pointing at this spec, so the next lane touching this
surface gets the trigger automatically.

\`\`\`
Running 2 tests using 1 worker

  ✓  1 [chromium] › tests/uat/specs/1311-install-grant.uat.spec.ts:71:1 › tasks agency-auto-execute self-heals to enabled on first read, no prior enable action (927ms)
  -  2 [chromium] › tests/uat/specs/1311-install-grant.uat.spec.ts:94:6 › chat dispatches a task_changes tool with no confirmation card (#1121)

  1 skipped
  1 passed (4.7s)
\`\`\`

Real dev instance (Docker-provisioned, seed level `solo-admin`), real cookie-authed login, real
`fetch("/api/tasks/agency-auto-execute")` against the seeded owner with no prior `task_changes`
row — not a mock. Test 2 is the `#1121`-blocked fixme, correctly reported as skipped, not passed.

## Gate

Fresh isolated gate DB (`jarvis_gate_1311installgrant`, dropped/recreated), full
`pnpm verify:foundation`, run AFTER the post-#1276 rebase:

\`\`\`
<!-- literal ### FINAL rc= line from your POST-REBASE run goes here — the pre-rebase rc=0 run does NOT count -->
\`\`\`

## What's user-visible

Install-time-trusted actions on always-enabled/required modules (e.g. tasks self-management) now
run silently on first use, as originally intended, instead of incorrectly prompting for
confirmation every time.
```

</details>

## Remaining order

1. Resolve the `routes.ts` (+ maybe `gateway-notifier.ts`/`live/types.ts`) rebase conflict against
   `origin/main` (item 1). Keep both sides.
2. Re-check/fix the file-size gate on `routes.ts` post-rebase (extend same extraction pattern if
   needed).
3. Pre-push trio: `pnpm format:check && pnpm lint && pnpm typecheck`.
4. Fresh isolated post-rebase gate DB `verify:foundation` run (item 2) — report the literal exit
   code to the Coordinator. This is the actual merge gate.
5. Finish the Task 5 PR description (item 4), fill in the real post-rebase gate rc.
6. `coordinated-wrap-up` — push, open PR, post live-path proof as a PR comment, report to the
   Coordinator. Never merge, never touch the board/milestones.

## Reminders

- Coordinator's Herdr label: `Coordinator`. Resolve fresh via `herdr pane list` every time.
- Identify yourself by your own session id, never a pane number.
- `.claude/context-meter.log` always shows modified — stash/pop around rebase, don't commit it as
  part of feature work.
- Stage explicit paths only, never `git add -A` (shared tree discipline).
