# Jarv1s

Jarv1s is a modular AI personal assistant OS. This repository contains the platform-first alpha scaffold: backend, worker, web shell, database migrations, and core modules. It also includes the security substrate and release-hardening scripts. Real provider integrations and the full product experience are currently out of scope.

## Current State

Implemented slices:

- Foundation: TypeScript, pnpm workspaces, Fastify, Kysely, Postgres, Docker Compose, Vitest,
  Playwright, ESLint, Prettier, and Turborepo wiring.
- Security substrate: Better Auth for authentication/session identity, AccessContext/DataContext
  authorization, forced row-level security, separate app/worker roles, and no admin private-data
  bypass.
- Modules: Tasks, Notes, Notifications, Connectors, Calendar, Email, AI settings/tool metadata,
  Chat, and Briefings as package/manifest-based built-in modules.
- Assistant safety foundation: read-only assistant tool execution, metadata-only confirmation
  records for non-read tool requests, and no write/destructive execution.
- Operations: database backup/restore, user export/delete, production environment checklist,
  release-hardening audit, CI workflow, and Compose smoke automation.

- For what is currently implemented or not implemented, refer to the active milestones and roadmap on the project board. The system is under active development and capabilities (such as AI provider connections and embeddings) are frequently evolving.

## How To Pick Up Work

Read these in order:

- [Foundation architecture](docs/architecture/decisions/0001-foundation.md)
- [Maintenance/system posture](docs/architecture/decisions/0002-maintenance-system-posture.md)
- [Development standards](docs/DEVELOPMENT_STANDARDS.md)
- [Brand brief](docs/brand/brand-brief.md)
- [Product goals and ideals](docs/brand/product-goals-and-ideals.md)
- [Brand questionnaire](docs/brand/brand-questionnaire.md)
- [Visual language research plan](docs/brand/visual-language-research-plan.md)
- [Auth/RLS safety spike](docs/architecture/spikes/0001-auth-rls-safety.md)
- [pg-boss worker RLS spike](docs/architecture/spikes/0002-pg-boss-worker-rls.md)
- [MVP foundation scaffold plan](docs/architecture/plans/0001-mvp-foundation-scaffold.md)
- [Tasks module MVP plan](docs/architecture/plans/0002-tasks-module-mvp.md)
- [Platform-first alpha roadmap](docs/architecture/plans/0003-platform-first-alpha-roadmap.md)
- [M7 operations verification plan](docs/architecture/plans/0004-m7-operations-verification-plan.md)
- [Archived session handoff](docs/HANDOFF.md)
- [Tasks M1 handoff (archived)](docs/archive/HANDOFF_TASKS_M1.md)

The active continuation point is tracked in GitHub. Please read [CLAUDE.md](CLAUDE.md) and check the project board for current status, milestones, and open work.

Keep these invariants intact:

- Admin/owner power is configuration power, not private-data read power.
- Runtime app and worker roles must not own protected tables and must not have `BYPASSRLS`.
- Repositories receive only the branded `DataContextDb` transaction handle, never root Kysely.
- pg-boss payloads contain metadata only.
- Secrets never go to frontend responses, logs, job payloads, exports, or assistant action records.
- Models/tools do not get direct database, provider-client, or secret access.
- Preserve Fastify REST route schemas/shared contracts unless a later milestone proves a stronger
  need.
- Follow the CodeGraph and agentmemory usage rules in
  [Development standards](docs/DEVELOPMENT_STANDARDS.md#agent-knowledge-tools).

## Local Verification

```txt
pnpm install
pnpm db:up
pnpm verify:foundation
```

`pnpm verify:foundation` runs:

```txt
pnpm lint
pnpm format:check
pnpm check:file-size
pnpm typecheck
pnpm db:migrate
pnpm test:integration
```

Focused checks:

```txt
pnpm test:tasks
pnpm test:notifications
pnpm test:connectors
pnpm test:calendar-email
pnpm test:ai
pnpm test:ai-tools
pnpm test:chat
pnpm test:briefings
pnpm test:wellness
pnpm test:memory
pnpm test:vault
pnpm test:release-hardening
pnpm audit:release-hardening
pnpm build:web
pnpm test:e2e
```

Run the web app shell during local development:

```txt
pnpm dev:api
pnpm dev:web
```

The Vite app runs on `http://localhost:5173` and proxies API requests to
`http://localhost:3000` by default.

The original spike proof remains runnable:

```txt
pnpm spike:db:up
pnpm test:spike
```

## Alpha Operations

M7 release-hardening adds small operator scripts for self-hosted alpha lifecycle checks.

Create a sensitive full database backup:

```txt
pnpm backup:db -- --output backups/jarv1s-alpha.dump
```

Export one user's data without encrypted connector/AI secrets, auth tokens, passwords, or session
tokens:

```txt
pnpm export:user -- --user-id <user_uuid> --output exports/user-<user_uuid>.json
```

Preview and then execute a user delete. The execute path requires an exact confirmation id and
records a metadata-only `user.delete` admin audit event before deleting the user row and database
cascades:

```txt
pnpm delete:user -- --user-id <user_uuid>
pnpm delete:user -- --user-id <user_uuid> --actor-user-id <admin_uuid> --execute --confirm-user-id <user_uuid>
```

Run a local Docker Compose smoke check:

```txt
pnpm smoke:compose
```

More detail is in [M7 release hardening operations](docs/operations/release-hardening.md).

## Auth Provider Configuration

Local email/password auth is enabled by default. Optional login identity providers are configured
through environment variables and remain separate from future connector permissions:

```txt
JARVIS_AUTH_GOOGLE_CLIENT_ID
JARVIS_AUTH_GOOGLE_CLIENT_SECRET
JARVIS_AUTH_GITHUB_CLIENT_ID
JARVIS_AUTH_GITHUB_CLIENT_SECRET
JARVIS_AUTH_MICROSOFT_CLIENT_ID
JARVIS_AUTH_MICROSOFT_CLIENT_SECRET
JARVIS_AUTH_MICROSOFT_TENANT_ID
JARVIS_AUTH_MICROSOFT_AUTHORITY
JARVIS_AUTH_OIDC_PROVIDER_ID
JARVIS_AUTH_OIDC_DISPLAY_NAME
JARVIS_AUTH_OIDC_CLIENT_ID
JARVIS_AUTH_OIDC_CLIENT_SECRET
JARVIS_AUTH_OIDC_DISCOVERY_URL
JARVIS_AUTH_OIDC_ISSUER
JARVIS_AUTH_OIDC_REQUIRE_ISSUER_VALIDATION
```

Generic OIDC uses identity scopes only: `openid`, `email`, and `profile`.

## Docker Compose Overrides

The API binds to host port `3000` by default. Override it with:

```txt
JARVIS_API_PORT=3001 docker compose -f infra/docker-compose.yml up api
```

The web app binds to host port `5173` by default. Override it with:

```txt
JARVIS_WEB_PORT=5174 docker compose -f infra/docker-compose.yml up web
```

The Compose network defaults to subnet `10.251.0.0/24`. Override it when that range conflicts locally:

```txt
JARVIS_DOCKER_SUBNET=10.252.0.0/24 docker compose -f infra/docker-compose.yml up
```
