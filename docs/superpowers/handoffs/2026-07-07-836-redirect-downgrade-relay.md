# #836 Redirect Method Downgrade + Cache-Key Scoping — Relay Handoff

**Branch/worktree:** `832-datasets-host-pinning` at
`/home/ben/Jarv1s/.claude/worktrees/832-datasets-host-pinning` (already checked out, don't
re-clone). `node_modules` already installed — do NOT re-run `pnpm install`.

**Chain context:** issue 3 of 3 (#832 → #833 → #836), same worktree/branch. **#832 and #833 are
DONE and MERGED** (`ab79cdc7`, `a9fe44f8` — PR #848, PR #850). Both issues closed. Branch was
`git reset --hard origin/main` to `a9fe44f8` (squash-merge conflict on the plan doc during
rebase, same pattern as #832→#833 — verified via `git diff origin/main..HEAD --stat` on the
datasets/test/plan paths showed **no diff**, i.e. nothing unique was lost, before resetting).
This is the **last** issue in the chain — no further issue follows.

**Coordinator:** label `Coordinator` — **re-resolve fresh via `herdr pane list`, do not trust any
pane number from this doc or prior messages.** There has been churn this session (w1:p9G → w1:p9J
→ told to route to "w1:p9K" as the next live one) — treat all of those as stale; confirm exactly
one `Coordinator`-labeled pane is live before messaging. If 0 or >1 match, halt and wait.

**Spec:** `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md`.
**Issue:** #836 "datasets: 303 redirect method downgrade + cache-key user-scoping guard" (part of
#798, Fable adversarial-review follow-up, batched INFO). **Risk tier: routine** (coordinator's own
words this session: "routine, last in chain 832→833→836") — normal build, no special QA/sign-off
gate beyond the standard bar. Full issue body:

> Two small hardening items in `packages/datasets`:
>
> **1. 303 semantics in host-pinned fetch** (`host-pinning.ts`): redirect hops re-send the
> original `init` verbatim, so a 303 response re-sends the original method/body instead of
> downgrading to GET per spec. All current adapters are GET-only, so no live impact — fix before
> any POST-capable adapter exists.
> - Fix: on 303 (and 301/302 for non-GET), switch to GET and drop the body for subsequent hops.
>
> **2. Cache-key user-scoping guard** (`client.ts` `buildCacheKey`): keys are
> `sourceId:datasetKey:params` and the cache is instance-level. Correct for today's public
> datasets, but a future per-user dataset whose params omit user identity would serve one user's
> data to another.
> - Fix: document the constraint on `buildCacheKey` (per-user datasets MUST carry user scoping in
>   params), and add a spec note for the future authenticated-source slice; optionally an assert
>   seam when `credential` support lands.
>
> **Acceptance:**
> - Unit test: 303 hop issues GET with no body; same-method hops unchanged.
> - `buildCacheKey` carries the scoping constraint comment; the api-key slice spec (see #833)
>   references it.

## Done (this session, pre-relay)

- Confirmed #833 merged + branch clean/rebased at `a9fe44f8` (see chain context above).
- Verified both issue premises still true on this branch:
  - `packages/datasets/src/host-pinning.ts:109-142` (`createHostPinnedFetch`): `currentInit` is
    only ever mutated by `stripSensitiveHeaders` (#833); nothing switches method to GET or drops
    body on 303/non-GET redirects. `REDIRECT_STATUSES` already distinguishes 303 from 307/308 as a
    `Set` — no method-aware branching exists yet.
  - `packages/datasets/src/client.ts:44-54` (`buildCacheKey`): no doc comment exists today about
    user-scoping; confirmed by reading the function verbatim.
- Located the spec's relevant sections for the required spec note: Architecture §2 (host pinning,
  around `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md:95-102`) and §4
  (credentials deferred, lines ~115-124); Non-goals section ~141-145 also references §4. The spec
  note this issue asks for should land near §4 (natural home: cache-key user-scoping is a
  constraint on the same future authenticated-source slice §4 already defers).
- **Not yet done:** writing the plan doc, escalating to the coordinator for approval, or any code
  changes. No plan-approval message has been sent for #836 yet.

## Remaining — resume here

1. **Write the plan** via `superpowers:writing-plans` →
   `docs/superpowers/plans/2026-07-07-836-redirect-downgrade-cache-scoping.md`. Two small
   sub-tasks (can likely be one task, TDD-driven):
   - Task A (`host-pinning.ts` + its test file): on a 303 response, OR a 301/302 response where
     the current method is not GET/HEAD, force the next hop to GET with no body (drop `body`,
     keep headers modulo the existing #833 stripping logic — stripping and downgrade are
     independent concerns, both can apply to the same hop). 307/308 must NOT downgrade (spec
     requirement — preserve method+body always). Add unit tests: 303 hop issues GET with no body;
     a 307/308 hop preserves method+body; a same-method (GET) hop through 301/302 is unchanged.
   - Task B (`client.ts` only): add a doc comment directly above `buildCacheKey` stating the
     user-scoping constraint (per-user datasets MUST carry user identity in `params`, or the
     instance-level cache will serve one user's data to another) — no code/behavior change, no
     new test needed (issue only asks for the comment). Also add the spec note near Architecture
     §4 in `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md` recording this
     constraint for the future authenticated-source slice, and note in the PR body that both the
     future api-key credential spec **and** #833's own PR-body traceability note should be
     understood to cover this too (issue's acceptance bullet — traceability, not new code).
2. **Escalate for plan approval** to the coordinator (fresh-resolved label) via
   `herdr-pane-message`, caveman-mode, then **STOP and wait** — do not write code first.
3. **Build** via `superpowers:test-driven-development` once approved — task by task, commit green
   per task, `git add` explicit paths only.
4. **Pre-push trio + rebase:** `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
5. **Full gate** against the isolated DB (already created/migrated in this worktree):
   ```bash
   JARVIS_PGDATABASE=jarv1s_832_datasets pnpm verify:foundation
   JARVIS_PGDATABASE=jarv1s_832_datasets pnpm audit:release-hardening
   ```
   Redirect to a session-scoped scratchpad log path, not a shared `/tmp/*` name.
6. **`coordinated-wrap-up`:** push, open PR (title something like "datasets: 303 redirect method
   downgrade + cache-key user-scoping guard (#836 3/3)"), body notes it's the **last** issue in
   the chain (#832, #833 both merged), cites gate evidence. Report PR + evidence to the
   coordinator, then stop. Do not merge, touch the board, or close the issue — that's the
   coordinator's job, and it's the final issue so no further chain step follows.

## Conventions to keep following

- Caveman-mode terse messages to the coordinator.
- Re-resolve the coordinator pane via fresh `herdr pane list` before every message — never trust a
  pane number written in this doc or in a prior turn's message (this chain has already seen the
  coordinator relay at least twice: p9G → p9J → "p9K").
- `git add` by explicit path only, never `-A` or repo-wide `pnpm format`.
- Never touch `docs/coordination/`, the project board, milestones, or merge.
- **Squash-merge gotcha:** if the coordinator merges your PR while you're still idle, your
  rebase will conflict on the plan doc (squash produces new hashes for identical content). Check
  `git log origin/main --oneline` for your PR title; if present, `git diff origin/main..HEAD
  --stat` to confirm nothing unique is at risk, then `git reset --hard origin/main`.
- **DB gotcha for this worktree:** use `JARVIS_PGDATABASE=jarv1s_832_datasets` (already created +
  migrated) for any DB/gate commands — not the shared default DB.
