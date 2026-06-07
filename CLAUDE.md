# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Jarv1s is a modular, self-hostable AI personal assistant OS. It is an early **platform-first
alpha scaffold**: the security/RLS substrate, job substrate, module system, web shell, and a
full set of thin product modules exist, but **real provider integrations are intentionally out
of scope** (no real OAuth callbacks, connector sync, external calendar/email calls, AI provider
calls, embeddings, or write/destructive assistant execution). Modules are deliberately
metadata-only and read-only until later milestones.

Before starting work, read `docs/HANDOFF.md` (the live continuation point — see its `Next Step`,
`Open Questions`, and `Review Notes For Next Agent`) and `docs/DEVELOPMENT_STANDARDS.md`. The
architecture rationale is in `docs/architecture/decisions/0001-foundation.md`.

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

Run a single integration test file (all run via Vitest against the Postgres started by `db:up`):

```txt
pnpm test:integration                       # tests/integration/*.test.ts
pnpm test:tasks                             # one module's suite (also: notes, notifications,
                                            #   connectors, calendar-email, ai, ai-tools, chat,
                                            #   briefings, release-hardening)
vitest run tests/integration/tasks.test.ts  # arbitrary single file
```

Web + e2e:

```txt
pnpm dev:api              # Fastify API on :3000
pnpm dev:web              # Vite web shell on :5173 (proxies /api -> :3000)
pnpm dev:worker           # pg-boss worker process
pnpm build:web
pnpm test:e2e             # Playwright; mocks REST via tests/e2e/mock-*.ts
```

Spikes are retained as executable proof — **do not delete them**:

```txt
pnpm spike:db:up && pnpm test:spike
```

Operator scripts (M7): `pnpm backup:db`, `pnpm restore:db`, `pnpm export:user`,
`pnpm delete:user`, `pnpm audit:release-hardening`, `pnpm smoke:compose`. See
`docs/operations/release-hardening.md`.

## Architecture

pnpm workspace + Turborepo monorepo. Three apps (`apps/api` Fastify, `apps/web` React/Vite,
`apps/worker` pg-boss) compose ~16 `@jarv1s/*` packages. Workspace path aliases are in the root
`tsconfig.json` `paths`.

### The security substrate (the most important invariant)

Every protected data access flows through one path. Repositories **cannot** be called with a raw
Kysely instance — they require a branded `DataContextDb` handle:

```txt
auth session -> AccessContext (actorUserId, requestId?)
  -> DataContextRunner.withDataContext(ctx, work)
  -> opens a Kysely transaction, sets transaction-local app.actor_user_id /
     app.request_id via set_config(..., true)
  -> passes a branded DataContextDb to the repository
  -> Postgres RLS policies evaluate the current actor
```

Defined in `packages/db/src/data-context.ts`. The brand (`dataContextBrand` symbol +
`assertDataContextDb`) is what enforces "no repository ever sees root Kysely." Route handlers
follow `resolveAccessContext(request) -> withDataContext(ctx, scopedDb => repo.method(scopedDb))`
— see `packages/tasks/src/routes.ts` for the canonical shape.

Hard invariants — **never weaken these**:

- Admin/owner power is configuration power, **not** private-data read power. No admin RLS bypass.
- Data is private by default; cross-user access requires explicit grants/workspace membership.
- Runtime app and worker Postgres roles must **not** own protected tables and must **not** have
  `BYPASSRLS`. All protected tables use `FORCE ROW LEVEL SECURITY`.
- Repositories accept only `DataContextDb`, never root Kysely.
- Secrets (connector/AI credentials, auth tokens, password hashes, session tokens) never reach
  frontend responses, logs, job payloads, user exports, or assistant action records. Connector/AI
  secrets are AES-256-GCM encrypted at rest (`JARVIS_CONNECTOR_SECRET_KEY`, `JARVIS_AI_SECRET_KEY`;
  required in production, dev fallback otherwise).

### The module system

Every product surface — including required ones (Settings) — is a module package using the same
SDK contract (`@jarv1s/module-sdk`). Built-in modules are wired in **one place**:
`packages/module-registry/src/index.ts` `BUILT_IN_MODULES`. Each registration supplies a
manifest, SQL migration directories, pg-boss queue definitions, route registration, and optional
worker registration. The registry exposes aggregate getters consumed by the API server
(`registerBuiltInApiRoutes`, `getBuiltInModuleManifests`), the worker, and `scripts/migrate.ts`.

A module package (e.g. `packages/tasks`) typically contains: `manifest.ts` (metadata: nav,
settings, permissions, jobs, routes, assistant tools, shareable resources), `sql/` (module-owned
versioned migrations), `repository.ts` (DataContextDb-only RLS data access), `routes.ts` (Fastify
routes using shared schemas), and optional `jobs.ts`. Modules collaborate **only** through
declared public APIs/events — no importing another module's internals or querying its tables.

Current modules: settings, connectors, tasks, notes, notifications, calendar, email, ai, chat,
briefings.

### Jobs / worker

pg-boss provides Postgres-backed durable jobs (`packages/jobs`). Job payloads are **metadata
only** — actor/workspace/resource IDs, job kind, idempotency key, small command params. Never put
secrets, private bodies, prompts with private content, or model-visible private content in a
payload. Worker handlers re-enter `withDataContext()` before touching protected data, and the
worker role gets only narrow per-table grants (no DELETE on protected tables, no bypass).

### AI posture (capability-routed, BYO-provider)

No feature hardcodes a provider/model; features request capabilities (chat, reasoning,
embeddings, etc.) and the AI module routes to a user's active configured model. Currently this is
**metadata-only**: capability routing returns safe model metadata without decrypting credentials
or calling external providers. The assistant tool executor (`packages/ai`) runs only
manifest-declared **read-only** tools (`tasks.listVisible`, `notes.listVisible`, etc.) through
DataContextDb/RLS. Any non-read tool is **blocked**, creating a metadata-only pending
confirmation record (`app.ai_assistant_action_requests`) — confirmation resolution updates audit
state but never executes writes. Models never get direct DB, provider-client, or secret access.

### Migrations

Raw versioned SQL, run by `scripts/migrate.ts` in order: app schema (`infra/postgres/migrations`)
-> each module's `sql/` directory (discovered via the registry) -> pg-boss schema/queues ->
runtime grants (`infra/postgres/grants`). Bootstrap roles come from `infra/postgres/bootstrap`.
`db:migrate` is idempotent. Note SQL file numbers are split across `infra/` and module `sql/`
dirs, so global numbering is not contiguous.

## Development Standards (enforced)

`docs/DEVELOPMENT_STANDARDS.md` defines a strict "thermo-nuclear" maintainability bar — passing
tests is necessary but not sufficient. Key enforced rules:

- **1000-line limit**: `pnpm check:file-size` fails any source file over 1000 lines. Pushing a
  file past 1000 lines is a presumptive blocker; decompose instead. This is why e2e mock helpers
  are split into `tests/e2e/mock-*.ts`.
- Prefer structural simplification that deletes complexity over adding ad-hoc branches, mode
  flags, thin wrappers, or feature logic leaking into shared packages.
- Keep logic in its canonical layer: protected access through DataContext/RLS; module behavior in
  the owning module; shared packages hold general primitives only.

### Agent knowledge tools

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
Do NOT save things already stated in CLAUDE.md or HANDOFF.md.

## Scope Guardrails

Keep changes tightly bounded. The formal M1–M7 roadmap and all four memory data model slices
(Vault, Memory Index, Structured State) are complete. **Write a spec before building anything
new.** Do **not** casually build: real OAuth providers, real connectors, full email/calendar
clients, a full module marketplace, a workflow engine, real AI provider calls, or write/destructive
assistant execution. Embeddings are in-scope only once a `LocalEmbeddingProvider` spec exists.
Preserve plain Fastify REST + shared TypeScript contracts (`packages/shared/*-api.ts`) unless a
milestone proves it insufficient.
