# Build Handoff — #991 QA cycle 3

**PR:** #1050
**Spec:** `docs/superpowers/specs/2026-07-13-991-assistant-priorities-dogfood-hardening.md`
**Plan:** `docs/superpowers/plans/2026-07-13-991-assistant-priorities-dogfood-hardening.md`
**Risk tier:** sensitive
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-991-assistant-priorities-build`
**Branch:** `ux/991-assistant-priorities-build`
**Starting head:** `da66a101a46e8d9349b7277ec5778eb3ecf57b29`
**Coordinator:** exact label `UX Coordinator`, immutable session
`019f66e1-aefb-7df2-b339-c4168d3266c1`

Ben explicitly authorized this third repair cycle after the two-cycle QA failure-budget stop.

## Start

1. Confirm dependencies, read `CLAUDE.md`, invoke `coordinated-build`, and read the latest QA
   verdict at PR comment `issuecomment-4984705427`.
2. Verify both remaining code/test root causes against the approved spec/plan before editing:
   - YOLO copy must not report enabled when the user's effective preference is off.
   - Required interactive Priority UI contracts must exercise real UI behavior, not only helper
     or source-shape assertions.
3. Send a compact repair plan to the exact coordinator session and wait for approval.
4. After approval, implement the minimum shared-root fix and focused interactive contracts. Run
   focused checks plus the full local gate, commit, rebase on `origin/main`, and push.
5. Live desktop/narrow proof waits for fresh exact-head CI and independent sensitive QA.

## Bans

- Do not edit `docs/coordination/` or UAT fixtures; the coordinator removes this handoff later.
- Stage explicit paths only; never broad-add or repo-wide format.
- No merge, board mutation, stale evidence, or non-exact image.
