# Jarvis — Memory Foundation Handoff

Date: 2026-06-06
Status: Active. This supersedes the alpha-era `docs/HANDOFF.md` (now historical).

> **Read this first when resuming.** It captures the pivot from the alpha scaffold to a
> memory-first foundation, exactly where we stopped, and the next step.

---

## Next Step (start here)

1. **Decide PR #1.** Slice 1a (shares foundation) is implemented and open as a PR:
   https://github.com/motioneso/Jarv1s/pull/1 (branch `slice-1a-shares-foundation`).
   Either merge it to `main`, or branch the next slice from it.
2. **Write & execute the Slice 1b plan** — convert the core RLS probe + the Tasks module from
   workspace-visibility to **owner-or-share** (using `app.can_access`). Use the same workflow:
   `superpowers:writing-plans` → `superpowers:subagent-driven-development` (Sonnet implementers,
   review between tasks).
3. The slice sequence and full design are in the spec — read it before planning 1b:
   `docs/superpowers/specs/2026-06-06-memory-data-model-design.md`.

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
- **Slice 1a plan:** `docs/superpowers/plans/2026-06-06-shares-foundation.md`
- **`main`:** `CLAUDE.md` added (`8c7ca11`). Alpha code/docs otherwise intact.
- **Branch `slice-1a-shares-foundation` (PR #1):** shares foundation — `app.shares` table +
  `app.can_access()` + Kysely types + `SharesRepository`. Reviewed task-by-task; full gate green
  (lint, format, file-size, typecheck, migrate, **127 integration tests / 13 files**).
- **Obsidian vault:** prior-iteration Jarvis notes archived to `4 Archives/Jarvis-alpha` (1,110
  files). Active `2 Areas/Jarvis/Specs/` holds only the 2 current-iteration design docs (mirrors of
  the git specs, kept for remote review).

## Slice Roadmap

**Slice 1 — workspace → shares teardown** (full teardown; keep all modules). Sub-plans:

1. ✅ **1a Shares foundation** — `app.shares` + `can_access` + types + repository (PR #1).
2. ⏭️ **1b** — convert core RLS probe + **Tasks** to owner-or-share.
3. **1c** — convert Notifications, Connectors, Calendar, Email.
4. **1d** — convert AI (assistant action requests), Chat, Briefings.
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
