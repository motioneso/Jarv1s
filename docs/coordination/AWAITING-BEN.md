# Awaiting Ben

Decisions that need Ben and only Ben. Each entry says what is blocked and what the options are.
Remove an entry once he rules and the ruling is recorded where the work lives.

## 2026-07-27 — two items rescued from the pre-reset working tree

Found while triaging `~/jarvis-uncommitted-rescue-2026-07-26/`. Both were uncommitted edits an agent
made on 2026-07-26 that were never reviewed, so neither was applied. Full triage context:
`docs/audits/2026-07-27-repo-reset-loss-forensics.md`.

### 1. A "live-path gate" for the coordinate skill

A +66/−26 edit to `.claude/skills/coordinate/SKILL.md` adds a hard rule: a PR touching a user-facing
feature, module, or UI surface may **not** merge on CI-green plus code review alone — it needs a live
end-to-end proof recorded on the PR (installed and exercised through the real UI on a live dev
instance, evidenced by a `gh pr comment` with the UAT run and screenshots). No artifact means the
issue cannot be marked Done; correct status is *code-complete, unverified*. Its stated justification
is job-search #930–938: nine slices closed green without once being run through the real UI, while the
install path #999 was broken the whole time.

**Why it is parked:** this is a process change that would slow every UI merge, and it overlaps the
existing e2e-dev-UAT rule already in `CLAUDE.md`. Worth adopting, tightening, or dropping — but not
worth an agent quietly slipping into a skill file.

**Options:** (a) adopt as written; (b) adopt the requirement but drop the screenshot artifact; (c) rely
on the existing e2e-dev-UAT rule and drop this.

### 2. Was the voice/STT settings spec approved?

The same working tree flipped `docs/superpowers/specs/2026-07-08-voice-stt-settings.md` from
`DRAFT v2 — Awaiting owner approval` to `Approved — RFA after Fable 5 adversarial review fixes and Ben
approval (2026-07-08)`. On `main` it still reads DRAFT v2.

**Why it is parked:** that edit asserts Ben approved it. Nothing else records that, and flipping an
approval status on his behalf is exactly what the spec-before-build gate exists to prevent.

**Options:** (a) he approved it on 2026-07-08 and the status flip is correct; (b) he did not, and it
stays DRAFT pending review.
