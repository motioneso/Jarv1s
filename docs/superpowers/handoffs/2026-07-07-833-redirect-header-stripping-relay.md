# #833 Redirect Header Stripping — Relay Handoff

**Branch/worktree:** `832-datasets-host-pinning` at
`/home/ben/Jarv1s/.claude/worktrees/832-datasets-host-pinning` (already checked out, don't
re-clone). `node_modules` already installed — do NOT re-run `pnpm install`. Pane label
`datasets-chain-3` (re-resolve fresh via `herdr pane list` — never trust a pane number written
anywhere, including this doc).

**Coordinator:** Herdr pane label `Coordinator` (resolve fresh via `herdr pane list` — exactly one
pane must match; if 0 or >1, halt, don't guess).

**Chain context:** issue 2 of 3 (#832 → #833 → #836), same worktree. **#832 is DONE and MERGED**
— PR #848 squash-merged to main as `ab79cdc7` ("datasets: distinct host-pinning violation logging
(#832 1/3) (#848)"). Issue #832 closed. Branch was `git reset --hard origin/main` to sync onto
that tip cleanly (the branch's only unique commits were the now-squashed #832 code plus two
session-local handoff docs — no work was lost, verified via `git diff origin/main..HEAD --stat`
before resetting). **Do not start #836** until this issue (#833) merges and the branch is
rebased.

**Spec:** `docs/superpowers/specs/2026-07-04-module-dataset-connector-sdk.md` (whole chain).
**Issue:** #833 "datasets: constrain header forwarding across host-pinned redirect hops" (part of
#798). Full issue body:

> `createHostPinnedFetch` re-sends the original `init` — headers included — on every redirect
> hop. Harmless today (every hop is allowlisted and no credentials exist in this slice), but the
> moment the reserved `credential: "api-key"` support lands, an auth header set for host A would
> be silently forwarded to allowlisted host B on a redirect.
>
> **Fix (blocker for the api-key slice, not urgent now):** strip or re-derive sensitive headers
> (at minimum `authorization`, any api-key header the future slice defines) when a redirect
> changes hostname; keep them on same-host hops.
>
> **Acceptance:**
> - Cross-host redirect drops sensitive headers; same-host redirect keeps them.
> - Unit test with a stub fetch asserting header sets per hop.
> - The future api-key spec must reference this issue as a prerequisite.

**Risk tier: sensitive** (NOT `security` — coordinator corrected this 2026-07-07: `sensitive`
means cross-model/invariant QA + a per-merge digest to Ben, but **no pre-merge Ben sign-off
gate** — that's `security`-tier only, e.g. auth/RLS/secrets. Coordinator auto-merges once QA is
green, same flow as #832, then digests it to Ben). Build defensively regardless — it's still a
guard-path change.

## Done

- Verified the issue's premise is still true on this branch: `host-pinning.ts:101,109` re-sends
  `{ ...init, redirect: "manual" }` unchanged on every hop, no hostname check on `init`.
- Plan written and self-reviewed against the spec/issue:
  `docs/superpowers/plans/2026-07-07-833-redirect-header-stripping.md`. **NOT yet committed** — it
  lands together with Task 1's implementation commit, matching #832's precedent (`c2c1aa5f`
  bundled the plan doc + Task 1 code in one commit).
- Sent plan-approval request to the coordinator via `herdr-pane-message`. **APPROVED** (received
  2026-07-07, same message that triggered this relay): "Plan approved as written — single task,
  correctly scoped to host-pinning.ts + its test file, stays inside spec Architecture §2/§4, no
  fork... Proceed to build." Coordinator also corrected the risk tier (see above) and confirmed
  it will spawn-confirm + reap this session's predecessor once the successor checks in — **no
  action needed on that**, just proceed to build.

## Remaining — resume here

1. **Plan is approved — go straight to Task 1, no need to re-check for approval.**
2. Execute Task 1 from the plan doc via `superpowers:test-driven-development`
   — write the 4 failing tests, verify red, implement `SENSITIVE_REDIRECT_HEADER_NAMES` +
   `stripSensitiveHeaders` + the `currentInit` tracking in `createHostPinnedFetch`
   (`packages/datasets/src/host-pinning.ts`), verify green, single commit (message: "datasets:
   strip sensitive headers on cross-host redirect hops (#833)"). `git add` the plan doc too in
   this same commit if not already committed.
3. **Pre-push trio + rebase:** `pnpm format:check && pnpm lint && pnpm typecheck`, then
   `git fetch origin main && git rebase origin/main`.
4. **Full gate** against the isolated DB (already created/migrated in this worktree — do NOT use
   the shared default `jarv1s` DB, per Fleet-Ops convention, other concurrent agents may be
   mutating it):
   ```bash
   JARVIS_PGDATABASE=jarv1s_832_datasets pnpm verify:foundation
   ```
   (Redirect to a **session-scoped** log path, not a generic `/tmp/*.log` name — a concurrent
   agent in another worktree stomped a shared `/tmp/cb-vf.log` path during the #832 wrap-up; use
   something under this session's scratchpad dir instead, or just let output go to the terminal.)
5. **`coordinated-wrap-up`:** push, open PR (title something like "datasets: constrain header
   forwarding across host-pinned redirect hops (#833 2/3)"), body notes it's 2/3 of the chain
   (#832 merged, #836 to follow), cites gate evidence, notes the future api-key spec must
   reference #833 as a satisfied prerequisite. Report PR + evidence to the coordinator via
   `herdr-pane-message`, then stop. Do not merge, touch the board, or close the issue.
6. **After coordinator confirms #833 merged:** `git fetch origin && git rebase origin/main` (or
   reset if squash-merge conflicts recur, same as #832 — verify via `git diff origin/main..HEAD
   --stat` before resetting that nothing unique/unmerged is lost), then start #836 (new
   `coordinated-build` plan cycle — this plan doc only covers #833).

## Conventions to keep following

- Caveman-mode terse messages to the Coordinator (`herdr-pane-message` skill).
- Re-resolve the Coordinator pane via fresh `herdr pane list` before every message — never trust a
  pane number written in a doc.
- `git add` by explicit path only, never `-A` or repo-wide `pnpm format`.
- Never touch `docs/coordination/`, the project board, milestones, or merge.
- **Squash-merge gotcha (seen twice now, #832 → #833):** when the coordinator merges your PR while
  you're still verifying/idle, your local branch's rebase onto `origin/main` will conflict (squash
  merge produces new commit hashes/formatting even for identical content). Don't fight the
  rebase — check `git log origin/main --oneline` for your own PR title first; if it's there,
  `git diff origin/main..HEAD --stat` to confirm nothing unique is at risk, then
  `git reset --hard origin/main` to resync cleanly.
- **DB gotcha for this worktree specifically:** use `JARVIS_PGDATABASE=jarv1s_832_datasets`
  (already created + migrated) for any DB/gate commands — not the shared default DB.
