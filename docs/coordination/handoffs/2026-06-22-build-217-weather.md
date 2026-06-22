# Build Handoff — feat-217-weather

**Spec (approved):** docs/superpowers/specs/2026-06-22-weather-real-forecast.md
**GitHub issue:** #217
**Risk tier:** `sensitive` (schema migration on preferences table; new external HTTP surface; location data)
**Worktree:** /home/ben/Jarv1s/.claude/worktrees/feat-217-weather **Branch:** feat-217-weather off origin/main @ `85c727f`
**Build skill path (absolute):** /home/ben/Jarv1s/.claude/skills/coordinated-build/SKILL.md
**Coordinator label:** `Coordinator` (UNIQUE — escalate via `herdr-pane-message`; before messaging, verify `herdr pane list` shows EXACTLY ONE pane with this label. Never guess or reuse a `…-N` pane-id — they reflow when any pane opens/closes; re-resolve the live pane by label from `herdr pane list` each time.)
**Coordinator session id:** `0192cb53-8d9f-401b-afb7-a6affb535c05` (immutable authority — label is routing, `…-N` number is ephemeral. Confirm this session id is still live before relying on the coordinator; it survives pane renumbering.)
**Relay threshold:** observable, not felt — `herdr pane read "$HERDR_PANE_ID" --source visible --lines 5` on your OWN pane and relay when its context/usage indicator shows ~⅔–¾ consumed, OR after plan-approval + ~5–8 committed tasks, OR immediately on a compaction summary in your own context.

## Start

1. **Resolve your skills.** Confirm you can invoke `coordinated-build` by name; if not, open the
   absolute **Build skill path** above and follow it directly.
2. `pnpm install` — but **only if `node_modules` is missing** (`[ -d node_modules ] || pnpm install`).
   Worktrees share the pnpm store; a relay successor in an existing worktree skips this.
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

## Build Brief (coordinator-distilled — grounded on `85c727f`)

- **Reuse (don't rebuild):**
  - The project uses `app.preferences` KV for per-user settings (see quiet-hours PR #426 — key
    `quiet-hours`, table `structured-state/sql/0031`). The spec says `ALTER TABLE user_preferences
    ADD COLUMN weather_location` — **verify first** whether `user_preferences` exists as a real
    table or whether `app.preferences` KV (key `weather-location`) is the right pattern. Use the
    actual pattern in the tree; don't add a column to a table that doesn't exist. If it's KV,
    no migration needed for storage (just new settings routes).
  - Settings PUT routes pattern: see `packages/settings/src/routes.ts` for locale/persona —
    extend that pattern for `PUT /api/settings/weather-location`.
  - Look at `packages/weather` or `packages/briefings` for any existing Open-Meteo call
    plumbing before building from scratch.

- **Landmines:**
  - `foundation.test.ts` asserts the FULL migration list via `toEqual` — if you add a migration,
    add its row there or it breaks latently. If using `app.preferences` KV (no new migration),
    no row needed.
  - Migration number assigned by landing order. **Your first migration = 0106** (max on
    origin/main is 0105 from quiet-hours). SQL goes in the owning module's `sql/` dir, never
    in `infra/postgres/migrations/`.
  - Open-Meteo calls are server-side only — **never proxy raw responses to the client**. The
    API is `https://api.open-meteo.com` (free, no key).
  - Egress-IP geolocation: spec says "free tier, cached server-side, no PII stored." Do not
    store the raw IP; only store the derived lat/lon/city label if at all.
  - Server-side cache (30 min TTL): pick the smallest fit — an in-memory `Map` with a timestamp
    is fine unless concurrency/restart-survival is a concern; no need for DB-backed cache.

- **Security focus (this slice):**
  - Location override (`weather_location`) is per-user PII-adjacent data. If stored in
    `app.preferences` KV, it inherits owner-only RLS from the structured-state table — verify
    this. If adding a new table or column, confirm ENABLE+FORCE RLS and owner-scoped SELECT/UPDATE
    policies.
  - No auth/sessions/tokens/secrets involved — this is NOT security tier. Standard RLS hygiene.

- **Decided — do not re-litigate:**
  - Open-Meteo as the weather provider (no API key, free tier).
  - Location resolution order: user override → egress-IP fallback → no result.
  - Unit defaults to metric; follows locale pref.
  - 30 min server-side cache.

- **Open for you to decide:**
  - Storage: `app.preferences` KV vs column on an existing table — verify the tree and pick the
    right one. Escalate `[DESIGN-FORK]` if genuinely ambiguous.
  - Cache implementation: in-memory vs anything heavier — pick smallest fit.
  - Egress-IP provider: pick any free no-key geocoding service; note the choice in your plan.
  - Module placement: new `packages/weather` module or extend `packages/briefings` (briefings
    already calls the Today route area) — pick what fits better; escalate if the fit is unclear.

- **Collision notes:**
  - #248 (notes-ingest) and #156 (otnr-p18-settings) are serialized AFTER you — they haven't
    started. No collision risk with your migration. Your migration 0106 is reserved for you.
  - Do NOT reuse migration number 0105 (taken by quiet-hours `85c727f`).
