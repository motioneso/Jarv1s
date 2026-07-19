# Agentation — Addressed Changes for Review

**Live instance:** `http://localhost:5178/`  
**Companion decision backlog:** `~/Jarv1s/docs/coordination/2026-07-19-agentation-decisions-needed.md`

This is the user-visible review queue for Agentation feedback that has been implemented in dev.

## Ready for review

### Settings → Account & preferences

- Agentation originals: `mrs6nwxo-retj99`, `mrs6ounh-hcmg1m`, `mrs6p20v-ly0lth`, `mrs6pc4e-7vnnsy`, `mrs6pwcc-7fddqk`
- Synced aliases: `mrs74j10-mngq10`, `mrs74j12-1zsn4e`, `mrs74j16-c536hz`, `mrs74j17-2327sc`, `mrs74j18-d5d095`
- Status: implemented in dev and all ten original/alias comments resolved in Agentation.
- Changes: removed the always-Active badge while retaining the role badge; removed the redundant Role row; renamed Locale to Location; replaced four hard-coded time zones with all 445 runtime-supported IANA zones; disabled the unsupported Language & region selector.
- Integrated commit: `2d4a9ce3` on `coord/1179-pdf` (build-lane source `3414b6b9e4eb4b89baced2fedea4d985cdf86e2d`).
- Automated verification: focused Profile Vitest 3/3, `pnpm format:check`, `pnpm lint`, and `pnpm typecheck` all exited 0 in the isolated build lane.
- Live verification: `outputs/agentation-settings-profile-review/final_runs/run_7/` exited 0 against `http://localhost:5178/`; screenshots confirm the assembled UI and the run log records 445 time-zone options. The disposable verifier account and vault subtree were deleted after the proof.

## Confirmed and comments closed

None yet.

## Workflow

1. Implement and verify the requested change in the live dev instance.
2. Add the annotation ID, affected page, change summary, and verification evidence under **Ready for review**.
3. Resolve the original Agentation comment and any synced duplicate so completion is visible in the browser.
4. After user confirmation, move the entry to **Confirmed and comments closed**.

Creating or linking a GitHub issue does not count as addressing the annotation; unimplemented comments remain open.
