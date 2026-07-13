# Build Handoff — #987 Notes and People source pickers

**Spec (approved):** `docs/superpowers/specs/2026-07-12-notes-people-source-picker-hardening.md`
**Approval:** Fable verdict on PR #1008; both explicit questions approved
**Risk tier:** `sensitive`
**Worktree:** `~/Jarv1s/.claude/worktrees/ux-987-notes-people-build`
**Branch:** `ux/987-notes-people-build` from green `origin/main` `3ca138eb`
**Build skill:** `~/Jarv1s/.claude/skills/coordinated-build/SKILL.md`
**Supervising coordinator:** label `UX Coordinator`, session
`019f5a2e-03fd-71c3-95ab-1934cb1de973`
**Final merge authority:** label `Coordinator`, session
`58a78927-385c-4b1d-8fa0-94db20255d6f`

## Dispatch hold

Do not start product work until `UX Coordinator` releases #986's
`settings-personal-data-panes.tsx` lock and explicitly dispatches this lane.

## Approved decisions and checks

- Keep manual person creation as a separate note-first `VaultContext` flow.
- Keep canonical People notes in the owner's `VaultContext`, separate from operator-mounted Notes.
- Requests/responses use relative paths only; reject traversal and symlink escape; prove one owner
  cannot observe another owner's directories.
- The refresh route is currently schema-less. If a response schema is added, declare all four
  counters—`discovered`, `projected`, `ignored`, `candidates`—and prove them with `app.inject` so
  fast-json-stringify cannot silently strip fields.
- Preserve `DataContextDb`, `VaultContext`, owner isolation, and metadata-only payload invariants.
- Work only here; stage explicit paths. Never edit `docs/coordination/`, run repo-wide formatting,
  update tracking, or merge.
