# #993 Host Truth Collision and Security Map

## Role

One-shot Opus architecture critic. Read-only: do not edit, commit, push, or open a PR.

## Pointers

- Approved spec: `docs/superpowers/specs/2026-07-15-settings-host-account-truth.md`
- Scope for this pass: **Delivery Slice 1 — Host truth only**
- Project invariants: `CLAUDE.md`
- Existing design: `docs/superpowers/specs/2026-06-18-host-diagnostics-safe-ops.md`
- Existing Herdr plan: read only the architecture/global-constraints portion of
  `docs/superpowers/plans/2026-07-09-866-herdr-install-and-attach-hint.md`, not its task-by-task body.

## Task

1. Run `pnpm audit:preflight` and report the grounded commit. If dependencies are unavailable, run
   `scripts/check-tree-fresh.sh` directly and report its exit code.
2. Use codebase-memory graph tools first. Trace the shared multiplexer root-resolution callers,
   diagnostics route/provider, fixed installer, audit-event path, and Settings UI.
3. Return a compact verdict containing:
   - exact shared files/contracts likely to collide;
   - required implementation order and the smallest safe build boundary;
   - security/trust-boundary invariants for the fixed-command install endpoint;
   - tests and live-path proof that must exist;
   - any blocker or design decision not settled by the approved spec.
4. Do not propose or implement the account/email slice.

Send only the compact verdict to exact label `UX Coordinator`, immutable Codex session
`019f6479-18a8-7782-ab34-a2e1d9c59c82`, using the Herdr pane-message workflow.
