# Plan Handoff — #918 Open module system Slice 2

**Spec (approved):** `docs/superpowers/specs/2026-07-08-open-module-system-user-authored-modules.md`
(§Build slices — Slice 2). Merged to main via PR #911 (`90cc89d7`).
**GitHub issue:** #918 — "Open module system Slice 2: assets, ESM contributions, credentials, KV"
**Risk tier:** `security` (AES-256-GCM `app.module_credentials` hits the "Secrets never escape"
hard invariant; new network-exposed asset-serving route needs path-traversal/symlink defense —
treat build to the adversarial-QA bar even though this task is plan-authoring only, not code).
**Worktree:** `/home/ben/Jarv1s/.claude/worktrees/918-implementation-plan`
**Branch:** `plan/918-open-module-system-slice2` (off `origin/main` @ `4bc53694`, includes #917/PR #924)
**Coordinator label:** `Coordinator` — escalate via `herdr-pane-message`; before messaging, verify
`herdr pane list` shows EXACTLY ONE pane with this label, resolved fresh each time.
**Coordinator session id:** `46590121-e5b0-42cb-aa50-b2da3a615f1f` (immutable authority).
**Relay trigger:** context-meter 70% warning, or a compaction summary in your own context →
message the coordinator, then use the `relay` skill immediately.

## Start

1. `[ -d node_modules ] || pnpm install`.
2. Read the approved spec IN FULL (path above), focusing on §Build slices — Slice 2. Also read
   Slice 1's landed shape already on this branch (#917, merged) — ground every file/module claim
   by reading current code, do not assume prior specs' structure still matches.

## Task

This is a **plan-authoring task, not a build task.** Author the implementation plan for #918
against this scope:

- Asset-serving route for module-authored static assets, with explicit path-traversal and symlink
  defense (untrusted module packages are the threat model).
- ESM contribution loader: react pinned to host version, `contractVersion` check against the
  module manifest before any contribution is mounted.
- `app.module_credentials`: AES-256-GCM encryption at rest, credential settings UI, and a
  plaintext-never-escapes guarantee (frontend responses, logs, pg-boss payloads, exports, AI
  prompts — per CLAUDE.md's "Secrets never escape" invariant).
- `app.module_kv` + lifecycle export/delete completeness (data lifecycle ports — export includes
  it, delete purges it).
- New migrations + their rows in `foundation.test.ts`'s full-list `toEqual` assertion; note that
  full `test:integration` must be run at build time (not by this plan-authoring lane).
- Explicitly OUT of scope: Slice 3's module-facing RPC helpers — do not assume they exist.

The plan document must call out, as first-class sections:
(a) the path-traversal/symlink defense mechanism for the asset route,
(b) the credential encryption/decryption flow and the plaintext-never-escapes guarantee end to end,
(c) KV export/delete completeness against the data-lifecycle ports.

Invoke **`superpowers:writing-plans`** to author the plan. When drafted, message the `Coordinator`
(this session, or its relay successor — resolve fresh by label + session id) with a pointer to the
plan doc — do NOT self-approve. Security tier means Ben/overnight-panel sign-off is required
before any build lane spawns against it. Do not write feature code in this worktree — this lane's
deliverable is the plan only.

## Run-specific bans (non-negotiable)

- Work ONLY in this worktree/branch; `git add` by explicit path — never `git add -A` or repo-wide
  `pnpm format`.
- Never touch `docs/coordination/` (coordinator-only), the project board, milestones, or merge.
- No secrets in any doc, payload, log, or prompt.
- Do not touch other agents' active lanes: `w1:pCP` (Fable: sports-fed spec+plan), `w1:pCQ`
  (Fable: PR review 908/909/910), `w1:pCK` (Codex: Job Search Spec) — read-only reference only if
  cross-context is needed, never edit.

## Collision notes (from the coordinator)

- #918 serializes behind #917 (already merged). #919 serializes behind #918 — do not assume
  Slice 3 RPC helpers exist yet.
- #915 already merged via PR #923 (useful context for later worker interop, not this slice's
  concern).
- #914 has an approved spec (PR #920 merged) but is NOT yet implemented — don't assume its
  migration-ledger mechanism exists on disk.
- Migration numbers not yet assigned — assigned by the coordinator at build time per CLAUDE.md's
  global-landing-order invariant.
