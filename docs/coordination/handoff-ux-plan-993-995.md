# Plan Handoff — #993 Host/account truth and #995 Connected accounts

**Issues:** #993 and #995
**Role:** Sol (`gpt-5.6-sol`) at high reasoning; planning only
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-plan-993-995`
**Branch:** `plan/ux-993-995`
**Coordinator:** label `UX Coordinator`, session
`019f5dc2-8bd9-78b2-827f-67bd9a99e6c9`
**Tier:** security

Read both GitHub issues, current host/account/connector UI and contracts, and relevant project
rules. Write one approved-ready spec and one implementation plan per issue under
`docs/superpowers/{specs,plans}/`. Plan the shared settings collision once, preserve auth and
owner boundaries, and keep #995 implementation explicitly behind #987. Include exact owned paths,
focused checks, adversarial security QA, and live-path proof. Do not write product code or tests.

Keep out of `tests/uat/**`; the peer Coordinator owns that tree. Stage explicit doc paths only,
never `git add -A`, never edit `docs/coordination/**` after this handoff, and do not merge. Push
the branch, open a draft PR, and notify label `UX Coordinator` with the PR and any security or
design decisions.
