# Build Handoff — fix-317-onboarding-provider

**Spec (approved):** Issue #317 body is the spec (adversarial review findings + suggested fix +
verification target). Read it: `gh issue view 317`
**GitHub issue:** #317
**Risk tier:** `security` (billable side-effect on a network-exposed status probe; auth-surface error
masking — cross-model four-eye QA + Ben sign-off **waived for this overnight run only**; coordinator
auto-merges after GLM+Codex both post green verdicts via `gh pr comment`)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/fix-317-onboarding-provider
**Branch:** fix-317-onboarding-provider (off origin/main @ 25c7bd5)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; verify
`herdr pane list` shows EXACTLY ONE pane with this label before every message)
**Coordinator session id:** `0ee17fb4-0c20-488e-be1e-146d2f9acacb`
**Relay threshold:** ~⅔–¾ context consumed OR after plan-approval + ~5–8 tasks OR on any
compaction summary in your own context.

## Start

1. Confirm `coordinated-build` skill is accessible; if not, open the absolute Build skill path
   above and follow it directly.
2. `[ -d node_modules ] || pnpm install`
3. `gh issue view 317` — read it IN FULL (the issue body IS the spec).
4. Invoke **`coordinated-build`**: write plan → escalate to coordinator for approval → build → wrap up.

## Your compact (non-negotiable)

- Work only in this worktree/branch. Stage only your files by name (never `git add -A`).
- Plan approval comes from the coordinator (label `Coordinator`), not a human.
- Escalate immediately on: plan ready, blocker, design fork outside the issue scope, done.
- Never touch the project board, milestones, or merge.
- Caveman mode for all coordinator messages: terse, no filler.

## Build Brief (coordinator-distilled — grounded on `25c7bd5`)

**Three bugs, three fixes — all in the provider-check path:**

1. **Google live-inference call on every status probe**
   `packages/module-registry/src/chat-multiplexer.ts:175-191` (`checkGoogleProviderWithAgyPrint`)
   — Replace the `agy --print "Reply with exactly OK."` call with a local-probe pattern (e.g. `agy
   --version` or `agy auth status --print` if that exists non-interactively). The goal is a
   no-inference probe, matching how claude (`claude auth status`) and codex work. If no local
   non-inference check exists for agy/google, gate the live check behind an explicit `?liveCheck=1`
   query param so status-style probes don't bill.

2. **Unbounded subprocess fan-out on every `/status` fetch**
   `packages/settings/src/onboarding-routes.ts:97-103` — Add a short server-side TTL cache (5–15s)
   on the `multiplexerUsable`/`cliPresent` probe results. A `Map<key, {result, ts}>` with a
   per-actor cache keyed to `actorUserId` (from `AccessContext`) is fine. The wizard's
   invalidate/refetch loop must not drive unbounded spawning.

3. **Google collapses all non-OK outcomes to `needs_login`**
   `packages/module-registry/src/chat-multiplexer.ts:184-190` — Return `{ status: "error" }` for
   binary crash / timeout / genuine error outcomes; reserve `needs_login` for the actual "not
   signed in" case. Add a distinct check: if the command exits non-zero AND output contains an
   auth/login signal → `needs_login`; otherwise → `error`.

**Reuse:**
- The claude/codex probe pattern (local, non-inference) is already in `chat-multiplexer.ts` above
  the google block — mirror it.
- `AccessContext` from `DataContextDb` already carries `actorUserId` for the cache key.

**Landmines:**
- `packages/settings/src/routes.ts` is at exactly 1000 lines — ANY edit WILL trip the file-size
  gate. Check `wc -l` before adding code there; decompose first if needed.
- `foundation.test.ts` asserts the FULL migration list. No migration here, so no impact — but
  still run `pnpm test:integration` to confirm.
- The cache must NOT cross actor boundaries (per-actor, not global).

**Security focus:**
- The probe result cache must be per-actor (keyed to `actorUserId`), never shared across users.
- No auth tokens, credentials, or raw probe output in logs or cache storage.
- The `error` vs `needs_login` distinction is a security-adjacent UX fix (misleading users into
  auth debugging for a non-auth fault).

**Decided — do not re-litigate:**
- Cache TTL: 5–15s server-side per actor.
- Probe strategy: local-only (non-inference) for status; gate live inference behind explicit affordance.
- Error classification: crash/timeout/non-auth-error → `error`; auth signal → `needs_login`.

**Open for you to decide:**
- Exact cache storage shape (in-process Map vs module-level singleton) — escalate `[DESIGN-FORK]`
  only if a stateful decision has security implications beyond performance.
- Whether to add a `?liveCheck=1` affordance for explicit inference test (product judgment, low risk).

**Collision notes:**
- No migration; no shared-table changes. Wave 1 — no serialization dependency.
- Does not touch the same files as other Wave 1 items (#318 touches `live-routes.ts`/`chat-session-manager.ts`; #299 touches `routes.ts`/`settings/`; #dogfood touches tasks/chat UI). No direct conflict, but `packages/settings/src/onboarding-routes.ts` is touched here — confirm the tree is clean from origin/main.

**Verification target (from issue #317):**
- `pnpm test:integration` + `pnpm test:e2e` green.
- Google path no longer mints a billable call on a status probe (verify by log/unit test).
- `/status` probes are cached/debounced (verify by unit test: second call within TTL window does
  not spawn subprocesses).
- Non-auth failures surface as `error`, not `needs_login` (verify by unit test).
- `pnpm verify:foundation` passes (lint + format:check + check:file-size + typecheck + db:migrate + test:integration).
