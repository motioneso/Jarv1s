# Build Handoff — Agentation Settings Profile Polish

**Approved input:** direct user authorization plus Agentation annotations `mrs6nwxo-retj99`, `mrs6ounh-hcmg1m`, `mrs6p20v-ly0lth`, `mrs6pc4e-7vnnsy`, and `mrs6pwcc-7fddqk`  
**GitHub issue:** none; live feedback batch  
**Risk tier:** `routine`  
**Live-path classification:** required; coordinator integrates into the running `5178` dev branch for visual verification  
**Base:** `origin/coord/1179-pdf`  
**Worktree:** `~/Jarv1s/.claude/worktrees/agentation-settings-profile`  
**Branch:** `feedback/settings-profile-polish`  
**Build skill path:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`  
**Coordinator label:** `Coordinator`  
**Coordinator session id:** `019f7bd3-52fc-75b2-b10e-d156781df5ac`

## Scope

Implement only these clear Profile settings requests:

- `mrs6nwxo-retj99`: hide the always-Active badge for the signed-in user; retain Owner.
- `mrs6ounh-hcmg1m`: remove the redundant Role row.
- `mrs6p20v-ly0lth`: rename Locale to Location.
- `mrs6pc4e-7vnnsy`: make all supported IANA time zones available.
- `mrs6pwcc-7fddqk`: hide or disable unsupported language/region controls until the feature exists.

Synced aliases to preserve for later comment closure: `mrs74j10-mngq10`, `mrs74j12-1zsn4e`, `mrs74j16-c536hz`, `mrs74j17-2327sc`, `mrs74j18-d5d095`.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Invoke `coordinated-build`; inspect the actual Profile settings flow and existing tests.
3. Send a compact plan to the unique `Coordinator` pane and wait for approval before editing.
4. Implement the smallest root-cause changes and one focused runnable check per non-trivial behavior.
5. Run only focused tests/typecheck/format checks for touched files.
6. Commit and push the branch, then report commit SHA, touched files, exact checks, and any live-verification caveat to `Coordinator`.

This is a direct live-feedback lane: do not open or merge a PR. The coordinator will integrate the commit into `coord/1179-pdf`, verify it on `5178`, update the addressed-for-review ledger, and close verified Agentation comments.

## Run-specific bans

- Work only in this worktree/branch; stage explicit paths only.
- Never touch `docs/coordination/`, project boards, milestones, PR #1180, or issue #1179.
- Do not expand into other Agentation notes or redesign surrounding Settings UI.
- Do not run repo-wide formatting or broad `git add`.
- No secrets in docs, logs, commits, or prompts.

## Collision notes

- The live dev branch contains ongoing onboarding/provider-login fixes. Preserve those paths and avoid unrelated cleanup.
- No other feedback agent may touch the Profile settings files until this batch is integrated.
