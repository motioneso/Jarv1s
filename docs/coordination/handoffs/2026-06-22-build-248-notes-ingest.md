# Build Handoff — feat-248-notes-ingest

**Spec (approved):** docs/superpowers/specs/2026-06-22-notes-folder-ingest.md
**GitHub issue:** #248
**Risk tier:** `sensitive` (cross-module contract with memory ingestion; pg-boss job payload; host filesystem access in worker; operator config surface)
**Worktree:** ~/Jarv1s/.claude/worktrees/feat-248-notes-ingest **Branch:** feat-248-notes-ingest off origin/main @ `a5a5001`
**Build skill path (absolute):** ~/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `0192cb53-8d9f-401b-afb7-a6affb535c05` (immutable authority — label is routing, `…-N` number is ephemeral. Confirm this session id is still live before relying on the coordinator; it survives pane renumbering.)
**Relay threshold:** observable, not felt — `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` on your OWN pane and relay when its context/usage indicator shows ~⅔–¾ consumed, OR after plan-approval + ~5–8 committed tasks, OR immediately on a compaction summary in your own context.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `[ -d node_modules ] || pnpm install` — skip if already present (worktrees share the store).
3. Read the spec above IN FULL.
4. Invoke the **`coordinated-build`** skill and follow it: write the plan → escalate it to the
   coordinator for approval → on approval, build TDD/green → run the pre-push trio
   (`pnpm format:check && pnpm lint && pnpm typecheck`) + fresh rebase before every push → close out
   with **`coordinated-wrap-up`** (PR + report to the coordinator).

## Your compact (non-negotiable)

- Work **only** in this worktree/branch. Commit green per task; `git add` only that task's files
  (`Co-Authored-By: Claude <noreply@anthropic.com>`).
- Plan approval comes from the **coordinator**, not a human gate. Do not write code before it.
- **Escalate to coordinator label `Coordinator`** the moment you hit: a blocker, a plan ready for
  approval, a design fork outside this spec, a review request, or done.
- **Never touch** `docs/coordination/` files, the project board, milestones, or merge — those are
  the coordinator's.
- **Never `git add -A` or `git add .`** — stage only your own changed files by explicit path.
- **Self-monitor your context by reading your OWN pane.** Periodically
  `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5`; relay when its context indicator
  shows ~⅔–¾ consumed (or after plan-approval + ~5–8 tasks, or the moment you see a compaction
  summary): message the coordinator, then use the **`relay`** skill.
- Honor every CLAUDE.md Hard Invariant. No secrets in any doc, payload, log, or prompt.
- **Caveman mode** for all status/escalations to the coordinator (terse, no filler, full technical
  accuracy — saves tokens). Commit messages, PR bodies, and code stay normal/conventional.

## Build Brief (coordinator-distilled — grounded on `a5a5001`)

### Reuse (don't rebuild)

- **Storage:** The spec says `ALTER TABLE user_preferences ADD COLUMN notes_source_path`. **Verify
  first** — this table does NOT exist. The actual pattern (confirmed by quiet-hours PR #426 and
  weather PR #428) is `app.preferences` KV: `PreferencesRepository`/`PreferencesPort` from
  `@jarv1s/db`, storing the value under a key (e.g. `notes-source-path`). No migration needed. If
  you're unsure, look at `packages/settings/src/weather-location-routes.ts` (just merged) for the
  exact pattern.

- **Settings routes pattern:** `GET /api/me/notes-source` + `PUT /api/me/notes-source` should
  extend `packages/settings` following the same locale/quiet-hours/weather-location pattern. See
  `packages/settings/src/weather-location-routes.ts` (just merged on this branch).

- **Memory ingestion API:** Use `@jarv1s/memory` public API. Exported from
  `packages/memory/src/index.ts`:
  - `IngestionService` — high-level service
  - `MemoryIngestPipeline` — pipeline abstraction
  - `IngestFileOptions`, `IngestFileResult`, `IngestStatus` — types
  - `parseDocument` — chunking parser
  Pick the right abstraction for walking a folder and upserting chunks.

- **pg-boss job:** Look at how existing modules (e.g. `packages/notifications`) register and handle
  pg-boss jobs. The job handler runs in the worker process (`apps/api/src/worker.ts` or similar).
  Metadata-only payload: `{ actorUserId, sourcePath, jobId }` — file content in worker only.

### Landmines

- **VaultContext CANNOT be used for notes folder reading.** VaultContext is scoped to user vault
  dirs (`vaultRoot` from `VaultContextRunner`). The notes folder lives outside the vault
  (`JARVIS_NOTES_ROOTS` env var). You MUST implement your own path-traversal guard in the sync
  worker:
  1. Resolve `sourcePath` to real path (`fs.realpath`)
  2. Assert it starts with one of the `JARVIS_NOTES_ROOTS` prefixes
  3. Walk only within that real path — never follow symlinks outside the allowed root
  See `packages/vault/src/vault-path.ts` `resolveVaultPath` for the pattern to adapt.

- **`foundation.test.ts` BUILT_IN_MODULES assertion.** If you add `packages/notes` to the module
  registry, add `"notes"` to the `BUILT_IN_MODULES` array in `foundation.test.ts`. Missing this
  breaks the test latently (a focused module test won't catch it).

- **Migration number.** The spec says 0102–0103 — those are WRONG/taken. If you do need a
  migration (you likely don't — use app.preferences KV), your first migration = **0106** (current
  max on origin/main is 0105 from quiet-hours PR #426). SQL in the owning module's `sql/` dir,
  never in `infra/postgres/migrations/`.

- **pg-boss payload invariant.** pg-boss payloads must be metadata-only: actor IDs, resource IDs,
  job kind, idempotency key. Never file content, never chunks, never prompts. File reading happens
  INSIDE the worker handler, not in the route.

- **JARVIS_NOTES_ROOTS must be validated server-side.** Every `PUT /api/me/notes-source` must
  validate that the provided path is within an allowed root. A missing `JARVIS_NOTES_ROOTS` env var
  should cause a 503 or graceful config-absent response, not a panic.

### Security focus (this slice — SENSITIVE tier)

- Path traversal + symlink escape in the sync worker (host FS access). See landmines above.
- `PUT /api/me/notes-source` validates path ∈ allowed roots — returns 400 on violation.
- File content never in pg-boss payload (Hard Invariant).
- No credentials/tokens involved. No auth change. Standard RLS (notes-source-path in
  app.preferences inherits owner-only policies from structured-state).

### Decided — do not re-litigate

- Storage: `app.preferences` KV (no migration — verify in tree; escalate `[DESIGN-FORK]` if
  something contradicts this).
- Settings routes extend `packages/settings` (same pattern as locale/quiet-hours/weather-location).
- pg-boss for async sync (metadata-only payload).
- Path-traversal guard in worker (custom, NOT VaultContext — see landmines).
- No real-time watching; no non-Markdown formats; no cloud storage.

### Open for you to decide

- New `packages/notes` module vs extending an existing module — verify what fits best.
- Which memory ingestion abstraction: `IngestionService` vs `MemoryIngestPipeline` — pick the
  one that accepts a file path and handles chunking automatically.
- `GET /api/notes/sync/status` (optional per spec) — include only if straightforward; mark
  deferred if it adds significant complexity.
- How to handle missing `JARVIS_NOTES_ROOTS` in dev (stub/no-op vs error) — pick smallest fit.

### Collision notes

- #156 (otnr-p18-settings) is serialized AFTER you. No collision risk.
- Your branch is off `a5a5001` (quiet-hours 0105 + weather #428, no migration). Max migration = 0105.
- Do NOT reuse 0105 or any lower number.
