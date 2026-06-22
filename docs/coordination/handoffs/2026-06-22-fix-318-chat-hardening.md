# Build Handoff — fix-318-chat-hardening

**Spec (approved):** Issue #318 body is the spec (adversarial review findings + suggested fix +
verification target). Read it: `gh issue view 318`
**GitHub issue:** #318
**Risk tier:** `security` (rate-limiting on network-exposed live routes; SSE write race; input
max-length — cross-model four-eye QA + Ben sign-off **waived for this overnight run only**;
coordinator auto-merges after GLM+Codex both post green verdicts via `gh pr comment`)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/fix-318-chat-hardening
**Branch:** fix-318-chat-hardening (off origin/main @ 25c7bd5)
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
3. `gh issue view 318` — read it IN FULL (the issue body IS the spec).
4. Invoke **`coordinated-build`**: write plan → escalate to coordinator for approval → build → wrap up.

## Your compact (non-negotiable)

- Work only in this worktree/branch. Stage only your files by name (never `git add -A`).
- Plan approval comes from the coordinator (label `Coordinator`), not a human.
- Escalate immediately on: plan ready, blocker, design fork outside the issue scope, done.
- Never touch the project board, milestones, or merge.
- Caveman mode for all coordinator messages: terse, no filler.

## Build Brief (coordinator-distilled — grounded on `25c7bd5`)

**Three hardening items in `packages/chat/src/live-routes.ts`:**

**1. Per-route rate limits on `/switch`, `/clear`, `/stream`**
`live-routes.ts:90,105,119` — These fall back to the global 2000/min limiter. The global limiter
IS safe (uses `authPrincipalRateLimitKey`, so the junk-bearer abuse closed in #207 is covered
globally). The gap: `/switch` is the most expensive endpoint (kill engine → resolve provider →
render persona → spawn tmux → replay turns via `ensureSession`) and deserves a stricter per-principal
cap. Add `config.rateLimit` with a tighter window to `/switch` at minimum (e.g. 10–30/min per
principal). `/clear` is cheaper but still state-mutating — same treatment. `/stream` is a read
subscriber; verify the per-actor ceiling below covers it rather than adding redundant route limits.

**2. SSE write-after-close race + per-actor stream ceiling**
`live-routes.ts:131-138`, `chat-session-manager.ts:108` — Two fixes:
- Guard `reply.raw.write(...)` with a check on `reply.raw.destroyed` or `reply.raw.writableEnded`
  before calling write. The close handler fires async; the window between socket close and handler
  registration can emit to an ended stream.
- Add a per-actor ceiling on simultaneously open SSE connections in `chat-session-manager.ts`. The
  per-actor `Set<Subscriber>` at line 108 can grow without bound. Pick a reasonable cap (e.g. 5
  concurrent streams per actor); reject the subscription registration if exceeded (return 429 or a
  specific error the client can surface).

**3. text max-length on `POST /api/chat/turn`**
`live-routes.ts:204-210` (`readText`) — `readText` checks non-empty but has no max-length.
Add an explicit `maxLength` validation before forwarding to `engine.submit(text)`. Pick a sane
per-turn cap (e.g. 32KB or 50K chars); document it. The goal is a per-field cap independent of
Fastify's body limit.

**Reuse:**
- `authPrincipalRateLimitKey` (from the #207 fix) is already the pattern for per-principal rate
  keys. Reuse it for the new per-route limiters.
- Existing chat rate-limit suites (`pnpm test:chat` or `pnpm test:integration` with chat subset)
  should already test route-local limiters — extend them, don't replace.

**Landmines:**
- `packages/chat/src/live-routes.ts` — check its line count (`wc -l`) before adding. The 1000-line
  gate applies; decompose if close.
- `chat-session-manager.ts` at line 108: the per-actor Set is likely module-level; a per-actor
  ceiling is a shared-state change — ensure it's `actorUserId`-keyed (from `AccessContext`), never
  global or IP-keyed.
- The SSE write guard: use `reply.raw.destroyed` (Node.js built-in) — don't try to replicate
  Fastify internals. A simple `if (!reply.raw.destroyed && !reply.raw.writableEnded)` before write.

**Security focus:**
- Rate-limit keys MUST be per-principal (already guaranteed by `authPrincipalRateLimitKey` — just
  wire it consistently). Never fall back to IP-only for authenticated routes.
- The per-actor stream ceiling is a DoS-prevention measure — don't allow it to be bypassed by
  cycling actor sessions.
- The text max-length is an input validation boundary — enforce it before ANY processing (engine,
  persistence).

**Decided — do not re-litigate:**
- Per-route rate limit on `/switch` at minimum; `/clear` as well if small effort delta.
- SSE guard: `reply.raw.destroyed` check (not a Fastify abstraction).
- Per-actor stream ceiling: enforced at subscription registration time.
- Text max-length: explicit field-level cap (not relying solely on body size limit).

**Open for you to decide:**
- Exact rate-limit numbers for `/switch`/`/clear` (issue says "stricter per-principal cap than
  2000/min"; 10–30/min is reasonable for expensive state-mutation ops).
- Stream ceiling number (5 per actor is a starting point; escalate `[DESIGN-FORK]` if the product
  impact is significant).
- Whether `/stream` gets its own route-local rate limit or relies solely on the per-actor ceiling.

**Collision notes:**
- Wave 1, no migration, no shared-table changes.
- Does not touch the same files as #317 (`chat-multiplexer.ts`, `onboarding-routes.ts`), #299
  (settings/tasks/ai cleanups), or dogfood (#419/#420/#403, UI files).
- `packages/chat/` is isolated to this item in Wave 1.

**Verification target (from issue #318):**
- `pnpm test:integration` + existing chat-live/route-local-rate-limit suites green.
- New integration/unit tests: SSE write guard, per-actor stream ceiling, text max-length rejection.
- `pnpm verify:foundation` passes.
