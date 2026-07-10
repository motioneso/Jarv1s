# Build Handoff — #919: Open Module System Slice 3 (worker runtime + tool execution)

**Spec (approved):** docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md
(§Build slices — Slice 3, "backend assistant tool execution"), on `origin/main`. Depends on Slice 2
(#918, CLOSED, merged via PR #925).
**GitHub issue:** #919 (Part of #818; substrate for #913 prerequisite 10 and the #860/#915
worker-capability workstream).
**Implementation plan:** NOT yet written. No plan-authoring has happened for this lane — you must
plan first via **`coordinated-build`** (plan → coordinator approval → build). Do not skip to
building.

## Scope (per approved spec / issue #919)

- Child-process JSON-RPC worker runtime: per-module lazy spawn, scrubbed env allowlist, cwd =
  module dir, protocol version check, hard per-invocation timeout, serialized invocations,
  bounded + best-effort-redacted stdio capture, typed crash errors + respawn.
- `defineModuleWorker` authoring contract in `@jarv1s/module-sdk`; handlers receive no
  DataContextDb/Kysely/VaultContext/root fs/root env.
- Wire external assistant tool handlers into `AssistantToolGateway`: read/write/destructive risk
  tiers, pending `app.ai_assistant_action_requests` for confirm-gated actions, full audit.
- Decrypted declared credentials passed to trusted handlers at execution time only; KV/auth RPC
  helpers added here (per spec, these were explicitly withheld until Slice 3).
- Tests: write tool creates pending action request; metadata-only responses; RLS; revocation;
  lifecycle purge/export; log redaction.

**User-facing summary (for the eventual PR):** enabled modules can actually do things — their
assistant tools run in an isolated worker process with the same confirm-and-audit safeguards as
built-in tools.

**Risk tier:** `security` — credential handling (decrypted creds reach a child process) +
privileged child-process execution + network/tool-exposed surface (assistant tool calls). This
lane requires **Opus adversarial QA** and **Ben's explicit merge sign-off** — no auto-merge,
regardless of how green CI is.

**Worktree:** /home/ben/Jarv1s/.claude/worktrees/919-worker-runtime
**Branch:** feat/919-worker-runtime (off `origin/main` @ `eafa22dd26729454dd3525d8bff53fc76ca7d3f0`,
confirmed green)
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md (follow
this exact file if `coordinated-build` does not resolve by name in your spawn env)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time (never a cached
`…-N` pane number — they reflow).
**Coordinator session id:** `792382f9-6c9a-4733-9206-ba99909464f6` (immutable authority; label is
only routing).
**Relay trigger:** the context-meter warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read the spec's Slice 3 section (§Build slices) IN FULL, and issue #919's body.
3. No plan exists yet — author one via **`coordinated-build`**, then wait for coordinator approval
   before writing code. Given the `security` tier, expect the plan review to focus hard on: env
   scrubbing completeness, timeout/serialization correctness, credential lifetime (never persisted
   beyond the call, never logged), and confirm-gate coverage for destructive tools.
4. Follow **`coordinated-wrap-up`** for the PR + report once built.
5. Escalation rules, gate commands, and comms conventions are defined in `coordinated-build` — this
   doc does not restate them.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt — decrypted credentials must never reach a log
  line, a job payload, or a test fixture committed to the repo.
- Do NOT touch Slices 1/2/4, or any other module's internals — module isolation invariant applies.

## Collision notes (from the coordinator)

- Global migration sequence so far: `#917→#914→#918→#919`. If this slice needs a migration, it
  lands AFTER whatever #914 has already claimed — confirm the next free number with the
  coordinator before writing one; do not assume.
- `foundation.test.ts`'s full-migration-list `toEqual` assertion — if you add a migration, update
  this assertion in the same PR or the suite breaks latently.
- `AssistantToolGateway` and `app.ai_assistant_action_requests` are shared surfaces other slices
  may also touch — if you find either mid-change by another lane, stop and escalate rather than
  resolving a conflict yourself.
