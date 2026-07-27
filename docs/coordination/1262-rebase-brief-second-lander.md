# Rebase brief — whichever of #1264 / #1265 lands SECOND

Hand this to the **owning lane agent** of the second PR, after the first has merged. Do not hand-
edit these files from the coordinator seat; the lane owns its feature and test code.

## Merge order (coordinator ruling, pending Ben's sign-off on both)

**#1264 / PR #1276 first, #1265 / PR #1273 second.** Reason: #1276 is fully verified — independent
QA green, coordinator-reviewed delta, local gate exit 0, all three required CI checks green at
`0648d0f1`. #1273's verdict was still pending when this order was set. Nothing about the *content*
forces this order; if #1273 clears first and #1276 is for any reason held, swap them and swap the
arithmetic below. The order is a readiness call, not a dependency.

**There is no security reason to jump #1265 ahead.** I checked rather than assumed: `compilePattern`
does not exist on `origin/main` (`73e50847`), and there is no `new RegExp` anywhere under
`packages/ai/src/gateway/` there. The fail-open that QA caught was introduced by #1265's own branch
and never shipped. No live exposure, no urgency.

## The four overlapping files

These are the only paths touched by both PRs. Expect a textual conflict in each; three are
keep-both, one is a real reconciliation.

| File | #1273 | #1276 | Resolution |
| --- | --- | --- | --- |
| `packages/ai/src/gateway/index.ts` | +1/-1 | +5/-0 | **Keep both exports.** Both PRs add to the same export block. `compilePattern` (from #1265) must survive — QA proved fail-closed *through that export*, so dropping it silently un-proves the fix. |
| `packages/module-registry/src/index.ts` | +2/-0 | +2/-1 | Keep both. Small; inspect the `-1` so #1276's deletion is not re-applied to a line #1273 already changed. |
| `tests/integration/mcp-gateway-self-operation.test.ts` | +194/-1 | +255/-0 | **Keep both blocks.** Both append large suites to one file. A conflict here is an append-point collision, not disagreement. Losing either side silently drops test coverage — count the test cases before and after. |
| `tests/unit/self-operation-manifests.test.ts` | +50/-5 | +8/-5 | **The real one — see below.** Both delete the same 5 lines (the old inventory assertion) and replace them. |

## The inventory assertion — the one that needs thought

Arithmetic: `origin/main` is **29 write / 5 confirm / 4 promotable**. #1265 adds 2 → 31/5/4.
#1264 adds 8 → 37/5/4. Both landed → **39 / 5 / 4, total 48**.

Rules:

- The second lander rewrites its assertion to **39/5/4** and must keep it an exact `toBe`. **Never a
  range, never a `toBeGreaterThan`.** The whole point of this test is that adding a write tool
  without declaring `selfOperationGrant` breaks the build; a range assertion re-opens that hole and
  is a blocking finding on its own.
- **Do not trust the number — run it.** 39 is my arithmetic from two PR descriptions, not an
  observation. Run the test and let it tell you the real count. If it reports anything other than
  39/5/4, **stop and report to the coordinator** rather than editing the expectation to match: a
  mismatch means either a tool was added or removed that nobody tracked, or one of the two PRs
  miscounted its own contribution. Changing the number to whatever makes it green is exactly the
  failure this test exists to catch.

## Hard bans during the rebase (unchanged)

Do not widen a family `defaultTier`, edit `allowedTiers`, change a grant, or loosen `policy.ts` to
resolve a conflict. Do not make a pattern optional or revert any fail-closed behaviour. Do not edit
applied migrations — `0175`/`0176`/`0177` are FROZEN. Commit by explicit path; never `git add -A`.
Run the full gate on a dropped-and-recreated isolated DB before pushing, and report the exit code
grepped directly, never piped through `tail`.

## After the rebase

The rebased result gets a **fresh QA pass scoped to the integration** — a clean PR can still break
against a newly-landed sibling, and these two share four files. That pass is diff-scoped to the
conflict resolution, not a re-review of the whole PR.
