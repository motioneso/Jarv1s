# Jarvis — Memory Foundation Handoff

Date: 2026-06-06
Status: Active. This supersedes the alpha-era `docs/HANDOFF.md` (now historical).

> **Read this first when resuming.** It captures the pivot from the alpha scaffold to a
> memory-first foundation, exactly where we stopped, and the next step.

---

## Next Step (start here)

1. **Slice 1b is MERGED** (probe + Tasks on owner-or-share). **Next: execute the `slice-1c-core`
   plan** — `docs/superpowers/plans/2026-06-06-slice-1c-core-calendar-email-connectors-ai.md`
   (ready). It converts the four no-design-risk modules: **calendar** + **email** → owner-or-share,
   and **connectors** + **ai** → plain owner-only (they hold encrypted credentials and are
   deliberately NOT shareable — the audit confirmed `ai_provider_configs` / `ai_configured_models`
   need no migration at all; only `ai_assistant_action_requests` INSERT does). Execute with
   `superpowers:subagent-driven-development`.
   **Still to be planned** (separate `slice-1c-1d-structural` plan, **NOT yet written**):
   **notifications** (no `owner_user_id` — owner is `recipient_user_id`; workspace notifications have
   no owner at all), **chat**, **briefings** (first-class workspace-visibility with child tables
   `chat_messages` / `briefing_runs` that must inherit a parent-level share via an RLS-filtered
   EXISTS; briefings also has `jarvis_worker_runtime` grants to preserve). Brainstorm the
   notification redesign before planning those.
   Two hard lessons from 1b that the 1c/1d work MUST apply:
   - **Cross-module migration coupling.** A module's RLS policies can be redefined by a _later_
     migration owned by a _different_ module (in 1b, `packages/notes/sql/0007` redefined
     `tasks_update` and — because modules migrate in registry order, not by version number — ran
     _after_ `tasks/0019` and clobbered it). Before converting module X, grep all `packages/*/sql`
     + `infra/postgres/migrations` for every later `CREATE POLICY <X>_*` and make the new
     owner-or-share migration the final word (editing the offending later migration if needed).
   - **Cross-cutting test fallout.** Converting a module breaks integration suites that read its
     rows cross-user via the legacy model from _other_ files (1b broke `ai-tools.test.ts` and
     `auth-settings.test.ts`, not just `tasks.test.ts`). Enumerate every suite that touches the
     module before assuming the gate stays green.
2. Read order: the spec (`docs/superpowers/specs/2026-06-06-memory-data-model-design.md`) →
   `CLAUDE.md` → the 1b plan → the `slice-1c-core` plan.

Do **not** start new product features. The work is bounded to the memory-foundation slices below.

---

## The Pivot (what changed this session)

The alpha scaffold optimized the multi-tenant security/module substrate but had **no memory
architecture** — which is the actual product. We re-centered on a memory-first foundation. The
full, reviewed design is in the spec; the headlines:

- **File over app.** Durable knowledge lives in the user's own tool (Obsidian first, Notion later)
  as portable markdown. Jarvis is the orchestrator, not the store. The `notes` module (DB-row
  notes) is being removed.
- **Split memory model.** Freeform knowledge → vault files (indexed). Structured agent state
  (commitments / open loops, entities, preferences) → typed Postgres records, RLS-protected.
- **Multi-user is first-class** (the real case is two spouses on one instance). Per-user privacy
  via RLS stays; the heavy workspace/role/grant machinery is replaced by a lightweight
  **per-resource `shares`** model (owner OR qualifying share). Platform **roles** (instance-admin)
  remain but govern _abilities only_, never data access.
- **Vault security mirrors the DB.** A new `VaultContext` (filesystem twin of `DataContextDb`)
  scopes all file I/O to a per-user vault root; app-layer isolation now, encryption-ready seam.
- **Local, pluggable embeddings.** Semantic retrieval over a derived pgvector index; embeddings
  run on-box (privacy-first), decoupled from BYOP. The vault is a _source_; the index is derived
  and rebuildable.
- **Brand-driven schema rules.** Structured state carries `provenance` (volunteered | inferred |
  confirmed) and is user-visible/reversible; commitments have a drift-aware lifecycle
  (open → at_risk → slipped → done | renegotiated | dismissed); `preferences` hold persona config.
- **Life-context** (work/personal/family) is a **briefing/focus** concern, not an access boundary.
  Privacy _from_ the agent = don't store it in Jarvis. The agent sees all of its user's data.

## Where We Are

- **Spec (approved):** `docs/superpowers/specs/2026-06-06-memory-data-model-design.md`
- **Slice 1a — MERGED to `main`.** PR #1 squash-merged (`c0bcff0`): `app.shares` table +
  `app.has_share()` + `app.share_level_rank()` + Kysely types + `SharesRepository`. The sharing
  helper is named **`app.has_share`** (renamed from `can_access` during a thermo-nuclear review — it
  answers the **share half only**, so RLS policies must OR it with
  `owner_user_id = app.current_actor_user_id()`, mirroring `app.has_resource_grant`). Full gate
  green: **127 integration tests / 13 files**. Plan:
  `docs/superpowers/plans/2026-06-06-shares-foundation.md`.
- **Slice 1b — MERGED to `main`.** Probe (`0018_probe_owner_or_share.sql`, infra) + Tasks
  (`0019_tasks_owner_or_share.sql`, tasks module) converted to owner-or-share via `app.has_share`;
  full gate green (**127 tests / 13 files**). Commits: `cee6bad` (probe), `004ef65` (tasks + a
  required edit to `packages/notes/sql/0007` — see caveats), `b55f36d` (ai-tools + auth-settings
  test fallout). Plan: `docs/superpowers/plans/2026-06-06-slice-1b-tasks-owner-or-share.md`.
  **Caveats:** (1) editing the already-applied `notes/0007` to drop its stale `tasks_update`
  redefinition changes that migration's checksum — any pre-1b DB must `pnpm db:down && pnpm db:up`
  (fresh CI is unaffected); (2) `app.resource_grants` is now **inert for tasks** (and the probe) —
  the admin resource-grants API still records grants but they confer no task access; the dead
  helpers/columns/API path are retired in Slice 1f.
- **`main`:** `da496ef` (brand) → `c0bcff0` (Slice 1a) → `CLAUDE.md` → handoff → Slice 1b merge.
  Local and `origin/main` were in sync through 1a (1b merged locally; push when ready).
- **Obsidian vault:** prior-iteration Jarvis notes archived to `4 Archives/Jarvis-alpha` (1,110
  files). Active `2 Areas/Jarvis/Specs/` mirrors the current-iteration design docs + both slice
  plans (git is canonical; vault copies are for remote review).

## Slice Roadmap

**Slice 1 — workspace → shares teardown** (full teardown; keep all modules). Sub-plans:

1. ✅ **1a Shares foundation** — `app.shares` + `app.has_share` + types + repository. **MERGED (PR #1).**
2. ✅ **1b Probe + Tasks → owner-or-share** — migrations `0018`/`0019`. **MERGED to `main`.**
3. ⏭️ **1c-core** — Calendar + Email → owner-or-share; Connectors + AI → owner-only.
   **Plan ready; next to execute.** (`2026-06-06-slice-1c-core-calendar-email-connectors-ai.md`)
4. **1c/1d-structural** — Notifications (recipient-owned redesign), Chat, Briefings (parent-child
   share inheritance + worker grants). **Needs brainstorm + plan.** Replaces the original flat
   "1c (Notifications/Connectors/Calendar/Email)" + "1d (AI/Chat/Briefings)" split — the audit showed
   Connectors/Calendar/Email/AI are the easy batch and Notifications/Chat/Briefings are the
   structural ones, so the work was re-grouped by difficulty rather than by the old numbering.
5. **1e** — remove the **Notes** module entirely.
6. **1f** — drop workspace tables + legacy functions; remove `workspace_id` from `AccessContext`,
   the auth resolver, and the web `x-jarvis-workspace-id` header; retire Settings
   workspace/membership APIs. `AccessContext` becomes `{ actorUserId, requestId }`.

`workspace_id` stays in the context until 1f so each module converts independently and tests stay
green throughout.

**Slice 2 — Vault + `VaultContext`:** per-user vault root, optional import, traversal-safe I/O,
OS perms, encryption-ready seam.

**Slice 3 — Memory index + retrieval:** pgvector infra (swap to a pgvector-enabled Postgres image

- `CREATE EXTENSION vector`), ingestion pipeline, local `EmbeddingProvider`, `retrieve()` with
  provenance, rebuild.

**Slice 4 — Structured state + write-back:** `commitments`, `entities`, `preferences`;
frontmatter(machine)/body(human) write-back; entity ↔ People-note linking.

(BYOP / capability router, the proactivity engine, and curation/feeds are later, separate specs —
they read/write the model these slices build.)

## How to Resume (workflow + environment)

- **Read order:** this handoff → the spec → `CLAUDE.md` → `docs/DEVELOPMENT_STANDARDS.md`.
- **Workflow:** `superpowers:brainstorming` (only if design questions remain) →
  `superpowers:writing-plans` → `superpowers:subagent-driven-development`. Implementers on Sonnet;
  controller reviews (spec compliance + code quality) between tasks; commit per task.
- **Environment gotcha:** `pnpm` is reached via the corepack shim — ensure `~/.local/bin` is on
  PATH (`export PATH="$HOME/.local/bin:$PATH"`), or run `corepack pnpm <script>` (note: composite
  scripts like `verify:foundation`/`typecheck` call bare `pnpm` internally, so the PATH shim is the
  reliable option). Start Postgres with `pnpm db:up` before any integration test.
- **Gate before claiming done:** `pnpm verify:foundation` (lint, format:check, check:file-size,
  typecheck, db:migrate, test:integration). Keep it green.
- **Specs are mirrored** to `~/obsidian-vault/2 Areas/Jarvis/Specs/` for remote review (git is
  canonical).

## Invariants to Preserve

- Admin/owner power is _ability_ power, never private-data read power. No admin RLS bypass.
- Per-user privacy via `FORCE ROW LEVEL SECURITY`; access = owner OR qualifying `share`.
- Runtime app/worker roles never own protected tables or hold `BYPASSRLS`.
- Repositories take only the branded `DataContextDb`; (later) vault I/O only via `VaultContext`.
- pg-boss payloads are metadata-only. Secrets never reach responses, logs, payloads, or exports.
- New features are additive packages connecting via stable interfaces — don't modify core casually
  (the Slice 1 teardown is the deliberate one-time exception that _creates_ the clean seams).
- TDD for all new work; respect the 1000-line file ceiling and the maintainability bar.

## Historical

- Alpha-era handoff: `docs/HANDOFF.md` (M1–M7 platform scaffold). Retained for reference.
- Alpha architecture decisions: `docs/architecture/`.
- Brand brief (still current, shapes product decisions): `docs/brand/brand-brief.md`.
