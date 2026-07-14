# Plan Handoff — #987 Notes and People source pickers

**Spec (approved):** `docs/superpowers/specs/2026-07-12-notes-people-source-picker-hardening.md`
**Approval:** Fable verdict on PR #1008; both explicit questions approved
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-987-notes-people-build`
**Branch:** `ux/987-notes-people-build` rebased on green `origin/main` `96d22ba0`
**Planner:** Sol (`gpt-5.6-sol`) at high reasoning
**Builder after plan approval:** Terra (`gpt-5.4-mini`) at medium reasoning
**Supervising coordinator:** label `UX Coordinator`, session
`019f5dc2-8bd9-78b2-827f-67bd9a99e6c9`
**Final merge authority:** the same `UX Coordinator` session

## Dispatch

#986 is merged and its lock is released. Sol may inspect current code and write the implementation
plan only. Do not edit feature code. After coordinator approval, Sol exits and Terra builds from
the approved plan in this same worktree.

## Approved decisions and checks

- Keep manual person creation as a separate note-first `VaultContext` flow.
- Keep canonical People notes in the owner's `VaultContext`, separate from operator-mounted Notes.
- Requests/responses use relative paths only; reject traversal and symlink escape; prove one owner
  cannot observe another owner's directories.
- The refresh route is currently schema-less. If a response schema is added, declare all four
  counters—`discovered`, `projected`, `ignored`, `candidates`—and prove them with `app.inject` so
  fast-json-stringify cannot silently strip fields.
- Preserve `DataContextDb`, `VaultContext`, owner isolation, and metadata-only payload invariants.
- Do not edit `tests/uat/**`; route live-path harness needs through the peer `Coordinator`.
- Work only here; stage explicit paths. Never edit `docs/coordination/`, run repo-wide formatting,
  update tracking, or merge.
