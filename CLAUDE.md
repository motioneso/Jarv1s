# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Orientation

Before starting work, read these three docs in order:

1. `docs/STATUS.md` — current milestone, last known-good state, next step
2. `docs/ROADMAP.md` — milestone sequence, exit criteria, hard invariants
3. `docs/DEVELOPMENT_STANDARDS.md` — the maintainability bar (enforced, not advisory)

Architecture rationale lives in `docs/architecture/decisions/`. The canonical route shape is
`packages/tasks/src/routes.ts`. The canonical data-context pattern is `packages/db/src/data-context.ts`.

## Commands

```txt
pnpm install
pnpm db:up                # start Postgres via Docker Compose (required for DB-touching tests)
pnpm db:down              # tear down Postgres + volumes
pnpm db:migrate           # idempotent: app migrations -> module migrations -> pg-boss -> grants
pnpm verify:foundation    # full gate: lint, format:check, check:file-size, typecheck, db:migrate, test:integration
```

Maintainability gate (run before broad feature work):

```txt
pnpm lint                 # eslint . --max-warnings=0
pnpm format:check         # prettier --check . (use `pnpm format` to write)
pnpm check:file-size      # fails any source file >1000 lines (see Development Standards)
pnpm typecheck            # tsc --noEmit + web typecheck
```

Integration tests (all run via Vitest against the Postgres started by `db:up`):

```txt
pnpm test:integration                       # tests/integration/*.test.ts
pnpm test:tasks                             # one module's suite (also: notifications, connectors,
                                            #   calendar-email, ai, ai-tools, chat, briefings,
                                            #   release-hardening, vault, memory, structured-state)
vitest run tests/integration/tasks.test.ts  # arbitrary single file
```

Web + e2e:

```txt
pnpm dev:api              # Fastify API on :3000
pnpm dev:web              # Vite web shell on :5173 (proxies /api -> :3000)
pnpm dev:worker           # pg-boss worker process (must be started separately)
pnpm build:web
pnpm test:e2e             # Playwright; mocks REST via tests/e2e/mock-*.ts
```

Spikes are retained as executable proof — **do not delete them**:

```txt
pnpm spike:db:up && pnpm test:spike
```

Operator scripts: `pnpm backup:db`, `pnpm restore:db`, `pnpm export:user`,
`pnpm delete:user`, `pnpm audit:release-hardening`, `pnpm smoke:compose`. See
`docs/operations/release-hardening.md`.

## Hard Invariants (never weaken these)

These are decisions, not code descriptions. Violating any of these is a blocker.

- **No admin private-data bypass.** Admin/owner power is configuration power only. RLS applies to
  all actors including admins. No `BYPASSRLS` on runtime app or worker roles.
- **Private by default.** Data is owner-only unless explicitly shared. Cross-user access requires
  explicit grants.
- **DataContextDb only.** Repositories accept only a branded `DataContextDb` handle, never a root
  Kysely instance. `VaultContext` for all vault I/O — never raw `fs` calls.
- **AccessContext shape.** `AccessContext` carries only `actorUserId` and `requestId`. Do not add
  fields (workspaceId was permanently removed in Slice 1f).
- **Secrets never escape.** Connector/AI credentials, auth tokens, password hashes, and session
  tokens never reach frontend responses, logs, pg-boss job payloads, user exports, or AI prompts.
  Connector/AI secrets are AES-256-GCM encrypted at rest.
- **Metadata-only job payloads.** pg-boss payloads contain actor/resource IDs, job kind,
  idempotency key, and small command params only. Never private content, prompts, or secrets.
- **Provider-agnostic AI.** No feature may hardcode a provider or model. Features request
  capabilities; the router selects the user's configured model.
- **Spec before build.** No new feature or module without an approved design spec in
  `docs/superpowers/specs/`. This is a hard process gate, not a suggestion.
- **Module isolation.** Modules collaborate only through declared public APIs/events. No module
  imports another module's internals or queries its tables directly.
- **pgvector image.** Docker Compose uses `pgvector/pgvector:pg17`. Do not revert to
  `postgres:17-alpine`. The vector extension is installed in
  `infra/postgres/bootstrap/0001_extensions.sql`.
- **Never edit applied migrations.** The migration runner hash-checks applied files. Add a new
  migration file; never modify an existing one. All module SQL lives in the owning module's `sql/`
  directory, never in `infra/postgres/migrations/`.

## GitHub Tracking

The roadmap is tracked in GitHub. Keep it current — do not let the board drift from reality.

- **Project board:** https://github.com/users/motioneso/projects/1 ("Jarv1s Roadmap")
- **Milestones:** one per roadmap entry (M-A1 through M-B3)
- **Epic issues:** #2–#10, one per milestone, each with an exit-criteria checklist

**At milestone start:**
1. Move the epic issue to "In Progress" on the project board.
2. Update `docs/STATUS.md` → current milestone field.

**At milestone end (all exit criteria met, `pnpm verify:foundation` + `pnpm audit:release-hardening` green):**
1. Check off all exit-criteria boxes on the epic issue, then close it.
2. Close the GitHub Milestone.
3. Update `docs/ROADMAP.md` → set status to "Complete" for that milestone.
4. Update `docs/STATUS.md` → clear current milestone, set next step.
5. Save a durable lesson to agentmemory if any non-obvious decision was made.

**During a milestone:** open `task`-labelled issues for each implementation slice; close them as
slices land. Link task issues to the parent epic with "Part of #N".

## Agent Knowledge Tools

**CodeGraph** — use `codegraph_context` / `codegraph_trace` / `codegraph_explore` before
architectural claims or refactors. The index lives under `.codegraph/` (git-ignored); run
`codegraph sync .` after pulling or making meaningful edits.

**agentmemory** — durable lessons and non-obvious invariants that must survive across sessions.
Never store secrets or private data.

**Required recalls** — before starting any of these activities call `memory_smart_search`:

| Activity                           | Query                                  |
| ---------------------------------- | -------------------------------------- |
| Session start / orientation        | `"jarv1s current project state"`       |
| RLS policy or security work        | `"jarv1s RLS shareability policy"`     |
| Migration authoring or debugging   | `"jarv1s migration hash placement"`    |
| AccessContext or DataContextDb     | `"jarv1s accesscontext datacontext"`   |
| Integration-test setup or failures | `"jarv1s integration test trap"`       |
| Frontend/React Query changes       | `"jarv1s frontend workspace querykey"` |

**Required saves** — call `memory_save` immediately (not end-of-session) after any of these:

- A non-obvious architectural decision (why X over Y)
- A confirmed or discovered invariant (ordering constraint, security rule)
- A trap or gotcha that caused a real error
- RLS classification for a resource (owner-only / owner-or-share / recipient-only)
- A shift in current project state (milestone reached, known-good migration/test counts)

Always use `project: "jarv1s"`. Types: `"architecture"` for invariants, `"bug"` for
traps/gotchas, `"fact"` for state snapshots, `"pattern"` for coding patterns.

## Scope Guardrails

- **Write a spec first.** Every new feature, module, or milestone requires an approved design spec
  in `docs/superpowers/specs/` before any code is written.
- **Do not casually build:** real OAuth callbacks, real connector sync, full email/calendar
  clients, a module marketplace, a workflow engine. Each needs its own milestone + spec.
- **AI provider calls** become real in M-A3; until that spec is approved and the milestone is
  active, the capability router remains metadata-only.
- **Embeddings** are real starting M-A1; until that spec is approved, use `StubEmbeddingProvider`.
- Preserve plain Fastify REST + shared TypeScript contracts (`packages/shared/*-api.ts`) unless a
  milestone explicitly justifies a heavier contract layer.
- The 1000-line file limit is enforced by `pnpm check:file-size`. Decompose rather than exceed.
