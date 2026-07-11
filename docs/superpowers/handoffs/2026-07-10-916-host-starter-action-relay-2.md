# Relay #2 — #916 host-starter-action (build agent)

**Trigger:** context-meter 70% warning, second occurrence. Zero code, zero plan file across both
relays — pure research/verification phase. Coordinator already notified via herdr-pane-message.

**Worktree/branch:** this worktree, `feat/916-host-starter-action` (off `origin/main` @ `2f4a0fe3`).
**Handoff doc (untracked, DO NOT commit):** `docs/coordination/2026-07-10-916-host-starter-action-handoff.md`
**Spec:** `docs/superpowers/specs/2026-07-10-job-search-module-host-starter-action.md`
**Coordinator:** label `Coordinator`, session id `58a78927-385c-4b1d-8fa0-94db20255d6f` — re-resolve
pane fresh via `herdr pane list`, never reuse a cached pane number.

## Status — READ THIS FIRST

**Re-read `docs/superpowers/handoffs/2026-07-10-916-host-starter-action-relay.md` (relay #1) —
it is still fully valid and has the complete worked-out architecture. This doc only adds what
relay #1 didn't cover.** Do not re-derive architecture from scratch.

**Next action: one quick file read, then straight to `superpowers:writing-plans`. No more open-ended
research.** Zero files edited so far in this build across two relays.

## One thing to check before planning (fast, don't spiral)

Read `tests/integration/module-web-assets.test.ts` — confirm whether disabled/inactive/hash-drifted
module denial for `GET /api/modules/:moduleId/web/*` is already proven at the integration level.
If yes, the plan's item (g)/(e) can just assert "unchanged, no new test needed" for that slice
instead of building new coverage. This was queued as the very next action twice now — do it once,
then move on regardless of what you find (it's a scope-narrowing check, not a blocker).

## New findings this pass (beyond relay #1)

1. **No e2e fixture exists for external module web bundles.** `tests/e2e/external-modules.spec.ts`
   only covers the admin Settings → Instance modules enable/disable toggle (via
   `/api/admin/external-modules`). `tests/e2e/mock-modules.ts` has no `external:true` + `web` fixture
   entry and no `page.route` serving a fake bundle. Building real e2e coverage of button-click →
   draft-opens → no-auto-submit → focus-transfer needs new fixture infra from scratch.
   **Recommendation for the plan:** keep e2e scope narrow/deferred; prove the behavior with unit
   tests on the pure validation/id-binding logic instead. Don't build new e2e fixture infra for
   this narrow host-action seam unless the coordinator pushes back.

2. **Confirmed test convention for "never auto-sends" proofs.** Project has NO jsdom/RTL —
   `tests/unit/*.test.ts(x)` use `renderToString` (react-dom/server) for markup assertions. For
   behavioral "never calls X" proofs, the actual precedent (`tests/unit/chat-composer-voice.test.tsx`,
   describe block "Composer source guard: voice input never auto-sends (#738)") reads the component
   source with `readFileSync`, slices the code between two function-boundary markers, and asserts
   the slice does NOT contain a banned call (e.g. `expect(voiceInputHandlers).not.toContain("props.onSend")`).
   **Use this exact pattern** to prove `openAssistant`'s implementation never calls `sendChatTurn`/
   `openChatWith` — source-slice + `not.toContain`, not interaction simulation.

## Everything else — unchanged from relay #1

All 5 architecture points, the validation/capping precedent (`page-context.ts` truncate + MAX_*
constants), the fail-closed-already-done note (`external-module-web-route.ts` 404s), and the (a)–(g)
"plan must cover" checklist are still accurate. Re-read relay #1 for the full detail rather than
duplicating it here.

## Spec status discrepancy (flagged, not resolved, not blocking)

The spec file's own Status line reads "Draft — Fable-approved scope; pending Ben's final sign-off"
and its Build gate section says "no build begins until Ben gives final spec sign-off." This
conflicts with the coordinator's handoff doc, which asserts the spec is fully approved/build-ready
(Fable 5 overnight panel sign-off vs `2f4a0fe3`). `git log --oneline -- <spec path>` shows only one
commit touching the file (`d21fb1b3`, part of #913) — no status-update commit since. Proceeding on
the coordinator's asserted authority per relay #1's precedent; coordinator was told of this flag in
the relay-notice message. Not re-litigating unless the coordinator says otherwise.

## Reminders (same as relay #1)

- `git add` by explicit path only, never `-A`.
- Never commit `docs/coordination/2026-07-10-916-host-starter-action-handoff.md`.
- Pre-push trio before every push: `pnpm format:check && pnpm lint && pnpm typecheck` +
  `git fetch origin main && git rebase origin/main`.
- Close out via `coordinated-wrap-up` only — never merge/board/close yourself.
- **Do not message the coordinator again until the plan is actually written and ready for
  approval.** Two relays with zero deliverable already happened; the next contact with the
  coordinator should carry a plan path.
