# Build Handoff — feat-156-instance-settings

**Spec (approved):** docs/superpowers/specs/2026-06-22-otnr-p18-instance-settings-cleanup.md
**GitHub issue:** #156
**Risk tier:** `sensitive` (admin write surface hardening; key registry cross-module; open PATCH fail-close)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/feat-156-instance-settings **Branch:** feat-156-instance-settings off origin/main @ `5836bbf`
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
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
  (`Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`).
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

## Build Brief (coordinator-distilled — grounded on `5836bbf`)

### Current state

The admin write surface at `PATCH /api/admin/settings/:key`
(`packages/settings/src/routes.ts:201`) accepts **any free-form key** — no validation that the
key is one the system knows about. The fix is to fail-close it (reject unknown keys → 400).

**Known `app.instance_settings` keys in use (exhaustive — coordinator verified):**

| Key | Set/read by | Notes |
|-----|-------------|-------|
| `registration.enabled` | `packages/settings/src/repository.ts` | public |
| `registration.requires_approval` | `packages/settings/src/repository.ts` | public |
| `chat.multiplexer` | `packages/settings/src/repository.ts` | public |
| `onboarding.state` | `packages/settings/src/repository.ts` | public |
| `ai.chat_model_override.enabled` | `packages/ai/src/repository.ts` (`CHAT_MODEL_OVERRIDE_SETTING_KEY`) | public |

**No secret values live in `app.instance_settings`** — connector/AI credentials live in the
vault credential store (AES-256-GCM). The audit/secret-exclusion requirement in the spec is
about FUTURE-PROOFING: the key registry should have a `secret: true` flag available so that
when a secret key is added it can be excluded from `GET /api/admin/settings`.

### Design decisions (settled — do not re-litigate)

**Key registry location:** Define `INSTANCE_SETTINGS_KEYS` as a readonly const array (or a
record) in `packages/settings/src/instance-settings-keys.ts`. Include the 5 keys above.
For the AI key, you have two equivalent options — pick whichever is cleaner:
- Hardcode `"ai.chat_model_override.enabled"` in the settings registry (safe; the string is
  stable and well-named)
- Import `CHAT_MODEL_OVERRIDE_SETTING_KEY` from `@jarv1s/ai` (fine; settings→ai is an
  acceptable peer dependency direction since AI already wires into settings routes)

**PATCH fail-close strategy:** In the existing `PATCH /api/admin/settings/:key` handler,
add a guard that checks `request.params.key` against the registry before calling
`upsertInstanceSetting`. Return 400 if not found. This is the minimal change that satisfies
the spec — no need to decompose into typed sub-routes unless you want to.

**GET filtering:** Update `GET /api/admin/settings` to return only rows whose key is in the
registry AND is not flagged as secret. Currently all 5 known keys are non-secret, so the
filter is effectively `key IN (known_keys)` — but add the `secret` flag to the registry type
so a future key can opt out of the list endpoint without code changes.

**No migration.** This is code-only per the spec. Do not add a migration.

### Landmines

- `packages/settings/src/routes.ts` is already large. Check its line count before adding
  code; decompose if approaching 1000 lines (`pnpm check:file-size` enforces the limit).
- The `listInstanceSettings()` repository method returns ALL rows from `app.instance_settings`.
  The route-layer filter (registered + non-secret) should live in the route handler or a thin
  helper, NOT in the repository — keeping repository methods general is the existing pattern.
- Do not accidentally remove the admin-gate assertion (`assertAdminUser`) when modifying the
  PATCH or GET handlers. It must remain.
- Do not import `packages/settings` internals from `packages/ai` — that would be the wrong
  direction. The settings package is allowed to reference AI constants, not the reverse.

### Security focus (sensitive tier)

- The PATCH key-validation guard is the primary hardening. Confirm the 400 response path never
  reveals key names that are in the registry (no enumeration leak in the error body).
- `GET /api/admin/settings` must not echo secret values — even though none exist today, the
  registry's `secret` flag must be respected in the filter.
- `assertAdminUser` must remain on all modified handlers.
- No new RLS policy changes needed; `app.instance_settings` already has ENABLE + FORCE RLS.

### Collision notes

- This is the final item in Wave 2. No serialization dependency — #217/#248/#250 are all merged.
- No migration, so no migration-number reservation needed.
- Max migration on main is currently 0106 (notes-folder-ingest, just merged).
