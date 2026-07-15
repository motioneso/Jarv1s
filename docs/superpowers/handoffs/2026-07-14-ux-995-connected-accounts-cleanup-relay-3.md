# Relay 3: UX #995 Connected Accounts Cleanup

Worktree: `~/Jarv1s/.claude/worktrees/ux-995-connected-accounts-cleanup`
Branch: `ux/995-connected-accounts-cleanup`
Coordinator label: `UX Coordinator` (resolve fresh by label via `herdr pane list`, never a raw
pane number). Coordinator confirmed mid-relay-2 that stale duplicate pane (old "UX 995 Build R3",
session `208f2ffc-...`) is closed — you are sole driver, no collision risk now.

Prior relay: `docs/superpowers/handoffs/2026-07-14-ux-995-connected-accounts-cleanup-relay-2.md`
(superseded — its item 1 manual-UAT groundwork is now further along; this doc is authoritative).

All code/tests/gate work for #995 is DONE and committed (HEAD `e867114e`, clean except auto
`.claude/context-meter.log`). Only remaining item is finishing **Task 6: real-dev-instance UAT**,
then **Task 8: coordinated-wrap-up**. Do not re-plan, re-verify the gate, or redo the secret-egress
audit — all done, see relay-2 for that evidence.

## What I did this relay

Stood up a scratch instance from **this worktree** and drove it with a throwaway Playwright script
(`tests/uat-scratch/uat-manual.mjs`, **untracked, don't add to any commit** — it's UAT tooling, not
product code). Hit and fixed two real environment issues along the way (both are dev-harness
quirks, not product bugs):

1. **"Invalid origin" on sign-up** — `apps/web/vite.config.ts`'s dev proxy hard-overrides the
   `Origin` header on proxied `/api` requests to `apiTarget` (see its `configure` block), so
   better-auth's `trustedOrigins` check must match the **API proxy target**, not the browser's
   actual origin. Fix: start the api dev server with
   `JARVIS_AUTH_TRUSTED_ORIGINS=http://localhost:<api-port>` (i.e. same value as
   `JARVIS_API_PROXY_TARGET`), not the web port.
2. **"Your account is pending approval by an administrator"** — the shared dev Postgres
   (`jarv1s` db, default `JARVIS_PGDATABASE`) already has a bootstrap owner from real prior use, so
   `registrationGate` (`packages/auth/src/index.ts:409`) puts any *new* sign-up into `pending`
   status pending admin approval. This is correct product behavior, not a bug — but it blocks a
   from-scratch UAT sign-up against the shared DB. **Not yet resolved** — see options below.

## Working recipe (use this, ports may already be free again — check `ss -ltnp` first)

```bash
# 1. API — trusted origin MUST equal the API port, not the web port
PORT=3901 JARVIS_AUTH_TRUSTED_ORIGINS="http://localhost:3901" pnpm --filter @jarv1s/api dev &

# 2. Web — vite.config.ts's fixed `port: 5173` wins over a trailing --port arg when 5173/5174
#    are taken by other sessions; it actually bound 5175 last time. Check the vite startup log for
#    the real port, don't assume.
JARVIS_API_PROXY_TARGET=http://localhost:3901 pnpm --filter @jarv1s/web dev -- --host 0.0.0.0 &
```

Both servers were killed before this relay — restart fresh. Both used the shared dev Postgres
(fine to reuse, no migrations pending).

## Not yet done — pick up here

1. **Resolve the pending-approval gate**, then finish the UAT checklist from relay-2 item 1
   (picker copy, IMAP provider select + button disabled-states, bogus-cred Test-connection clean
   error, narrow-viewport pass). Options, in order of preference:
   - **(a) Approve via the real admin path** — sign in as whatever existing user is the bootstrap
     owner on the shared dev DB (if you have/can find those creds) and use the real admin UI to
     approve the pending UAT test user. Most faithful to "real dev instance."
   - **(b) Flip `registration.enabled`/approval requirement off first** — check
     `readBooleanSetting`/`registration.requires_approval` handling near
     `packages/auth/src/index.ts:409-421`; if there's a legitimate settings toggle for
     auto-approval, flipping it via the real admin settings UI (not raw SQL) before sign-up is
     still "real dev instance" coverage.
   - **(c) Direct SQL flip of the new user's `status` row** in the shared dev DB (dev-only,
     throwaway UAT email, no real user data touched) — last resort, note explicitly in your
     wrap-up report that you used a DB-level unblock, not the real approval UI, so the coordinator/
     Ben can judge whether that's sufficient evidence.
   - Don't burn much more time here — if (a)/(b) aren't quick, use (c) and move on; the picker/
     IMAP-flow UI is the actual thing under test, not the auth approval gate.
2. **Reconnect-path coverage** (relay-2's item 1 sub-bullet, task 4 in the local task list): decide
   (a) rely on the passing mocked `connect-imap.spec.ts:57` as evidence for reconnect routing, or
   (b) seed a throwaway `imap` connector-account row via `createAppRuntimeRunner()`
   (`tests/uat/seed/connections.ts`) and verify `Reconnect` opens `ImapConnect` without
   `initialProvider`. Use judgment; note whichever you pick.
3. Then `coordinated-wrap-up`: clean tree (only `tests/uat-scratch/` untracked + the auto
   context-meter.log — don't commit the scratch script), re-run the pre-push trio + rebase, push,
   open PR, report PR + exact HEAD + evidence (incl. UAT method used) to `UX Coordinator`. Do not
   merge/board/close.

## Notes

- Local task list (TaskList) already has tasks #1-5 tracking this — task #1 done, #2 in_progress
  (blocked on the approval gate above), #3-5 pending. Reuse it, don't recreate.
- `tests/uat/` (the full docker-compose #1000 UAT harness) is a much heavier tool than needed here
  — the plain dev-server + Playwright-script approach above is what relay-2 specified and is
  sufficient; don't reach for the docker harness unless told to.
